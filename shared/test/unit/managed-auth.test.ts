import { expect, it, vi } from 'vitest';
import { ChatGPTAuthService } from '../../electron/backend/auth/service';
import { ChatGPTService } from '../../electron/backend/chat/service';
import { ChatGPTAccountUsage } from '../../electron/backend/chat/accountUsage';
import { codexRuntimeVersion, type CodexUsagePort } from '../../electron/backend/chat/codexUsage';

function fixture() {
  let active = false;
  const open = vi.fn(async (_url: string) => {});
  const access = {
    token: 'synthetic-private',
    account: 'subject:workspace',
    chatgptAccountId: 'workspace',
    email: 'synthetic@example.test',
    name: 'Synthetic',
    expiresAt: Date.now() + 3600000,
  };
  const runtime: CodexUsagePort = {
    account: vi.fn(async () => (active ? { email: access.email, planType: 'plus' } : null)),
    access: vi.fn(async () => {
      if (!active) throw Error('not signed in');
      return { ...access };
    }),
    login: vi.fn(async (browser) => {
      await browser('https://auth.openai.com/authorize?state=synthetic');
      active = true;
    }),
    limits: vi.fn(async () => ({
      accountId: 'workspace',
      rateLimits: {
        planType: 'plus',
        primary: { usedPercent: 20, windowDurationMins: 300 },
        secondary: { usedPercent: 40, windowDurationMins: 10080 },
      },
    })),
    cancel: vi.fn(),
    logout: vi.fn(async () => {
      active = false;
    }),
    stop: vi.fn(async () => {}),
  };
  return { auth: new ChatGPTAuthService(runtime, open), runtime, open };
}
it('一次官方登录同时用于聊天、附件和额度，不读取旧凭据或公开令牌', async () => {
  const f = fixture();
  expect(await f.auth.session()).toBeNull();
  const session = await f.auth.signIn();
  expect(session).toMatchObject({
    mode: 'chatgpt',
    user: { name: 'Synthetic', email: 'synthetic@example.test' },
  });
  expect(JSON.stringify(session)).not.toMatch(
    /synthetic-private|subject:workspace|chatgptAccountId|refreshToken/,
  );
  expect(await f.auth.session()).toEqual(session);
  const transport = vi.fn(async (url: any, options?: RequestInit) => {
    expect(options?.headers).toMatchObject({
      authorization: 'Bearer synthetic-private',
      'ChatGPT-Account-Id': 'workspace',
    });
    if (String(url).endsWith(`/models?client_version=${codexRuntimeVersion}`))
      return Response.json({
        models: [{ slug: 'synthetic', display_name: 'Synthetic', visibility: 'list' }],
      });
    expect(String(url)).toBe('https://chatgpt.com/backend-api/codex/responses');
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({
      store: false,
      stream: true,
      model: 'synthetic',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Question' },
            { type: 'input_image', image_url: 'data:image/png;base64,AQID' },
            { type: 'input_text', text: '附件 note.txt：\nSynthetic note' },
          ],
        },
      ],
    });
    return new Response(
      'data: ' +
        JSON.stringify({
          type: 'response.completed',
          response: {
            id: 'synthetic-response',
            output: [
              { type: 'message', content: [{ type: 'output_text', text: 'Synthetic answer' }] },
            ],
          },
        }) +
        '\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  const chat = new ChatGPTService({
    access: () => f.auth.access(),
    fetch: transport,
    ledger: { get: vi.fn(), add: vi.fn() } as any,
  });
  const result = await chat.stream(
    {
      id: 'q',
      modelId: 'synthetic',
      instructions: 'Answer briefly.',
      webSearch: false,
      turns: [
        {
          role: 'user',
          content: 'Question',
          files: [
            { id: 'image', name: 'image.png', bytes: new Uint8Array([1, 2, 3]) },
            {
              id: 'note',
              name: 'note.txt',
              bytes: new TextEncoder().encode('Synthetic note'),
            },
          ],
        },
      ],
    },
    () => {},
    new AbortController().signal,
  );
  expect(result.answerText).toBe('Synthetic answer');
  const usage = new ChatGPTAccountUsage({
    runtime: f.runtime,
    identity: () => f.auth.usageIdentity(),
  });
  expect((await usage.read()).quotas.map((q) => q.label)).toEqual(['5小时额度', '每周额度']);
  expect(f.open).toHaveBeenCalledOnce();
  expect(f.runtime.login).toHaveBeenCalledOnce();
  await f.auth.signOut();
  expect(await f.auth.session()).toBeNull();
  expect(f.runtime.logout).toHaveBeenCalledOnce();
  expect(f.runtime.stop).toHaveBeenCalledOnce();
});
it('取消唯一登录后可以重试，不遗留已登录状态', async () => {
  const f = fixture();
  vi.mocked(f.runtime.login).mockImplementationOnce(
    async (_open, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true }),
      ),
  );
  const pending = f.auth.signIn();
  await vi.waitFor(() => expect(f.runtime.login).toHaveBeenCalled());
  expect(f.auth.isPending()).toBe(true);
  f.auth.cancel();
  await expect(pending).rejects.toThrow('登录已取消');
  expect(f.auth.isPending()).toBe(false);
  expect(await f.auth.session()).toBeNull();
  expect((await f.auth.signIn()).mode).toBe('chatgpt');
});
it('退出后丢弃迟到会话，远端退出失败明确返回提示并释放自有进程', async () => {
  const f = fixture();
  await f.auth.signIn();
  let finish!: (value: any) => void;
  vi.mocked(f.runtime.account).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.auth.session();
  vi.mocked(f.runtime.logout).mockRejectedValueOnce(Error('synthetic-private'));
  expect((await f.auth.signOut()).warning).toContain('未能确认');
  finish({ email: 'synthetic@example.test', planType: 'plus' });
  expect(await pending).toBeNull();
  expect(f.runtime.stop).toHaveBeenCalled();
});
it('退出不依赖远端账户或工作区发现成功', async () => {
  const f = fixture();
  await f.auth.signIn();
  vi.mocked(f.runtime.account).mockClear();
  vi.mocked(f.runtime.account).mockRejectedValueOnce(Error('workspace discovery unavailable'));
  expect(await f.auth.signOut()).toEqual({ warning: null });
  expect(f.runtime.account).not.toHaveBeenCalled();
  expect(f.runtime.logout).toHaveBeenCalledWith(true);
  expect(f.runtime.stop).toHaveBeenCalled();
});
