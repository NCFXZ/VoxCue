import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { BrowserWindow } from 'electron';
import { expect, it, vi } from 'vitest';
import { controlApiKey, promptApiKey } from '../../electron/apiKeyPrompt';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => 'C:/synthetic' } }));
vi.mock('node:child_process', () => ({ spawn }));
const field = { x: 10, y: 20, width: 220, height: 28, dark: false };
function fixture() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn(),
  });
  spawn.mockReturnValueOnce(child);
  const handle = Buffer.alloc(8);
  handle.writeBigUInt64LE(123n);
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, getNativeWindowHandle: () => handle,
    webContents: { getZoomFactor: () => 1.25, focus: vi.fn() },
  }) as unknown as BrowserWindow;
  const tab = vi.fn();
  const abort = new AbortController();
  const pending = promptApiKey(window, 'Synthetic', 'en', abort.signal, field, tab);
  return { window, child, pending, tab, abort };
}

it('uses only public process arguments and separates tab traversal from submitted credentials', async () => {
  const { window, child, pending, tab } = fixture();
  expect(spawn.mock.lastCall![1]).toEqual(['123', String(process.pid), 'Synthetic', 'en']);
  controlApiKey(window, { action: 'layout', field });
  expect(child.stdin.read().toString()).toBe('layout 12500 25000 275000 35000 17500 0\n');
  controlApiKey(window, { action: 'visibility', visible: true });
  controlApiKey(window, { action: 'visibility', visible: false });
  expect(child.stdin.read().toString()).toBe('reveal\nmask\n');
  controlApiKey(window, { action: 'submit' });
  expect(child.stdin.read().toString()).toBe('submit\n');
  child.stdout.write('ba');
  child.stdout.write('cktab\ntab\n');
  expect(tab.mock.calls).toEqual([[true], [false]]);
  child.stdout.write('submit ' + Buffer.from('synthetic-secret').toString('base64') + '\n');
  child.emit('close', 0);
  expect(await pending).toBe('synthetic-secret');
  expect(window.listenerCount('closed')).toBe(0);
  controlApiKey(window, { action: 'focus' });
  expect(child.stdin.read()).toBeNull();
});

it.each(['closed', 'aborted', 'cancel', 'broken', 'partial'])('retires the child on %s', async (action) => {
  const { window, child, pending, abort } = fixture();
  if (action === 'cancel') {
    child.stdout.write('cancel\n');
    child.emit('close', 0);
    expect(await pending).toBeNull();
  } else if (action === 'closed' || action === 'aborted') {
    if (action === 'closed') window.emit('closed');
    else abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  } else {
    if (action === 'broken') child.emit('error', Object.assign(Error('synthetic-secret'), { stdout: 'secret' }));
    else { child.stdout.write('submit Zm9v'); child.emit('close', 0); }
    await expect(pending).rejects.toThrow('无法打开 API 密钥输入窗口。');
    await expect(pending).rejects.not.toHaveProperty('cause');
  }
  expect(child.kill).toHaveBeenCalledOnce();
  expect(window.listenerCount('closed')).toBe(0);
});
