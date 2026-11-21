import { afterAll, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { Writable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { copilotAttachments, installCopilotAttachmentEncoder } from '../../electron/backend/copilot/attachments';
import { sharedCopilotRequest } from '../../electron/backend/copilot/requests';
import { abortable } from '../../electron/backend/cancellable';

const nodeRequire = createRequire(__filename);
const sdk = nodeRequire('@github/copilot-sdk') as typeof import('@github/copilot-sdk');
const sdkRequire = createRequire(nodeRequire.resolve('@github/copilot-sdk'));
const { RAL } = sdkRequire('vscode-jsonrpc/node.js') as typeof import('vscode-jsonrpc/node');
const original = RAL();
afterAll(() => RAL.install(original));

const live = new AbortController().signal;
const bytes = Buffer.alloc(4 * 1024 * 1024 + 5, 123).subarray(2);
const text = new TextEncoder().encode('文😀\n"\\\u0000');
const input = [{ role: 'user' as const, content: '问题', files: [
  { name: 'example.png', bytes }, { name: 'quoted.md', bytes: text }, { name: 'end.pdf', bytes: bytes.subarray(-5) },
] }];

it('preserves the exact JSON bytes and can cancel a queued or partially encoded frame', async () => {
  installCopilotAttachmentEncoder();
  const options = { charset: 'utf-8' as const };
  const encoder = RAL().applicationJson.encoder;
  const frame = (attachments: unknown[]) => ({ jsonrpc: '2.0', id: 7, method: 'session.send',
    params: { prompt: '中😀"\\\n', attachments, responseFormat: { schema: { data: '原样', text: '保留' } } } });
  const large = frame(await copilotAttachments(input, live));
  const other = frame([{ type: 'blob', data: 'AQI=', mimeType: 'image/png' }]);
  for (const msg of [large, other, { ...large, method: 'different' }]) {
    const expected = await original.applicationJson.encoder.encode(msg, options);
    expect(Buffer.compare(await encoder.encode(msg, options), expected)).toBe(0);
  }
  for (const when of ['queued', 'in-flight']) {
    const controller = new AbortController();
    const pending = frame(await copilotAttachments(input, controller.signal));
    if (when === 'queued') controller.abort();
    else setImmediate(() => controller.abort());
    await expect(encoder.encode(pending, options)).rejects.toMatchObject({ name: 'AbortError' });
    const sdkRequest = { ...pending, params: { ...pending.params, sessionId: 'owned' } };
    expect(JSON.parse(Buffer.from(await encoder.encode(sdkRequest, options)).toString())).toEqual({
      jsonrpc: '2.0', id: sdkRequest.id, method: 'session.abort', params: { sessionId: 'owned' },
    });
  }
});

it('accounts for escaped text size and preserves a surrogate pair across an encoding boundary', async () => {
  installCopilotAttachmentEncoder();
  const encoder = RAL().applicationJson.encoder;
  const text = '\0'.repeat(32767) + '😀' + '\0'.repeat(163000);
  const raw = new TextEncoder().encode(text);
  const files = Array.from({ length: 4 }, (_, i) => ({ name: `doc-${i}.txt`, bytes: raw }));
  const turns = [{ role: 'user' as const, content: 'test', files }];
  const signal = new AbortController();
  const attachments = await copilotAttachments(turns, signal.signal);
  const msg = { jsonrpc: '2.0', method: 'session.send', params: { attachments } };
  const opts = { charset: 'utf-8' as const };
  const expected = await original.applicationJson.encoder.encode(msg, opts);
  expect(Buffer.compare(expected, await encoder.encode(msg, opts))).toBe(0);
  setImmediate(() => signal.abort());
  await expect(encoder.encode(msg, opts)).rejects.toMatchObject({ name: 'AbortError' });
});

it('retains the SDK writer semaphore and pipe backpressure for a following small message', async () => {
  installCopilotAttachmentEncoder();
  const { StreamMessageWriter } = sdkRequire('vscode-jsonrpc/node.js') as typeof import('vscode-jsonrpc/node');
  const blocked = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const writes: number[] = [];
  const output = new Writable({ highWaterMark: 1, write(data, _encoding, done) {
    writes.push(data.byteLength);
    if (writes.length === 2) {
      blocked.resolve();
      void release.promise.then(() => done());
    } else done();
  } });
  const writer = new StreamMessageWriter(output);
  const attachments = await copilotAttachments(input, live);
  const message = { jsonrpc: '2.0', method: 'session.send', params: { attachments } };
  const ping = { jsonrpc: '2.0', method: 'ping' };
  const first = writer.write(message);
  const second = writer.write(ping);
  try {
    await blocked.promise;
    await new Promise(resolve => setImmediate(resolve));
    expect(writes).toHaveLength(2);
  } finally {
    release.resolve();
    await Promise.all([first, second]);
    writer.end();
  }
  expect(writes).toHaveLength(4);
  expect(writes[1]).toBeGreaterThan(4 * 1024 * 1024);
});

it('uses the real SDK stdio writer in send order, and skips a cancelled frame before the next request', async () => {
  installCopilotAttachmentEncoder();
  const current = RAL(), encoder = current.applicationJson.encoder;
  let cancelEncoding: AbortController | undefined;
  RAL.install({ ...current, applicationJson: { ...current.applicationJson, encoder: {
    ...encoder,
    encode(message, options) {
      const result = encoder.encode(message, options);
      if (cancelEncoding && 'method' in message && message.method === 'session.send') {
        const controller = cancelEncoding;
        cancelEncoding = undefined;
        setImmediate(() => controller.abort());
      }
      return result;
    },
  } } });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'voxcue-sdk-attachments-'));
  // Only this Node fixture receives the messages. No official CLI, login or external network is used.
  const child = `
    const rpc = require(${JSON.stringify(sdkRequire.resolve('vscode-jsonrpc/node.js'))});
    const sha = data => require('node:crypto').createHash('sha256').update(data).digest('hex');
    const link = rpc.createMessageConnection(new rpc.StreamMessageReader(process.stdin), new rpc.StreamMessageWriter(process.stdout));
    let delivered = 0;
    const aborted = [];
    link.onRequest((method, value) => {
      if (method === 'connect') return { protocolVersion: 3 };
      if (method === 'session.create') return { sessionId: value.sessionId };
      if (method === 'session.abort') { aborted.push(value); return {}; }
      if (method === 'session.send' && value.prompt === 'read cancelled frames')
        return { messageId: JSON.stringify(aborted) };
      if (method === 'session.send') return { messageId: (++delivered) + ':' + sha(JSON.stringify(value.attachments)) };
      return {};
    });
    link.listen();`;
  const client = new sdk.CopilotClient({
    connection: sdk.RuntimeConnection.forStdio({ path: process.execPath, args: ['-e', child, '--'] }),
    mode: 'empty', baseDirectory: directory, workingDirectory: directory, useLoggedInUser: false,
  });
  try {
    await client.start();
    const session = await client.createSession({ availableTools: [], onPermissionRequest: () => ({ kind: 'reject' }) });
    const other = await client.createSession({ availableTools: [], onPermissionRequest: () => ({ kind: 'reject' }) });
    expect(other.sessionId).not.toBe(session.sessionId);
    const large = await copilotAttachments(input, live);
    const short = [{ type: 'selection' as const, filePath: 'a.txt', displayName: 'a', text: '短' }];
    const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const expected = [`1:${hash(large)}`, `2:${hash(short)}`];
    const send = (attachments: typeof large) => session.send({ prompt: 'fixture', attachments });
    await expect(Promise.all([send(large), send(short)])).resolves.toEqual(expected);
    const controller = new AbortController();
    const cancelled = await copilotAttachments(input, controller.signal);
    controller.abort();
    const retire = () => client.forceStop().then(() => {});
    await expect(sharedCopilotRequest(undefined, () => send(cancelled), controller.signal, retire, 5000)).rejects.toThrow();
    await expect(send(short)).resolves.toBe(`3:${hash(short)}`);
    const active = new AbortController();
    const inflight = await copilotAttachments(input, active.signal);
    cancelEncoding = active;
    const sending = sharedCopilotRequest(undefined, () => send(inflight), active.signal, retire, 5000);
    await expect(abortable(sending, active.signal)).rejects.toThrow();
    const unaffected = other.send({ prompt: 'other', attachments: short });
    await sending;
    expect(cancelEncoding).toBeUndefined();
    await expect(unaffected).resolves.toBe(`4:${hash(short)}`);
    await expect(other.send('read cancelled frames')).resolves.toBe(JSON.stringify([{ sessionId: session.sessionId }]));
    await expect(send(short)).resolves.toBe(`5:${hash(short)}`);
  } finally {
    try { await client.forceStop(); }
    finally { await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); }
  }
});
