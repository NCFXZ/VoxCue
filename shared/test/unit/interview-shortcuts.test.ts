import { describe, expect, it, vi } from 'vitest';
import {
  registerInterviewShortcuts,
  interviewShortcutsBounds,
} from '../../electron/interviewShortcuts';

it('anchors help to the active screen work area, independently of panel dimensions or screen origin', () => {
  const screen = { x: -1920, y: 120, width: 1920, height: 1040 };
  expect(interviewShortcutsBounds(screen)).toEqual({
    x: -1904,
    y: 764,
    width: 360,
    height: 380,
  });
  expect(interviewShortcutsBounds({ x: 20, y: 30, width: 300, height: 200 })).toEqual({
    x: 36,
    y: 46,
    width: 268,
    height: 168,
  });
  expect(interviewShortcutsBounds(screen, true)).toEqual({
    x: -1904,
    y: 764,
    width: 300,
    height: 380,
  });
});

function setup({ fail = '', throws = false, ready = true } = {}) {
  const state = { visible: true, destroyed: false, ready };
  const callbacks = new Map<string, () => void>();
  // An unrelated registration belongs to another feature and must survive.
  const registered = new Set(['Control+Alt+Shift+F24']);
  const registry = {
    register: vi.fn((key: string, callback: () => void) => {
      callbacks.set(key, callback);
      if (key === fail) {
        if (throws) throw Error('OS registration failed');
        return false;
      }
      registered.add(key);
      return true;
    }),
    unregister: vi.fn((key: string) => registered.delete(key)),
  };
  const window = {
    isDestroyed: () => state.destroyed,
    isVisible: () => state.visible,
    hide: vi.fn(() => {
      state.visible = false;
    }),
    showInactive: vi.fn(() => {
      state.visible = true;
    }),
  };
  const command = vi.fn();
  const conflicts = vi.fn();
  const start = () =>
    registerInterviewShortcuts({
      registry,
      window,
      ready: () => state.ready,
      command,
      onConflicts: conflicts,
    });
  return { state, callbacks, registered, registry, window, command, conflicts, start };
}

describe('interview global shortcut ownership', () => {
  it('hides and restores the entire native window without requesting focus or changing panels', () => {
    const fixture = setup();
    const dispose = fixture.start();
    expect([...fixture.callbacks.keys()]).toEqual([
      'Control+Shift+H',
      'Control+Shift+P',
      'Control+Shift+T',
      'Control+Shift+M',
      'Control+Shift+A',
      'Control+Shift+Enter',
      'Control+Shift+Up',
      'Control+Shift+Down',
      'Control+Shift+S',
    ]);
    fixture.callbacks.get('Control+Shift+H')!();
    expect(fixture.state.visible).toBe(false);
    expect(fixture.window.hide).toHaveBeenCalledOnce();
    fixture.callbacks.get('Control+Shift+P')!();
    fixture.callbacks.get('Control+Shift+T')!();
    expect(fixture.command.mock.calls).toEqual([['toggle-panels'], ['toggle-transcript']]);
    fixture.command.mockClear();
    fixture.callbacks.get('Control+Shift+H')!();
    expect(fixture.window.showInactive).toHaveBeenCalledOnce();
    fixture.callbacks.get('Control+Shift+P')!();
    fixture.callbacks.get('Control+Shift+T')!();
    expect(fixture.command.mock.calls).toEqual([['toggle-panels'], ['toggle-transcript']]);
    dispose();
    expect([...fixture.registered]).toEqual(['Control+Alt+Shift+F24']);
  });

  it('does nothing before the loaded window has been shown, or after destruction/disposal', () => {
    const fixture = setup({ ready: false });
    const dispose = fixture.start();
    fixture.state.visible = false;
    for (const callback of fixture.callbacks.values()) callback();
    expect(fixture.window.showInactive).not.toHaveBeenCalled();
    expect(fixture.command).not.toHaveBeenCalled();
    fixture.state.ready = true;
    fixture.callbacks.get('Control+Shift+H')!();
    expect(fixture.state.visible).toBe(true);
    fixture.state.destroyed = true;
    fixture.callbacks.get('Control+Shift+H')!();
    fixture.callbacks.get('Control+Shift+T')!();
    expect(fixture.window.hide).not.toHaveBeenCalled();
    dispose();
    dispose();
    fixture.state.destroyed = false;
    for (const callback of fixture.callbacks.values()) callback();
    expect(fixture.window.hide).not.toHaveBeenCalled();
    expect(fixture.command).not.toHaveBeenCalled();
    expect(fixture.registry.unregister.mock.calls).toEqual([
      ['Control+Shift+H'],
      ['Control+Shift+P'],
      ['Control+Shift+T'],
      ['Control+Shift+M'],
      ['Control+Shift+A'],
      ['Control+Shift+Enter'],
      ['Control+Shift+Up'],
      ['Control+Shift+Down'],
      ['Control+Shift+S'],
    ]);
  });

  it('dispatches every action while hidden without revealing either window', () => {
    const fixture = setup();
    fixture.start();
    fixture.state.visible = false;
    fixture.callbacks.get('Control+Shift+M')!();
    fixture.callbacks.get('Control+Shift+A')!();
    fixture.callbacks.get('Control+Shift+Up')!();
    fixture.callbacks.get('Control+Shift+Down')!();
    fixture.callbacks.get('Control+Shift+P')!();
    fixture.callbacks.get('Control+Shift+T')!();
    fixture.callbacks.get('Control+Shift+S')!();
    expect(fixture.command.mock.calls).toEqual([
      ['toggle-microphone'], ['toggle-system-audio'], ['scroll-device-up'], ['scroll-device-down'],
      ['toggle-panels'], ['toggle-transcript'], ['screenshot'],
    ]);
    expect(fixture.window.showInactive).not.toHaveBeenCalled();
    fixture.state.ready = false;
    fixture.callbacks.get('Control+Shift+M')!();
    expect(fixture.command).toHaveBeenCalledTimes(7);
  });

  it('dispatches input submission while visible or fully hidden without revealing or focusing the window', () => {
    const fixture = setup();
    const dispose = fixture.start();
    fixture.callbacks.get('Control+Shift+Enter')!();
    fixture.state.visible = false;
    fixture.callbacks.get('Control+Shift+Enter')!();
    expect(fixture.command.mock.calls).toEqual([['submit-input'], ['submit-input']]);
    expect(fixture.state.visible).toBe(false);
    expect(fixture.window.showInactive).not.toHaveBeenCalled();
    expect(fixture.window.hide).not.toHaveBeenCalled();
    fixture.state.ready = false;
    fixture.callbacks.get('Control+Shift+Enter')!();
    fixture.state.ready = true;
    fixture.state.destroyed = true;
    fixture.callbacks.get('Control+Shift+Enter')!();
    dispose();
    fixture.state.destroyed = false;
    fixture.callbacks.get('Control+Shift+Enter')!();
    expect(fixture.command).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['Control+Shift+M', false],
    ['Control+Shift+M', true],
    ['Control+Shift+Enter', false],
    ['Control+Shift+Enter', true],
    ['Control+Shift+Down', false],
    ['Control+Shift+S', false],
    ['Control+Shift+S', true],
  ] as const)(
    'keeps the interview and other keys working on %s rejection (throws=%s)',
    (fail, throws) => {
      const fixture = setup({ fail, throws });
      const dispose = fixture.start();
      expect(fixture.registered.has('Control+Shift+H')).toBe(true);
      expect(fixture.registered.has(fail)).toBe(false);
      expect(fixture.registry.unregister).not.toHaveBeenCalled();
      expect(fixture.conflicts).toHaveBeenCalledWith([expect.objectContaining({ accelerator: fail, reason: 'unavailable' })]);
      fixture.callbacks.get('Control+Shift+H')!();
      expect(fixture.window.hide).toHaveBeenCalledOnce();
      dispose();
      expect([...fixture.registered]).toEqual(['Control+Alt+Shift+F24']);
      for (const callback of fixture.callbacks.values()) callback();
      expect(fixture.window.hide).toHaveBeenCalledOnce();
      expect(fixture.command).not.toHaveBeenCalled();
    },
  );
});
