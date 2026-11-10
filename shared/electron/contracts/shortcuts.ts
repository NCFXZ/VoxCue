export const shortcutLabels = {
  'toggle-window': '显示或隐藏面试窗口',
  'toggle-panels': '展开或收起面试面板',
  'toggle-transcript': '展开或收起转写面板',
  'toggle-microphone': '打开或关闭麦克风',
  'toggle-system-audio': '打开或关闭系统音频',
  'submit-input': '发送当前输入内容',
  'scroll-device-up': '向上滚动设备内容',
  'scroll-device-down': '向下滚动设备内容',
  screenshot: '截图',
} as const;
export type ShortcutAction = keyof typeof shortcutLabels;
export const interviewToggleLabels: Partial<Record<ShortcutAction, readonly [string, string]>> = {
  'toggle-window': ['显示面试窗口', '隐藏面试窗口'],
  'toggle-panels': ['展开面试面板', '收起面试面板'],
  'toggle-transcript': ['展开转写面板', '收起转写面板'],
  'toggle-microphone': ['打开麦克风', '关闭麦克风'],
  'toggle-system-audio': ['打开系统音频', '关闭系统音频'],
};
export interface InterviewShortcutStatus {
  visible: boolean;
  collapsed: boolean;
  transcriptVisible: boolean;
  microphoneMuted: boolean;
  systemAudioMuted: boolean;
}
export function interviewShortcutLabel(action: ShortcutAction, state: InterviewShortcutStatus) {
  const labels = interviewToggleLabels[action];
  if (!labels) return shortcutLabels[action];
  switch (action) {
    case 'toggle-window':
      return labels[state.visible ? 1 : 0];
    case 'toggle-panels':
      return labels[state.collapsed ? 0 : 1];
    case 'toggle-transcript':
      return labels[state.transcriptVisible ? 1 : 0];
    case 'toggle-microphone':
      return labels[state.microphoneMuted ? 0 : 1];
    case 'toggle-system-audio':
      return labels[state.systemAudioMuted ? 0 : 1];
    default:
      return shortcutLabels[action];
  }
}
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
export function validateShortcutCall(value: unknown, mac = false): ShortcutSettingsCall {
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
      accelerator: normalizeShortcut(call.accelerator, mac),
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
const macModifiers = [...modifiers, 'Command'];
export function shortcutModifierHint(mac = false): string {
  return mac
    ? '快捷键需包含 ⌃、⌥、⇧ 或 ⌘ 中的至少一个'
    : '快捷键需包含 Ctrl、Shift 或 Alt 中的至少一个';
}
export function normalizeShortcut(value: unknown, mac = false): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 80) throw Error('无效的快捷键。');
  const parts = value.split('+');
  const key = parts.pop()!;
  const allowedModifiers = mac ? macModifiers : modifiers;
  if (
    !/^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Enter|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Escape|Minus|Plus|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Backslash)$/.test(
      key,
    ) ||
    parts.some((part) => !allowedModifiers.includes(part)) ||
    new Set(parts).size !== parts.length ||
    parts.length === 0
  )
    throw Error(shortcutModifierHint(mac));
  return [...allowedModifiers.filter((part) => parts.includes(part)), key].join('+');
}
export function validateShortcutBindings(value: unknown, mac = false): ShortcutBindings {
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
      normalizeShortcut((value as ShortcutBindings)[action], mac),
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
const macShortcutSymbols: Record<string, string> = {
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Command: '⌘',
  Enter: '↩',
  Backspace: '⌫',
  Delete: '⌦',
  Escape: '⎋',
  Tab: '⇥',
  Space: '␣',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Home: '↖',
  End: '↘',
  PageUp: '⇞',
  PageDown: '⇟',
  Minus: '-',
  Plus: '+',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
};
export function displayShortcut(value: string | null, mac = false): string {
  if (mac && value)
    return value
      .split('+')
      .map((key) => macShortcutSymbols[key] ?? key)
      .join('');
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
  return displayShortcut(shortcutAccelerator(event, mac), mac);
}
export function shortcutFromEvent(event: Parameters<typeof shortcutAccelerator>[0], mac = false) {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'Dead', 'Unidentified'].includes(event.key))
    return;
  return normalizeShortcut(shortcutAccelerator(event, mac), mac)!;
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
