import { readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import {
  defaultShortcuts,
  shortcutActions,
  validateShortcutBindings,
  type ShortcutBindings,
} from '../contracts/shortcuts';

export async function readShortcuts(
  file: string,
  mac: boolean,
): Promise<{ bindings: ShortcutBindings; error: string | null }> {
  try {
    if ((await stat(file)).size > 8192) throw Error('Oversized shortcut settings');
    const source = await readFile(file, 'utf8');
    if (source.length > 8192) throw Error('Oversized shortcut settings');
    const value = JSON.parse(source);
    if (value?.version !== 1 && value?.version !== 2) throw Error('Invalid shortcut version');
    const bindings = validateShortcutBindings(value.bindings, mac);
    if (value.version === 1) {
      const defaults = defaultShortcuts();
      for (const action of shortcutActions) {
        const previous =
          action === 'screenshot'
            ? mac
              ? 'Control+S'
              : 'Alt+S'
            : defaults[action]?.replace('Control+Shift+', 'Control+Alt+');
        if (bindings[action] === previous) bindings[action] = defaults[action];
      }
    }
    return { bindings, error: null };
  } catch (error) {
    return {
      bindings: defaultShortcuts(),
      error:
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? null
          : '快捷键设置读取失败，已使用默认设置。',
    };
  }
}
export async function writeShortcuts(file: string, bindings: ShortcutBindings) {
  const temporary = file + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify({ version: 2, bindings }), { mode: 0o600 });
    await rename(temporary, file);
  } catch {
    await unlink(temporary).catch(() => {});
    throw Error('快捷键设置保存失败，请重试。');
  }
}
