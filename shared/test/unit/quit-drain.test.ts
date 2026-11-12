import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { guardQuitDrain } from '../../electron/window';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function application() {
  const events = new EventEmitter();
  const prevented: boolean[] = [];
  const quit = vi.fn(() => {
    let blocked = false;
    events.emit('will-quit', {
      preventDefault: () => {
        blocked = true;
      },
    });
    prevented.push(blocked);
  });
  return { events, prevented, quit, on: events.on.bind(events) };
}

it('反复退出仍等待同一批 writer，全部结束后才放行退出', async () => {
  const app = application();
  const image = deferred(),
    usage = deferred();
  const drain = vi.fn(() => Promise.allSettled([image.promise, usage.promise]));
  guardQuitDrain(app, drain);
  app.quit();
  app.quit();
  await Promise.resolve();
  expect(drain).toHaveBeenCalledOnce();
  expect(app.prevented).toEqual([true, true]);
  image.resolve();
  await image.promise;
  app.quit();
  expect(app.prevented).toEqual([true, true, true]);
  expect(drain).toHaveBeenCalledOnce();
  usage.resolve();
  await vi.waitFor(() => expect(app.prevented).toEqual([true, true, true, false]));
  app.quit();
  expect(app.prevented.at(-1)).toBe(false);
  expect(drain).toHaveBeenCalledOnce();
});

it('意外退休失败不提前放行，后续退出可重新等待', async () => {
  const app = application();
  const drain = vi
    .fn()
    .mockRejectedValueOnce(Error('synthetic failure'))
    .mockResolvedValueOnce(undefined);
  guardQuitDrain(app, drain);
  app.quit();
  await vi.waitFor(() => expect(drain).toHaveBeenCalledOnce());
  app.quit();
  await vi.waitFor(() => expect(app.prevented).toEqual([true, true, false]));
  expect(drain).toHaveBeenCalledTimes(2);
});
