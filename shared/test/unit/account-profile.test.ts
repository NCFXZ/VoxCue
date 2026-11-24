import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createAccountProfile } from '../../electron/accountProfile';
import { profileDirectory, profileDirectoryName } from '../../electron/accountProfilePaths';
import { eraseLocalAccount } from '../../electron/backend/accountErasure';
import { apiProviderIds } from '../../electron/contracts/apiConnections';
import type { ChatRequest } from '../../electron/contracts/chat';

vi.mock('electron', () => ({}));
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(['chatgpt', 'copilot'] as const)('blocks a disabled %s before contacting its credential runtime', async service => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voxcue-disabled-service-'));
  roots.push(root);
  const profile = apiProfile(root, 'local');
  try {
    await profile.selection.set(service, false);
    const access = vi.spyOn(service === 'chatgpt' ? profile.auth : profile.copilotAuth, 'access');
    expect(() => profile.chat.models()).toThrow('请先连接 AI 服务。');
    expect(() => profile.chat.accountUsage()).toThrow('请先连接 AI 服务。');
    expect(access).not.toHaveBeenCalled();
  } finally { await profile.dispose(); }
});

it('keeps native images and provider connections separate across A, B and local sessions, including restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voxcue-account-profile-'));
  roots.push(root);
  const make = (owner: string) =>
    createAccountProfile(owner, {
      root,
      version: 'test',
      ragModel: root,
      codexLoginStatus: undefined,
      openBrowser: async () => {
        throw Error('Unexpected external authorization');
      },
      changing: () => false,
      emit: () => {},
      requireModel: () => {},
      interviewActive: () => false,
    });
  const owner = 'account:' + randomUUID();
  const id = randomUUID();
  const image = Buffer.from('89504e470d0a1a0a', 'hex');
  const preview = 'data:image/png;base64,' + image.toString('base64');
  const a = make(owner);
  await a.images.save([{ id, preview, file: { name: 'A.png', bytes: image } }]);
  await a.selection.set('copilot', true);
  await a.dispose();
  await expect(a.images.preview(id)).rejects.toThrow('closed');
  for (const other of ['account:' + randomUUID(), 'local']) {
    const b = make(other);
    await b.selection.ready;
    expect(b.selection.service).toBe('chatgpt');
    await expect(b.images.original(id)).rejects.toThrow();
    await b.dispose();
  }
  const restored = make(owner);
  await restored.selection.ready;
  expect(restored.selection.service).toBe('copilot');
  expect((await restored.images.original(id)).bytes).toEqual(image);
  await restored.dispose();
});

it('erases only the selected profile and its recordings and leaves unassigned legacy data in place', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voxcue-owner-erasure-'));
  roots.push(root);
  const a = 'account:' + randomUUID(),
    b = 'account:' + randomUUID();
  const marker = async (directory: string) => {
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, 'synthetic.txt');
    await writeFile(file, 'synthetic');
    return file;
  };
  const files = (owner: string) =>
    Promise.all([
      marker(profileDirectory(root, owner)),
      marker(path.join(root, 'interview-recordings-v1', profileDirectoryName(owner))),
    ]);
  const removed = await files(a);
  const kept = [
    ...(await files(b)),
    ...(await files('local')),
    await marker(path.join(root, 'knowledge-v1')),
  ];
  await eraseLocalAccount(root, async () => {}, a);
  for (const file of removed)
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
  for (const file of kept) expect(await readFile(file, 'utf8')).toBe('synthetic');
  await expect(eraseLocalAccount(root, async () => {}, '../')).rejects.toThrow();
});

function apiProfile(root: string, owner: string) {
  return createAccountProfile(owner, {
    root, version: 'test', ragModel: root, codexLoginStatus: undefined,
    credentialEncryption: {
      encrypt: (text) => Buffer.from(text).reverse(), decrypt: (bytes) => Buffer.from(bytes).reverse().toString(),
    },
    openBrowser: vi.fn(), changing: () => false, emit: vi.fn(), requireModel: vi.fn(), interviewActive: () => false,
  });
}

it.each(['chatgpt', 'copilot'] as const)('waits for independent profile resources when %s sign-out fails', async service => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voxcue-erase-resource-'));
  roots.push(root);
  const profile = apiProfile(root, 'account:' + randomUUID());
  await profile.selection.ready;
  const first = vi.spyOn(profile.auth, 'signOut').mockResolvedValue({ warning: null });
  const second = vi.spyOn(profile.copilotAuth, 'signOut').mockResolvedValue({ warning: null });
  (service === 'chatgpt' ? first : second).mockRejectedValue(Error('synthetic storage failure'));
  let release!: () => void;
  const gated = new Promise<void>(resolve => { release = resolve; });
  const knowledge = vi.spyOn(profile.knowledge, 'close').mockReturnValue(gated);
  const api = vi.spyOn(profile.api, 'dispose');
  const images = vi.spyOn(profile.images, 'dispose');
  const runtime = vi.spyOn(profile.copilotRuntime, 'stop').mockResolvedValue();
  let finished = false;
  const result = profile.dispose(true).catch(error => error).finally(() => { finished = true; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    for (const resource of [knowledge, api, images, runtime]) expect(resource).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
  } finally { release(); }
  expect(await result).toMatchObject({ message: 'synthetic storage failure' });
});

it('routes a saved API key after restart and retains it on disconnect only in its owner profile', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'voxcue-api-owner-'));
  roots.push(root);
  const http = vi.fn<typeof fetch>(async (url, options) => {
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer synthetic-owner-only');
    if (String(url) === 'https://api.deepseek.com/models') return Response.json({ data: [{ id: 'deepseek-flash', effort: { supported_levels: ['high'] } }] });
    expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({ model: 'deepseek-flash', stream: true, reasoning_effort: 'high' });
    return new Response('data: ' + JSON.stringify({ id: 'fixture-answer',
      choices: [{ delta: { content: '合成回答' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } }) + '\n\ndata: [DONE]\n\n');
  });
  vi.stubGlobal('fetch', http);
  const profiles = [];
  try {
    const original = apiProfile(root, 'local');
    profiles.push(original);
    await original.selection.ready;
    await original.api.configure({ provider: 'deepseek' }, async () => 'synthetic-owner-only', vi.fn(), new AbortController().signal);
    expect(original.selection.service).toBe('chatgpt');
    await original.selection.set('deepseek', true);
    await original.dispose();
    profiles.pop();
    const restored = apiProfile(root, 'local');
    const other = apiProfile(root, 'account:' + randomUUID());
    profiles.push(restored, other);
    const session = await restored.selection.session('startup', (id) => restored.session(id));
    expect(session?.mode).toBe('deepseek');
    expect(await other.api.list()).toEqual([]);
    const result = await restored.ragChat.stream({
      id: 'synthetic', modelId: 'deepseek-flash', effort: 'high', webSearch: false,
      instructions: '', turns: [{ role: 'user', content: 'hello' }],
    }, vi.fn(), new AbortController().signal);
    expect(result.answerText).toBe('合成回答');
    expect(result.provider?.id).toBe('deepseek');
    expect(await restored.chat.usage()).toMatchObject({ requests: 1, totalTokens: 10 });
    await restored.selection.set('deepseek', false);
    expect(await restored.api.list()).toEqual([{ provider: 'deepseek' }]);
    expect(() => restored.chat.models()).toThrow('请先连接');
  } finally {
    await Promise.all(profiles.map((profile) => profile.dispose()));
    vi.unstubAllGlobals();
  }
});

it('switches preparation and interview requests across saved API providers with separate usage', async () => {
  const { transport } = createRequire(import.meta.url)('../fixtures/api-interactive-preview.cjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'voxcue-api-selection-'));
  roots.push(root);
  const http = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', http);
  const profile = apiProfile(root, 'local');
  const signal = new AbortController().signal;
  try {
    await profile.selection.ready;
    for (const provider of apiProviderIds) {
      const key = 'synthetic-' + provider;
      const send = transport(provider, key);
      http.mockImplementation(send);
      expect(await profile.api.configure({ provider }, async () => key, vi.fn(), signal)).toBe(true);
      await profile.selection.set(provider, true);
      http.mockImplementationOnce(async (url, options) => {
        const page = await (await send(url, options)).json();
        return Response.json({ data: page.data.slice(0, 1) });
      });
      const initial = await profile.ragChat.models();
      expect(initial).toHaveLength(1);
      const beforeRefresh = http.mock.calls.length;
      expect(await profile.ragChat.models()).toEqual(initial);
      expect(http).toHaveBeenCalledTimes(beforeRefresh);
      const refreshed = await profile.ragChat.models(true);
      expect(http).toHaveBeenCalledTimes(beforeRefresh + 1);
      const model = refreshed.find(entry => entry.id !== initial[0].id)!;
      expect(model.provider?.id).toBe(provider);
      expect((await profile.chat.usage()).requests).toBe(0);

      const request: ChatRequest = {
        id: randomUUID(), modelId: model.id, webSearch: false, instructions: '',
        turns: [{ role: 'user', content: '合成问题' }],
      };
      const preparation = await profile.ragChat.stream({
        ...request, profile: { name: '', jobDescription: '', background: '' },
      }, vi.fn(), signal);
      expect(preparation.provider?.id).toBe(provider);
      expect(preparation.answerText).toContain(model.id);
      const interview = profile.ragChat.beginRequest({ references: false, retrievalQuery: '合成问题' });
      try {
        const answer = await interview.stream({ ...request, id: randomUUID() }, vi.fn(), signal);
        expect(answer.provider?.id).toBe(provider);
        expect(answer.answerText).toContain(model.id);
      } finally {
        interview.dispose();
      }
      expect(await profile.chat.usage()).toMatchObject({
        requests: 2, inputTokens: 96, outputTokens: 48, totalTokens: 144,
      });
    }
  } finally {
    await profile.dispose();
    vi.unstubAllGlobals();
  }
}, 20000);
