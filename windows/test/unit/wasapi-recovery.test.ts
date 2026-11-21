import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import type { SpeechEvent } from '../../../shared/electron/contracts/speech';
import { SpeechController } from '../../electron/speech/controller';

const sources = ['system', 'microphone'] as const;
const children: ReturnType<typeof helper>[] = [];
const received: number[] = [];
let service: SpeechController | undefined;
let autoClose = false;

function helper(source: string) {
  const child = Object.assign(new EventEmitter(), {
    source, stdout: new PassThrough(), stderr: new PassThrough(),
    stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
    exitCode: null as number | null, kill: vi.fn(),
  });
  function close(code: number) {
    child.exitCode = code;
    child.emit('exit', code);
    child.stdout.end();
    child.stderr.end();
    child.emit('close', code);
  }
  child.stdin.end.mockImplementation(() => { if (autoClose) queueMicrotask(() => close(0)); });
  return Object.assign(child, { close });
}

vi.mock('node:child_process', () => ({
  spawn: (_file: string, [source]: string[]) => {
    const child = helper(source);
    if (source === 'devices') queueMicrotask(() => {
      child.stdout.write(JSON.stringify(sources.map(id => ({ id, source: id, name: id, default: true }))));
      child.close(0);
    });
    else {
      children.push(child);
      queueMicrotask(() => child.stderr.write('{"type":"started"}\n'));
    }
    return child;
  },
}));
vi.mock('node:worker_threads', () => ({
  Worker: class extends EventEmitter {
    postMessage({ op, id, samples, sequence }: { op: string; id: number; samples?: Float32Array; sequence?: number }) {
      if (op === 'audio') {
        received.push(...samples!);
        queueMicrotask(() => this.emit('message', { ack: sequence }));
        return;
      }
      const replies: Record<string, object> = {
        init: { ready: true }, prepare: { prepared: id }, flush: { flushed: id }, close: { closed: id },
      };
      queueMicrotask(() => this.emit('message', replies[op]));
    }
    async terminate() { this.emit('exit', 0); return 0; }
  },
}));

async function start(inputs: readonly ('system' | 'microphone')[] = sources) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const events: SpeechEvent[] = [];
  service = new SpeechController('synthetic', 'synthetic', event => events.push(event));
  expect(await service.call({ op: 'start', options: { sources: [...inputs] } })).toMatchObject({ state: 'running' });
  expect(children.map(child => child.source)).toEqual(inputs);
  return { service, events };
}
afterEach(async () => {
  autoClose = true;
  for (const child of children)
    if (child.exitCode === null && child.stdin.end.mock.calls.length) child.close(0);
  await service?.close();
  service = undefined;
  children.length = 0;
  received.length = 0;
  autoClose = false;
  vi.useRealTimers();
});

const invalidated = '{"type":"error","code":"0x88890004"}';
function pcm(sample: number) {
  const bytes = Buffer.alloc(25);
  bytes.writeUInt32LE(21);
  bytes[4] = 1;
  bytes.writeUInt32LE(48000, 5);
  bytes.writeFloatLE(sample, 21);
  return bytes;
}
it('delivers complete PCM before and after the recovery stop starts, then reports the device gap', async () => {
  const { service, events } = await start(['system']);
  const child = children[0];
  child.stdout.write(pcm(0.25));
  child.stderr.write(invalidated + '\n');
  child.stdout.write(pcm(0.5));
  const tail = pcm(0.75);
  child.stdout.write(tail.subarray(0, 12));
  await vi.advanceTimersByTimeAsync(0);
  expect(child.stdin.end).toHaveBeenCalledOnce();
  child.stdout.write(Buffer.concat([tail.subarray(12), pcm(1).subarray(0, 20)]));
  child.close(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(received).toEqual([0.25, 0.5, 0.75]);
  expect(events.filter(event => event.type === 'gap').map(event => event.source)).toEqual(['system']);
  expect(await service.call({ op: 'status' })).toMatchObject({ state: 'running' });
});
it.each([
  { retiring: false, overload: false }, { retiring: true, overload: false },
  { retiring: false, overload: true }, { retiring: true, overload: true },
])('a terminal tail error stops recovery (retiring=$retiring, overload=$overload)', async ({ retiring, overload }) => {
  const { service, events } = await start(['system']);
  const child = children[0];
  child.stderr.write(invalidated + '\n');
  if (retiring) await vi.advanceTimersByTimeAsync(0);
  if (overload) child.stderr.write('{"type":"error","code":"0x8007006F"}\n');
  else child.stdout.write(Buffer.alloc(4));
  child.stdout.write(pcm(0.75));
  child.close(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await service.call({ op: 'status' })).toMatchObject({
    state: 'error', failureSource: 'system',
    error: expect.stringContaining(overload ? '音频输出积压已达上限' : '音频数据包损坏'),
  });
  expect(children).toHaveLength(1);
  expect(received).toEqual([]);
  expect(events.filter(event => event.type === 'gap')).toHaveLength(0);
});
it.each([
  { diagnostic: invalidated, code: 1 },
  { diagnostic: '{"type":"error","code":"0x80070005"}', code: 1, terminal: '0x80070005' },
  { diagnostic: '{"type":"error","code":"0xDEADBEEF"}', code: 1, terminal: '0xDEADBEEF' },
  { diagnostic: '{', code: 0, terminal: '输出异常' },
  { diagnostic: '{"type":"error","code":"0x80070005"}\n' + invalidated, code: 1, terminal: '0x80070005' },
])('drains a second endpoint fault before recovery ($diagnostic, exit $code)', async ({ diagnostic, code, terminal }) => {
  const recovery = !terminal;
  const { service, events } = await start();
  const [system, mic] = children;
  system.stderr.write(invalidated + '\n');
  await vi.advanceTimersByTimeAsync(0);
  expect(system.stdin.end).toHaveBeenCalledOnce();
  expect(mic.stdin.end).toHaveBeenCalledOnce();
  system.close(1);
  mic.stderr.write(diagnostic);
  await vi.advanceTimersByTimeAsync(100);
  expect(children).toHaveLength(2);
  mic.close(code);
  await vi.advanceTimersByTimeAsync(999);
  expect(children).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  const status = await service.call({ op: 'status' });
  expect(status.state).toBe(recovery ? 'running' : 'error');
  if (terminal) expect(status).toMatchObject({
    failureSource: 'microphone', error: expect.stringContaining(terminal),
  });
  expect(children.map(child => child.source)).toEqual(recovery ? [...sources, ...sources] : sources);
  expect(events.filter(event => event.type === 'gap').map(event => event.source))
    .toEqual(recovery ? sources : []);
});

it.each([{ inputs: ['system'] }, { inputs: ['system', 'microphone'] }] as const)(
  'attributes late permission denial to the affected system endpoint with $inputs', async ({ inputs }) => {
    const { service } = await start(inputs);
    const system = children[0];
    const first = children.at(-1)!;
    first.stderr.write(invalidated + '\n');
    await vi.advanceTimersByTimeAsync(0);
    expect(system.stdin.end).toHaveBeenCalledOnce();
    if (first !== system) first.close(1);
    system.stderr.write('{"type":"error","code":"0x80070005"}');
    system.close(1);
    const status = await service.call({ op: 'status' });
    expect(status).toMatchObject({ state: 'error', failureSource: 'system', error: expect.stringContaining('0x80070005') });
  },
);

it('surfaces a failed drain when a manual stop receives a late invalidated endpoint', async () => {
  const { service, events } = await start();
  const rejected = expect(service.call({ op: 'stop' })).rejects.toThrow('未能正常停止');
  await vi.advanceTimersByTimeAsync(0);
  expect(children.every(child => child.stdin.end.mock.calls.length === 1)).toBe(true);
  children[0].close(0);
  children[1].stderr.write(invalidated);
  children[1].close(1);
  await rejected;
  await vi.advanceTimersByTimeAsync(10000);
  expect(children).toHaveLength(2);
  expect(events.filter(event => event.type === 'gap')).toHaveLength(0);
});

it.each([true, false])('a reconnect diagnosis cannot excuse a forced or unconfirmed close (closes on kill: %s)', async closesOnKill => {
  const { service, events } = await start();
  const [system, mic] = children;
  system.stderr.write(invalidated + '\n');
  await vi.advanceTimersByTimeAsync(0);
  expect(mic.stdin.end).toHaveBeenCalledOnce();
  system.close(1);
  mic.stderr.write('{"type":"error","code":"0x80070005"}\n');
  if (closesOnKill) mic.kill.mockImplementation(() => mic.close(1));
  await vi.advanceTimersByTimeAsync(10000);
  expect(mic.kill).toHaveBeenCalledOnce();
  expect(await service.call({ op: 'status' })).toMatchObject({
    state: 'error', failureSource: 'service', error: expect.stringContaining('未能正常停止'),
  });
  expect(children).toHaveLength(2);
  expect(events.filter(event => event.type === 'gap')).toHaveLength(0);
});
