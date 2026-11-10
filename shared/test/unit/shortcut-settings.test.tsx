import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  defaultShortcuts,
  normalizeShortcut,
  validateShortcutCall,
  shortcutFromEvent,
  shortcutPreview,
} from '../../electron/contracts/shortcuts';
import { InterviewShortcutController } from '../../electron/interviewShortcuts';
import { readShortcuts, writeShortcuts } from '../../electron/backend/shortcutPreferences';
import { ShortcutSettings } from '../../src/components/ShortcutSettings';
import { useGeneralSettings } from '../../src/stores/generalSettings';

const ui = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../../src/stores/shortcuts', () => ({
  useShortcuts: Object.assign(() => ui.value, { getState: () => ui.value }),
}));

const temporary: string[] = [];
afterEach(async () => {
  for (const folder of temporary.splice(0)) {
    expect(path.dirname(folder)).toBe(path.resolve(tmpdir()));
    await rm(folder, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
});
function setup() {
  const foreign = new Set(['Control+Shift+S']);
  const occupied = new Set(['Control+Shift+H', 'Control+Shift+Up']);
  const callbacks = new Map<string, () => void>();
  const registry = {
    register: vi.fn((key: string, callback: () => void) => {
      if (foreign.has(key) || occupied.has(key) || callbacks.has(key)) return false;
      callbacks.set(key, callback);
      return true;
    }),
    unregister: vi.fn((key: string) => {
      expect(foreign.has(key)).toBe(false);
      callbacks.delete(key);
    }),
  };
  const persist = vi.fn(async () => {});
  const controller = new InterviewShortcutController(registry, vi.fn(), persist);
  const command = vi.fn();
  const stop = controller.attach({
    window: {
      isDestroyed: () => false,
      isVisible: () => false,
      hide: vi.fn(),
      showInactive: vi.fn(),
    },
    ready: () => true,
    command,
  });
  return { controller, callbacks, occupied, registry, persist, stop, command };
}

it('starts with partial registrations, identifies exact failed keys, and retains hidden-window controls', () => {
  const f = setup();
  expect(f.controller.state().conflicts.map((item) => item.accelerator)).toEqual([
    'Control+Shift+H',
    'Control+Shift+Up',
    'Control+Shift+S',
  ]);
  f.callbacks.get('Control+Shift+Enter')!();
  expect(f.command).toHaveBeenCalledWith('submit-input');
  f.stop();
  expect(f.callbacks.size).toBe(0);
  expect(f.registry.unregister).not.toHaveBeenCalledWith('Control+Shift+S');
});

it('rejects internal duplicates and external conflicts without losing a working binding', async () => {
  const f = setup();
  const duplicate = await f.controller.save('submit-input', 'Control+Shift+M', defaultShortcuts());
  expect(duplicate.rejected).toMatchObject({
    action: 'submit-input',
    reason: 'duplicate',
    other: 'toggle-microphone',
  });
  f.occupied.add('Control+Shift+Q');
  const external = await f.controller.save('submit-input', 'Control+Shift+Q', defaultShortcuts());
  expect(external.rejected).toMatchObject({ reason: 'unavailable' });
  expect(f.persist).not.toHaveBeenCalled();
  expect(f.controller.state().bindings['submit-input']).toBe('Control+Shift+Enter');
  f.callbacks.get('Control+Shift+Enter')!();
  expect(f.command).toHaveBeenCalledOnce();
  f.stop();
});

it('still opens an interview when every global combination is unavailable', () => {
  const f = setup();
  for (const key of Object.values(defaultShortcuts())) if (key) f.occupied.add(key);
  expect(() => f.controller.check()).not.toThrow();
  expect(f.callbacks.size).toBe(0);
  expect(f.controller.state().conflicts).toHaveLength(9);
  f.stop();
});

it('suspends only owned shortcuts during capture, saves a replacement, and retries released system keys', async () => {
  const f = setup();
  const stale = f.callbacks.get('Control+Shift+Enter')!;
  f.controller.capture(true);
  expect(f.callbacks.size).toBe(0);
  stale();
  expect(f.command).not.toHaveBeenCalled();
  const rejected = await f.controller.save('submit-input', 'Control+Shift+M', defaultShortcuts());
  expect(rejected.rejected?.reason).toBe('duplicate');
  expect(f.controller.state().capturing).toBe(true);
  expect(f.controller.state().bindings['submit-input']).toBe('Control+Shift+Enter');
  const result = await f.controller.save('submit-input', 'Control+Shift+K', defaultShortcuts());
  expect(result.rejected).toBeUndefined();
  expect(f.persist).toHaveBeenCalledOnce();
  expect(f.callbacks.size).toBe(0);
  f.controller.capture(false);
  expect(f.callbacks.has('Control+Shift+Enter')).toBe(false);
  f.callbacks.get('Control+Shift+K')!();
  expect(f.command).toHaveBeenCalledWith('submit-input');
  f.occupied.clear();
  expect(f.controller.check().conflicts).toEqual([
    expect.objectContaining({ accelerator: 'Control+Shift+S' }),
  ]);
  f.stop();
});

it('does not change bindings on a failed write and can disable a key explicitly', async () => {
  const f = setup();
  f.persist.mockRejectedValueOnce(Error('Synthetic disk failure'));
  await expect(f.controller.save('submit-input', 'Control+K', defaultShortcuts())).rejects.toThrow(
    'Synthetic disk failure',
  );
  expect(f.controller.state().bindings['submit-input']).toBe('Control+Shift+Enter');
  await f.controller.save('submit-input', null, defaultShortcuts());
  expect(f.controller.state().bindings['submit-input']).toBeNull();
  expect(f.callbacks.has('Control+Shift+Enter')).toBe(false);
  f.stop();
});

it('round-trips only bounded typed preferences and handles missing or corrupt files', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'voxcue-shortcuts-'));
  temporary.push(folder);
  const file = path.join(folder, 'shortcuts.json');
  expect(await readShortcuts(file, false)).toEqual({ bindings: defaultShortcuts(), error: null });
  const bindings = {
    ...defaultShortcuts(),
    'submit-input': 'Control+Shift+K',
    screenshot: null,
  };
  await writeShortcuts(file, bindings);
  expect(await readShortcuts(file, false)).toEqual({ bindings, error: null });
  await writeFile(file, 'x'.repeat(9000));
  expect((await readShortcuts(file, true)).error).toContain('读取失败');
  expect((await readShortcuts(file, true)).bindings.screenshot).toBe('Control+Shift+S');
});

it('normalizes physical combinations and rejects unbounded or arbitrary operations', () => {
  const held = { ctrlKey: true, altKey: false, shiftKey: true, metaKey: false };
  expect(shortcutPreview({ ...held, key: 'Shift' })).toBe('Ctrl+Shift');
  expect(shortcutPreview({ ...held, key: 'M', code: 'KeyM' })).toBe('Ctrl+Shift+M');
  expect(normalizeShortcut('Alt+Control+K')).toBe('Control+Alt+K');
  for (const combination of [
    'Control+K',
    'Shift+K',
    'Alt+K',
    'Control+Shift+K',
    'Control+Alt+K',
    'Alt+Shift+K',
    'Control+Alt+Shift+K',
    'Shift+F1',
  ])
    expect(normalizeShortcut(combination)).toBe(combination);
  expect(
    shortcutFromEvent({
      key: '!',
      code: 'Digit1',
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    }),
  ).toBe('Control+Shift+1');
  for (const call of [
    { op: 'set', action: 'execute', accelerator: 'Control+K' },
    { op: 'set', action: 'submit-input', accelerator: 'K' },
    { op: 'set', action: 'submit-input', accelerator: 'F1' },
    { op: 'set', action: 'submit-input', accelerator: 'Super+K' },
    { op: 'capture', active: 'yes' },
    { op: 'status', command: 'private' },
    { op: 'set', action: 'submit-input', accelerator: 'Control+Control+K' },
  ])
    expect(() => validateShortcutCall(call)).toThrow();
});

it('updates legacy defaults while preserving customized or disabled bindings', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'voxcue-shortcuts-'));
  temporary.push(folder);
  const file = path.join(folder, 'shortcuts.json');
  const legacy = {
    'toggle-window': 'Control+Alt+H',
    'toggle-panels': 'Control+K',
    'toggle-transcript': null,
    'toggle-microphone': 'Control+Alt+M',
    'toggle-system-audio': 'Control+Alt+A',
    'submit-input': 'Control+Alt+Enter',
    'scroll-device-up': 'Control+Alt+Up',
    'scroll-device-down': 'Control+Alt+Down',
    screenshot: 'Alt+S',
  };
  for (const mac of [false, true]) {
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        bindings: {
          ...legacy,
          screenshot: mac ? 'Control+S' : 'Alt+S',
        },
      }),
    );
    expect(await readShortcuts(file, mac)).toEqual({
      error: null,
      bindings: {
        ...defaultShortcuts(),
        'toggle-panels': 'Control+K',
        'toggle-transcript': null,
      },
    });
  }
  const customized = { ...defaultShortcuts(), 'toggle-microphone': 'Control+Alt+M' };
  await writeShortcuts(file, customized);
  expect((await readShortcuts(file, false)).bindings).toEqual(customized);
});

it('shows editable bindings and per-key conflicts without blocking the rest of settings', () => {
  vi.stubGlobal('window', {});
  useGeneralSettings.setState({ language: 'zh-CN' });
  const f = setup();
  ui.value = { state: f.controller.state(), loading: false, error: null, call: vi.fn() };
  const html = renderToStaticMarkup(<ShortcutSettings />);
  expect(html).toContain('恢复默认设置');
  expect(html).not.toContain('检查冲突');
  expect(html).toContain('Ctrl+Shift+H');
  expect(html).toContain('快捷键冲突或不可用');
  expect(html).toContain('修改快捷键：发送当前输入内容');
  expect(html).not.toContain('截图快捷键仅在面试窗口显示时生效。');
  f.stop();
});

it('keeps a save error visible after recording releases native shortcuts', async () => {
  const { useShortcuts } = await vi.importActual<typeof import('../../src/stores/shortcuts')>(
    '../../src/stores/shortcuts',
  );
  const state = {
    revision: 2,
    bindings: defaultShortcuts(),
    conflicts: [],
    capturing: false,
    error: null,
  };
  const shortcutSettings = vi
    .fn()
    .mockRejectedValueOnce(Error('快捷键设置保存失败，请重试。'))
    .mockResolvedValueOnce({ state });
  vi.stubGlobal('window', { desktop: { shortcutSettings } });
  await useShortcuts
    .getState()
    .call({ op: 'set', action: 'submit-input', accelerator: 'Control+K' });
  await useShortcuts.getState().call({ op: 'capture', active: false });
  expect(useShortcuts.getState().loading).toBe(false);
  expect(useShortcuts.getState().error).toBe('快捷键设置保存失败，请重试。');
});
