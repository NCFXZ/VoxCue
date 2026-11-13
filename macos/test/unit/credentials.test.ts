import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: native.spawn }));
import { createCredentialEncryption } from '../../electron/credentials';
import { translateUI } from '../../../shared/electron/contracts/uiLanguage';

function englishError(error: Error) {
  const message = translateUI(error.message, 'en');
  expect(message).not.toMatch(/\p{Script=Han}/u);
  return message;
}

beforeEach(() => {
  vi.useFakeTimers();
  native.spawn.mockReset();
});
afterEach(() => vi.useRealTimers());

function fixture() {
  const children: ReturnType<typeof child>[] = [];
  function child() {
    return Object.assign(new EventEmitter(), {
      pid: 12345,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
      kill: vi.fn(() => true),
    });
  }
  native.spawn.mockImplementation(() => {
    const value = child();
    children.push(value);
    return value;
  });
  const crypto = createCredentialEncryption('/synthetic/VoxCue.Credentials');
  const settle = () => vi.advanceTimersByTimeAsync(0);
  const reply = (index: number, value: string) => {
    children[index].stdout.emit(
      'data',
      Buffer.from(
        JSON.stringify({
          data: Buffer.from(value).toString('base64'),
        }),
      ),
    );
    children[index].emit('close', 0);
  };
  return { crypto, children, settle, reply };
}

it('serializes all vault operations through actual helper close without changing the protocol', async () => {
  const f = fixture();
  const pending = [
    f.crypto.encrypt('synthetic-cloud'),
    f.crypto.decrypt(Buffer.from('v10-synthetic-auth')),
    f.crypto.encrypt('synthetic-telemetry'),
  ];
  await f.settle();
  expect(native.spawn).toHaveBeenCalledTimes(1);
  expect(native.spawn).toHaveBeenCalledWith('/synthetic/VoxCue.Credentials', [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
  });
  f.children[0].emit('exit', 0);
  await f.settle();
  expect(native.spawn).toHaveBeenCalledTimes(1);
  f.reply(0, 'cipher-cloud');
  await f.settle();
  expect(native.spawn).toHaveBeenCalledTimes(2);
  expect(JSON.parse(f.children[1].stdin.end.mock.calls[0][0])).toEqual({
    operation: 'decrypt',
    data: Buffer.from('v10-synthetic-auth').toString('base64'),
  });
  f.reply(1, 'synthetic-auth');
  await f.settle();
  expect(native.spawn).toHaveBeenCalledTimes(3);
  f.reply(2, 'cipher-telemetry');
  expect(await Promise.all(pending)).toEqual([
    Buffer.from('cipher-cloud'),
    'synthetic-auth',
    Buffer.from('cipher-telemetry'),
  ]);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([-128, -25293, -25308, -26275])(
  'stops the whole batch after native failure %s and never reprompts in the session',
  async (status) => {
    const f = fixture();
    const failed = Promise.allSettled([
      f.crypto.encrypt('synthetic-one'),
      f.crypto.encrypt('synthetic-two'),
      f.crypto.decrypt(Buffer.from('v10-synthetic-three')),
    ]);
    await f.settle();
    f.children[0].stderr.emit(
      'data',
      Buffer.from(`VoxCue credential operation failed (${status}).\n`),
    );
    f.children[0].emit('close', 80);
    const results = await failed;
    expect(results.every((value) => value.status === 'rejected')).toBe(true);
    for (const result of results)
      if (result.status === 'rejected')
        expect(englishError(result.reason)).toContain('Restart VoxCue');
    expect(native.spawn).toHaveBeenCalledTimes(1);
    await expect(f.crypto.encrypt('synthetic-later-background-retry')).rejects.toThrow('重新启动');
    expect(native.spawn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('retries normally after an explicit restart without storing an authorization bypass', async () => {
  const f = fixture();
  const denied = f.crypto.encrypt('synthetic');
  const rejection = expect(denied).rejects.toThrow('重新启动');
  f.children[0].stderr.emit('data', Buffer.from('VoxCue credential operation failed (-128).'));
  f.children[0].emit('close', 80);
  await rejection;
  const restarted = createCredentialEncryption('/synthetic/VoxCue.Credentials');
  const first = restarted.encrypt('synthetic');
  f.reply(1, 'cipher');
  expect(await first).toEqual(Buffer.from('cipher'));
  const next = restarted.decrypt(Buffer.from('v10-synthetic'));
  await f.settle();
  f.reply(2, 'synthetic');
  expect(await next).toBe('synthetic');
  expect(native.spawn).toHaveBeenCalledTimes(3);
});

it('captures queued input and bounds pending credential work', async () => {
  const f = fixture();
  const input = Buffer.from('v10-original');
  const pending = [f.crypto.encrypt('first'), f.crypto.decrypt(input)];
  input.fill(0);
  for (let index = 2; index < 32; index++) pending.push(f.crypto.encrypt('synthetic'));
  const overflow = await f.crypto.encrypt('overflow').catch((error: Error) => error);
  expect(overflow).toBeInstanceOf(Error);
  expect(englishError(overflow as Error)).toContain('busy');
  expect(native.spawn).toHaveBeenCalledTimes(1);
  f.reply(0, 'cipher');
  await f.settle();
  expect(JSON.parse(f.children[1].stdin.end.mock.calls[0][0]).data).toBe(
    Buffer.from('v10-original').toString('base64'),
  );
  for (let index = 1; index < 32; index++) {
    f.reply(index, 'synthetic');
    await f.settle();
  }
  expect(await Promise.all(pending)).toHaveLength(32);
  expect(native.spawn).toHaveBeenCalledTimes(32);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['false', 'throw', 'synchronous-close'])(
  'finishes a timeout without trusting kill %s as retirement',
  async (mode) => {
    const f = fixture();
    const failed = Promise.allSettled([f.crypto.encrypt('one'), f.crypto.encrypt('two')]);
    f.children[0].kill.mockImplementation(() => {
      if (mode === 'throw') throw Error('synthetic signal failure');
      if (mode === 'synchronous-close') f.children[0].emit('close', null);
      return mode !== 'false';
    });
    await vi.advanceTimersByTimeAsync(120000);
    expect((await failed).every((value) => value.status === 'rejected')).toBe(true);
    await expect(f.crypto.encrypt('later')).rejects.toThrow('重新启动');
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.children[0].kill.mock.calls).toEqual(
      mode === 'synchronous-close' ? [['SIGTERM']] : [['SIGTERM'], ['SIGKILL']],
    );
    expect(native.spawn).toHaveBeenCalledTimes(1);
    if (mode !== 'synchronous-close') f.children[0].emit('close', null);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('sanitizes synchronous spawn failure and cancels queued work', async () => {
  const f = fixture();
  native.spawn.mockImplementation(() => {
    throw Error('synthetic-private-diagnostic');
  });
  const results = await Promise.allSettled([f.crypto.encrypt('one'), f.crypto.encrypt('two')]);
  for (const result of results) {
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason.message).toContain('重新启动');
      expect(result.reason.message).not.toContain('synthetic-private-diagnostic');
    }
  }
  expect(native.spawn).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('releases the owned helper on parent exit and removes the exit hook on close', async () => {
  const existing = new Set(process.listeners('exit'));
  const f = fixture();
  const failed = Promise.allSettled([f.crypto.encrypt('one'), f.crypto.encrypt('two')]);
  const hooks = process.listeners('exit').filter((listener) => !existing.has(listener));
  expect(hooks).toHaveLength(1);
  hooks[0](0);
  expect(f.children[0].kill).toHaveBeenCalledWith('SIGKILL');
  f.children[0].emit('close', null);
  expect((await failed).every((value) => value.status === 'rejected')).toBe(true);
  expect(process.listeners('exit').filter((listener) => !existing.has(listener))).toEqual([]);
  expect(native.spawn).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not release another helper on error or exit before actual close', async () => {
  const f = fixture();
  const failed = Promise.allSettled([f.crypto.encrypt('one'), f.crypto.encrypt('two')]);
  await f.settle();
  f.children[0].emit('error', Error('synthetic child failure'));
  f.children[0].emit('exit', 1);
  await f.settle();
  expect(native.spawn).toHaveBeenCalledTimes(1);
  f.children[0].emit('close', 1);
  expect((await failed).every((value) => value.status === 'rejected')).toBe(true);
  expect(native.spawn).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('times out once, fences an unclosed helper and stops automatic permission retries', async () => {
  const f = fixture();
  const failed = Promise.allSettled([f.crypto.encrypt('one'), f.crypto.encrypt('two')]);
  await f.settle();
  await vi.advanceTimersByTimeAsync(120000);
  expect(f.children[0].kill).toHaveBeenCalledWith('SIGTERM');
  expect(native.spawn).toHaveBeenCalledTimes(1);
  f.children[0].emit('close', null);
  expect((await failed).every((value) => value.status === 'rejected')).toBe(true);
  await expect(f.crypto.encrypt('later')).rejects.toThrow('重新启动');
  expect(native.spawn).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('never treats malformed output as completed authorization or exposes native diagnostics', async () => {
  const f = fixture();
  const failed = Promise.allSettled([f.crypto.encrypt('one'), f.crypto.encrypt('two')]);
  await f.settle();
  f.children[0].stderr.emit('data', Buffer.from('synthetic-private-diagnostic'));
  f.children[0].stdout.emit('data', Buffer.from('{"data":"not base64"}'));
  f.children[0].emit('close', 0);
  for (const result of await failed) {
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason.message).not.toContain('synthetic-private-diagnostic');
      expect(result.reason.message).toMatch(/无效/);
      expect(englishError(result.reason)).toContain('Restart VoxCue');
    }
  }
  expect(native.spawn).toHaveBeenCalledTimes(1);
});

function migrationFixture(confirm: () => Promise<boolean>) {
  const f = fixture();
  const crypto = createCredentialEncryption('/synthetic/VoxCue', confirm);
  const answer = (index: number, reply: unknown) => {
    f.children[index].stdout.emit('data', Buffer.from(JSON.stringify(reply)));
    f.children[index].emit('close', 0);
  };
  const request = (index: number) => JSON.parse(f.children[index].stdin.end.mock.calls[0][0]);
  return { ...f, crypto, answer, request };
}

it('does not cache a ready probe as permission to skip future preflight', async () => {
  const confirm = vi.fn(async () => true);
  const f = migrationFixture(confirm);
  const pending = [f.crypto.decrypt(Buffer.from('v10-one')), f.crypto.encrypt('two')];
  await f.settle();
  expect(f.request(0)).toEqual({ operation: 'probe' });
  f.answer(0, { state: 'ready' });
  await f.settle();
  expect(f.request(1).operation).toBe('decrypt');
  f.reply(1, 'one');
  await f.settle();
  expect(f.request(2).operation).toBe('probe');
  f.answer(2, { state: 'ready' });
  await f.settle();
  expect(f.request(3).operation).toBe('encrypt');
  f.reply(3, 'cipher-two');
  expect(await Promise.all(pending)).toEqual(['one', Buffer.from('cipher-two')]);
  expect(confirm).not.toHaveBeenCalled();
  expect(native.spawn).toHaveBeenCalledTimes(4);
});

it('explains authorization when a later probe changes from ready to authorize', async () => {
  const confirm = vi.fn(async () => true);
  const f = migrationFixture(confirm);
  const first = f.crypto.decrypt(Buffer.from('v10-one'));
  f.answer(0, { state: 'ready' });
  await f.settle();
  f.reply(1, 'one');
  expect(await first).toBe('one');
  const later = f.crypto.decrypt(Buffer.from('v10-two'));
  await f.settle();
  f.answer(2, { state: 'authorize' });
  await f.settle();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(f.request(3).operation).toBe('decrypt');
  f.reply(3, 'two');
  expect(await later).toBe('two');
});

it.each(['locked', 'conflict'])(
  'never starts an interactive request after a %s probe',
  async (state) => {
    const confirm = vi.fn(async () => true);
    const f = migrationFixture(confirm);
    const result = expect(f.crypto.decrypt(Buffer.from('v10-one'))).rejects.toThrow('重新启动');
    f.answer(0, { state });
    await result;
    expect(confirm).not.toHaveBeenCalled();
    await expect(f.crypto.encrypt('later')).rejects.toThrow('重新启动');
    expect(native.spawn).toHaveBeenCalledTimes(1);
  },
);

it('explains the one system authorization first and stops every request when postponed', async () => {
  const confirm = vi.fn(async () => false);
  const f = migrationFixture(confirm);
  const results = Promise.allSettled([
    f.crypto.decrypt(Buffer.from('v10-one')),
    f.crypto.encrypt('two'),
  ]);
  await f.settle();
  f.answer(0, { state: 'authorize' });
  const settled = await results;
  expect(confirm).toHaveBeenCalledTimes(1);
  for (const result of settled) {
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(englishError(result.reason)).toContain('paused');
  }
  await expect(f.crypto.encrypt('later')).rejects.toThrow('重新启动');
  expect(native.spawn).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('continues to the single authorized request after the notice is accepted', async () => {
  const confirm = vi.fn(async () => true);
  const f = migrationFixture(confirm);
  const result = f.crypto.decrypt(Buffer.from('v10-one'));
  await f.settle();
  f.answer(0, { state: 'authorize' });
  await f.settle();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(f.request(1).operation).toBe('decrypt');
  f.reply(1, 'one');
  expect(await result).toBe('one');
  const next = f.crypto.decrypt(Buffer.from('v10-two'));
  await f.settle();
  f.reply(2, 'two');
  expect(await next).toBe('two');
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(native.spawn).toHaveBeenCalledTimes(3);
});

it('cleans up only after a ready probe and readable records, reporting partial results without latching', async () => {
  const f = migrationFixture(async () => true);
  const readable = vi.fn(async () => true);
  const maintained = f.crypto.maintain(readable);
  await f.settle();
  f.answer(0, { state: 'ready' });
  await f.settle();
  expect(readable).toHaveBeenCalledTimes(1);
  expect(f.request(1)).toEqual({ operation: 'cleanup' });
  const partial = { cleanup: 'partial', removed: 2, retained: 1, reason: 'authorization' };
  f.answer(1, partial);
  expect(await maintained).toEqual(partial);
  const later = f.crypto.encrypt('still-usable');
  await f.settle();
  expect(f.request(2)).toEqual({ operation: 'probe' });
  f.answer(2, { state: 'ready' });
  await f.settle();
  f.reply(3, 'cipher');
  expect(await later).toEqual(Buffer.from('cipher'));
});

it('validates stored records through the dedicated non-interactive native operation', async () => {
  const confirm = vi.fn(async () => true);
  const f = migrationFixture(confirm);
  const maintained = f.crypto.maintain(async (decrypt) => {
    expect(await decrypt(Buffer.from('v10-cloud'))).toBe('cloud');
    expect(await decrypt(Buffer.from('v10-auth'))).toBe('auth');
    return true;
  });
  f.answer(0, { state: 'ready' });
  await f.settle();
  expect(f.request(1)).toEqual({
    operation: 'validate',
    data: Buffer.from('v10-cloud').toString('base64'),
  });
  f.reply(1, 'cloud');
  await f.settle();
  expect(f.request(2).operation).toBe('validate');
  f.reply(2, 'auth');
  await f.settle();
  expect(f.request(3)).toEqual({ operation: 'cleanup' });
  const complete = { cleanup: 'complete', removed: 3, retained: 0, reason: 'none' };
  f.answer(3, complete);
  expect(await maintained).toEqual(complete);
  expect(confirm).not.toHaveBeenCalled();
});

it.each(['unavailable', 'invalid'])(
  'defers cleanup after validation %s without preventing foreground credentials',
  async (validation) => {
    const confirm = vi.fn(async () => true);
    const f = migrationFixture(confirm);
    const maintained = f.crypto.maintain(async (decrypt) => {
      await decrypt(Buffer.from('v10-stored'));
      return true;
    });
    f.answer(0, { state: 'ready' });
    await f.settle();
    f.answer(1, { validation });
    expect(await maintained).toBeUndefined();
    expect(native.spawn).toHaveBeenCalledTimes(2);
    const later = f.crypto.decrypt(Buffer.from('v10-foreground'));
    await f.settle();
    f.answer(2, { state: 'authorize' });
    await f.settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    f.reply(3, 'foreground');
    expect(await later).toBe('foreground');
  },
);

it('permits explicit sign-in writes after a closed native ciphertext decoding failure', async () => {
  const f = fixture();
  const damaged = expect(f.crypto.decrypt(Buffer.from('v10-damaged'))).rejects.toThrow('重新登录');
  f.children[0].stderr.emit('data', Buffer.from('VoxCue credential operation failed (-26275).\n'));
  f.children[0].emit('close', 80);
  await damaged;
  const restored = f.crypto.encrypt('explicit-new-sign-in');
  await f.settle();
  f.reply(1, 'new-cipher');
  expect(await restored).toEqual(Buffer.from('new-cipher'));
  expect(vi.getTimerCount()).toBe(0);
});

it('does not clean up when a record reader catches an unavailable validation', async () => {
  const f = migrationFixture(async () => true);
  const maintained = f.crypto.maintain(async (decrypt) => {
    await decrypt(Buffer.from('v10-stored')).catch(() => undefined);
    return true;
  });
  f.answer(0, { state: 'ready' });
  await f.settle();
  f.answer(1, { validation: 'unavailable' });
  expect(await maintained).toBeUndefined();
  expect(native.spawn).toHaveBeenCalledTimes(2);
});

it.each([
  ['authorize', true],
  ['locked', true],
  ['conflict', true],
  ['ready', false],
])('never cleans up after probe %s or unreadable records', async (state, readableResult) => {
  const f = migrationFixture(async () => true);
  const readable = vi.fn(async () => readableResult);
  const maintained = f.crypto.maintain(readable);
  await f.settle();
  f.answer(0, { state });
  expect(await maintained).toBeUndefined();
  expect(readable).toHaveBeenCalledTimes(state === 'ready' ? 1 : 0);
  expect(native.spawn).toHaveBeenCalledTimes(1);
});

it.each([
  { state: 'unknown' },
  { state: 'ready', extra: 1 },
  { cleanup: 'complete', removed: -1, retained: 0, reason: 'none' },
  { cleanup: 'complete', removed: 1, retained: 1, reason: 'none' },
  { cleanup: 'partial', removed: 0, retained: 1, reason: 'authorization' },
  { cleanup: 'partial', removed: 32, retained: 1, reason: 'authorization' },
  { cleanup: 'deferred', removed: 1, retained: 1, reason: 'current' },
])('treats malformed maintenance output %j as an invalid helper response', async (reply) => {
  const f = migrationFixture(async () => true);
  const maintained = f.crypto.maintain(async () => true);
  await f.settle();
  if ('cleanup' in reply) {
    f.answer(0, { state: 'ready' });
    await f.settle();
    f.answer(1, reply);
  } else f.answer(0, reply);
  await expect(maintained).rejects.toThrow('无效');
  await expect(f.crypto.encrypt('later')).rejects.toThrow('重新启动');
});

it.each([{ validation: 'unknown' }, { validation: 'invalid', data: '' }])(
  'fences malformed non-interactive validation output %j',
  async (reply) => {
    const f = migrationFixture(async () => true);
    const maintained = f.crypto.maintain(async (decrypt) => {
      await decrypt(Buffer.from('v10-stored'));
      return true;
    });
    f.answer(0, { state: 'ready' });
    await f.settle();
    f.answer(1, reply);
    await expect(maintained).rejects.toThrow('无效');
    await expect(f.crypto.encrypt('later')).rejects.toThrow('重新启动');
    expect(native.spawn).toHaveBeenCalledTimes(2);
  },
);
