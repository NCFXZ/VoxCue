export const shortcutLabels = {
  'toggle-window': '隐藏或显示面试窗口',
  'toggle-panels': '收起或展开面试面板',
  'toggle-transcript': '显示或隐藏转写面板',
  'toggle-microphone': '打开或关闭麦克风',
  'toggle-system-audio': '打开或关闭系统音频',
  'submit-input': '发送当前输入内容',
  'scroll-device-up': '向上滚动设备内容',
  'scroll-device-down': '向下滚动设备内容',
  screenshot: '截图',
} as const;
export type ShortcutAction = keyof typeof shortcutLabels;
export const shortcutActions = Object.keys(shortcutLabels) as ShortcutAction[];
export type ShortcutBindings = Record<ShortcutAction, string | null>;
export interface ShortcutConflict {
  action: ShortcutAction;
  accelerator: string;
  reason: 'duplicate' | 'unavailable';
  other?: ShortcutAction;
}
export interface ShortcutSettingsState {
  revision: number;
  bindings: ShortcutBindings;
  conflicts: ShortcutConflict[];
  capturing: boolean;
  error: string | null;
}
export type ShortcutSettingsCall =
  | { op: 'status' | 'check' | 'reset' }
  | { op: 'capture'; active: boolean }
  | { op: 'set'; action: ShortcutAction; accelerator: string | null };
export interface ShortcutSettingsResult {
  state: ShortcutSettingsState;
  rejected?: ShortcutConflict;
}
export function validateShortcutCall(value: unknown): ShortcutSettingsCall {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid shortcut request');
  const call = value as Record<string, unknown>;
  const only = (...keys: string[]) => Object.keys(call).every((key) => keys.includes(key));
  if (['status', 'check', 'reset'].includes(call.op as string) && only('op'))
    return call as unknown as ShortcutSettingsCall;
  if (call.op === 'capture' && typeof call.active === 'boolean' && only('op', 'active'))
    return call as unknown as ShortcutSettingsCall;
  if (
    call.op === 'set' &&
    shortcutActions.includes(call.action as ShortcutAction) &&
    only('op', 'action', 'accelerator')
  )
    return {
      op: 'set',
      action: call.action as ShortcutAction,
      accelerator: normalizeShortcut(call.accelerator),
    };
  throw Error('Invalid shortcut request');
}
export function defaultShortcuts(): ShortcutBindings {
  return {
    'toggle-window': 'Control+Shift+H',
    'toggle-panels': 'Control+Shift+P',
    'toggle-transcript': 'Control+Shift+T',
    'toggle-microphone': 'Control+Shift+M',
    'toggle-system-audio': 'Control+Shift+A',
    'submit-input': 'Control+Shift+Enter',
    'scroll-device-up': 'Control+Shift+Up',
    'scroll-device-down': 'Control+Shift+Down',
    screenshot: 'Control+Shift+S',
  };
}
const modifiers = ['Control', 'Alt', 'Shift'];
export function normalizeShortcut(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 80) throw Error('无效的快捷键。');
  const parts = value.split('+');
  const key = parts.pop()!;
  if (
    !/^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Enter|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Escape|Minus|Plus|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash)$/.test(
      key,
    ) ||
    parts.some((part) => !modifiers.includes(part)) ||
    new Set(parts).size !== parts.length ||
    parts.length === 0
  )
    throw Error('快捷键需包含 Ctrl、Shift 或 Alt 中的至少一个');
  return [...modifiers.filter((part) => parts.includes(part)), key].join('+');
}
export function validateShortcutBindings(value: unknown): ShortcutBindings {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== shortcutActions.length ||
    Object.keys(value).some((key) => !shortcutActions.includes(key as ShortcutAction))
  )
    throw Error('无效的快捷键设置。');
  return Object.fromEntries(
    shortcutActions.map((action) => [
      action,
      normalizeShortcut((value as ShortcutBindings)[action]),
    ]),
  ) as ShortcutBindings;
}
export function duplicateShortcuts(bindings: ShortcutBindings): ShortcutConflict[] {
  return shortcutActions.flatMap((action) => {
    const accelerator = bindings[action];
    const other =
      accelerator && shortcutActions.find((key) => key !== action && bindings[key] === accelerator);
    return other
      ? [{ action, accelerator: accelerator!, reason: 'duplicate' as const, other }]
      : [];
  });
}
export function displayShortcut(value: string | null): string {
  return (
    value
      ?.replace(/Control/g, 'Ctrl')
      .replace(/Command/g, 'Cmd')
      .replace(/Super/g, 'Win')
      .replace(/\bUp$/, '↑')
      .replace(/\bDown$/, '↓')
      .replace(/\bLeft$/, '←')
      .replace(/\bRight$/, '→') ?? '未设置'
  );
}
function shortcutAccelerator(
  event: {
    key: string;
    code?: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
  },
  mac = false,
): string {
  const aliases: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    '-': 'Minus',
    '+': 'Plus',
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
    ';': 'Semicolon',
    "'": 'Quote',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '\\': 'Backslash',
  };
  const physical = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code ?? '');
  const key = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'Dead', 'Unidentified'].includes(
    event.key,
  )
    ? ''
    : physical
      ? (physical[1] ?? physical[2])
      : /^[A-Za-z0-9]$/.test(event.key)
        ? event.key.toUpperCase()
        : (aliases[event.key] ?? event.key);
  return [
    ...(event.ctrlKey ? ['Control'] : []),
    ...(event.altKey ? ['Alt'] : []),
    ...(event.shiftKey ? ['Shift'] : []),
    ...(event.metaKey ? [mac ? 'Command' : 'Super'] : []),
    ...(key ? [key] : []),
  ].join('+');
}
export function shortcutPreview(event: Parameters<typeof shortcutAccelerator>[0], mac = false) {
  return displayShortcut(shortcutAccelerator(event, mac));
}
export function shortcutFromEvent(event: Parameters<typeof shortcutAccelerator>[0], mac = false) {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'Dead', 'Unidentified'].includes(event.key))
    return;
  return normalizeShortcut(shortcutAccelerator(event, mac))!;
}
export function matchesShortcut(
  value: string | null,
  event: Parameters<typeof shortcutFromEvent>[0],
  mac = false,
) {
  if (!value) return false;
  try {
    return shortcutFromEvent(event, mac) === value;
  } catch {
    return false;
  }
}
