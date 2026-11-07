import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { watchTestDesktop } from '../scripts/desktop-guard.mjs';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fixture() {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() });
  const check = vi.fn();
  return { child, check, guard: watchTestDesktop(child, check) };
}

it('checks every two seconds and stops only its owned child on loss of the desktop', () => {
  const { child, check, guard } = fixture();
  const otherChild = { kill: vi.fn() };
  const locked = new Error('Locked or unknown desktop');
  check
    .mockImplementationOnce(() => {})
    .mockImplementation(() => {
      throw locked;
    });
  vi.advanceTimersByTime(1999);
  expect(check).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(check).toHaveBeenCalledOnce();
  expect(child.kill).not.toHaveBeenCalled();
  vi.advanceTimersByTime(2000);
  expect(guard.failure).toBe(locked);
  expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
  expect(otherChild.kill).not.toHaveBeenCalled();
  vi.advanceTimersByTime(10000);
  expect(check).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('retains a probe error even when the stopped child reports exit code zero', () => {
  const { child, check, guard } = fixture();
  const unavailable = new Error('Desktop probe could not determine the session');
  check.mockImplementation(() => {
    throw unavailable;
  });
  child.kill.mockImplementation(() => child.emit('exit', 0));
  vi.advanceTimersByTime(2000);
  expect(guard.failure).toBe(unavailable);
  expect(child.listenerCount('exit')).toBe(0);
  expect(child.listenerCount('error')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['exit', 'error'])('releases polling when its child emits %s', (event) => {
  const { child, check, guard } = fixture();
  child.emit(event, event === 'error' ? new Error('Child launch failed') : 1);
  vi.advanceTimersByTime(10000);
  expect(check).not.toHaveBeenCalled();
  expect(child.kill).not.toHaveBeenCalled();
  expect(guard.failure).toBeUndefined();
  expect(child.listenerCount('exit')).toBe(0);
  expect(child.listenerCount('error')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('allows explicit idempotent release before timeout cleanup without further probes', () => {
  const { child, check, guard } = fixture();
  guard.release();
  guard.release();
  vi.advanceTimersByTime(10000);
  expect(check).not.toHaveBeenCalled();
  expect(child.kill).not.toHaveBeenCalled();
  expect(child.listenerCount('exit')).toBe(0);
  expect(child.listenerCount('error')).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves both the desktop failure and an owned-child termination failure', () => {
  const { child, check, guard } = fixture();
  const locked = new Error('Desktop locked');
  const killFailed = new Error('Child termination failed');
  check.mockImplementation(() => {
    throw locked;
  });
  child.kill.mockImplementation(() => {
    throw killFailed;
  });
  vi.advanceTimersByTime(2000);
  expect(guard.failure).toBeInstanceOf(AggregateError);
  expect(guard.failure.errors).toEqual([locked, killFailed]);
  expect(vi.getTimerCount()).toBe(0);
});
