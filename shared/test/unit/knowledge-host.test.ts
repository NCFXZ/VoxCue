import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { KnowledgeHost } from '../../../shared/electron/backend/knowledge/host';
import { KnowledgeError } from '../../../shared/electron/backend/knowledge/errors';

const native = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: native.fork } }));
const hosts: KnowledgeHost[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.stop();
});

function setup() {
  const child = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    postMessage: vi.fn((message: any) => {
      if (message.init || message.op === 'close')
        queueMicrotask(() => child.emit('message', { id: message.id, value: null }));
    }),
  });
  native.fork.mockReturnValue(child);
  const host = new KnowledgeHost('/synthetic/knowledge', '/synthetic/models');
  hosts.push(host);
  return { host, child };
}

it.each([
  'unavailable',
  'invalid_request',
  'configuration',
  'integrity',
  'not_ready',
  'cancelled',
  'closed',
] as const)('utilityProcess 的 %s 分类完整传递，下一次请求仍能完成', async (code) => {
  const { host, child } = setup();
  await host.initialize();
  const pending = host.search('synthetic', 5, 'hybrid', new AbortController().signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'KnowledgeError', code });
  await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledTimes(2));
  child.emit('message', {
    id: child.postMessage.mock.calls[1][0].id,
    error: '合成故障',
    errorCode: code,
  });
  await rejected;
  const next = host.search('synthetic', 5, 'hybrid', new AbortController().signal);
  await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledTimes(3));
  child.emit('message', { id: child.postMessage.mock.calls[2][0].id, value: [] });
  await expect(next).resolves.toEqual([]);
});

it('进程退出属于可用性故障，主动关闭和取消不能回退；迟到消息不复活请求', async () => {
  const { host, child } = setup();
  await host.initialize();
  const controller = new AbortController();
  const cancelled = host.search('synthetic', 5, 'hybrid', controller.signal);
  const rejected = expect(cancelled).rejects.toBeInstanceOf(KnowledgeError);
  await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledTimes(2));
  const id = child.postMessage.mock.calls[1][0].id;
  controller.abort();
  await rejected;
  child.emit('message', { id, value: ['late'] });
  const pending = host.search('synthetic', 5, 'hybrid', new AbortController().signal);
  const exited = expect(pending).rejects.toMatchObject({ code: 'unavailable' });
  await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledTimes(4));
  child.emit('exit');
  await exited;
  const other = setup();
  await other.host.initialize();
  const pendingClose = other.host.search('synthetic', 5, 'hybrid', new AbortController().signal);
  const closed = expect(pendingClose).rejects.toMatchObject({ code: 'closed' });
  await vi.waitFor(() => expect(other.child.postMessage).toHaveBeenCalledTimes(2));
  other.host.stop();
  await closed;
});
