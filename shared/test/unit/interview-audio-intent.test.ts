import { expect, it, vi } from 'vitest';
import { InterviewAudioIntent } from '../../electron/application/interviewAudioIntent';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, failed) => {
    resolve = done;
    reject = failed;
  });
  return { promise, resolve, reject };
}

it('prepares and reconnects only the still-owning current operation', async () => {
  const intents = new InterviewAudioIntent();
  const prepare = vi.fn(async () => {});
  const reconnect = vi.fn(async () => ({ state: 'running' }));
  expect(await intents.begin(() => true).run(prepare, reconnect)).toEqual({ state: 'running' });
  expect(prepare).toHaveBeenCalledOnce();
  expect(reconnect).toHaveBeenCalledOnce();
});
it('a pause/stop cancellation during hardware preparation cannot restart capture afterwards', async () => {
  const intents = new InterviewAudioIntent(),
    hardware = deferred<void>();
  const reconnect = vi.fn(async () => ({ state: 'running' }));
  const attempt = intents.begin(() => true);
  const result = attempt.run(() => hardware.promise, reconnect);
  const rejected = expect(result).rejects.toThrow('已取消');
  intents.cancel();
  hardware.resolve();
  await rejected;
  expect(reconnect).not.toHaveBeenCalled();
  expect(attempt.current()).toBe(false);
});
it.each(['window', 'navigation'])(
  'rejects a prepared request whose owning %s changed even without an explicit cancellation',
  async () => {
    const intents = new InterviewAudioIntent(),
      hardware = deferred<void>();
    let owns = true;
    const reconnect = vi.fn(async () => ({ state: 'running' }));
    const result = intents.begin(() => owns).run(() => hardware.promise, reconnect);
    const rejected = expect(result).rejects.toThrow('已取消');
    owns = false;
    hardware.resolve();
    await rejected;
    expect(reconnect).not.toHaveBeenCalled();
  },
);
it('a newer microphone request supersedes an older hardware probe without blocking it', async () => {
  const intents = new InterviewAudioIntent(),
    oldHardware = deferred<void>();
  const oldReconnect = vi.fn(async () => 'old');
  const old = intents.begin(() => true).run(() => oldHardware.promise, oldReconnect);
  const rejected = expect(old).rejects.toThrow('已取消');
  expect(
    await intents
      .begin(() => true)
      .run(
        async () => {},
        async () => 'new',
      ),
  ).toBe('new');
  oldHardware.resolve();
  await rejected;
  expect(oldReconnect).not.toHaveBeenCalled();
});
it('a late hardware failure after native failure/closure is cancellation, not an error for the new operation', async () => {
  const intents = new InterviewAudioIntent(),
    hardware = deferred<void>();
  const attempt = intents.begin(() => true),
    reconnect = vi.fn(async () => 'unused');
  const result = attempt.run(() => hardware.promise, reconnect);
  const rejected = expect(result).rejects.toThrow('已取消');
  intents.cancel();
  hardware.reject(Error('Old GPU probe failed'));
  await rejected;
  expect(attempt.current()).toBe(false);
  expect(reconnect).not.toHaveBeenCalled();
});
it('does not publish a late reconnect result after pause has retired its intent', async () => {
  const intents = new InterviewAudioIntent(),
    audio = deferred<string>();
  const reconnect = vi.fn(() => audio.promise);
  const result = intents.begin(() => true).run(async () => {}, reconnect);
  const rejected = expect(result).rejects.toThrow('已取消');
  await vi.waitFor(() => expect(reconnect).toHaveBeenCalledOnce());
  intents.cancel();
  audio.resolve('old running');
  await rejected;
});
it('preserves current native preparation/reconnect failures for explicit reporting', async () => {
  const intents = new InterviewAudioIntent();
  const failure = Error('Synthetic native failure');
  const reconnect = vi.fn(async () => 'running');
  await expect(
    intents
      .begin(() => true)
      .run(async () => {
        throw failure;
      }, reconnect),
  ).rejects.toBe(failure);
  expect(reconnect).not.toHaveBeenCalled();
  await expect(
    intents
      .begin(() => true)
      .run(
        async () => {},
        async () => {
          throw failure;
        },
      ),
  ).rejects.toBe(failure);
});
