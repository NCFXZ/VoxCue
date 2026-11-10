import type { InterviewShortcutCommand } from './contracts/desktop';
import type { Rectangle } from 'electron';
import {
  defaultShortcuts,
  duplicateShortcuts,
  shortcutActions,
  type ShortcutAction,
  type ShortcutBindings,
  type ShortcutConflict,
  type ShortcutSettingsState,
} from './contracts/shortcuts';

export function interviewShortcutsBounds(area: Rectangle, compact = false): Rectangle {
  const width = Math.min(compact ? 300 : 360, Math.max(1, area.width - 32));
  const height = Math.min(380, Math.max(1, area.height - 32));
  return { x: area.x + 16, y: area.y + area.height - height - 16, width, height };
}

export interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}
interface ShortcutSession {
  window: InterviewWindow;
  ready(): boolean;
  command(value: InterviewShortcutCommand): void;
}
interface InterviewWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  hide(): void;
  showInactive(): void;
}

/** Own only this interview's registrations; never release another feature's keys. */
export function registerInterviewShortcuts({
  registry,
  window,
  ready,
  command,
  bindings = defaultShortcuts(),
  onConflicts,
}: {
  registry: ShortcutRegistry;
  window: InterviewWindow;
  ready(): boolean;
  command(value: InterviewShortcutCommand): void;
  bindings?: ShortcutBindings;
  onConflicts?(conflicts: ShortcutConflict[]): void;
}): () => void {
  let active = true;
  const owned: string[] = [];
  const dispose = () => {
    active = false;
    for (const accelerator of owned.splice(0)) registry.unregister(accelerator);
  };
  const conflicts = duplicateShortcuts(bindings);
  for (const action of shortcutActions) {
    const accelerator = bindings[action];
    if (!accelerator || conflicts.some((item) => item.action === action))
      continue;
    const value = action === 'toggle-window' ? undefined : action;
    try {
      const registered = registry.register(accelerator, () => {
        if (!active || window.isDestroyed() || !ready()) return;
        if (value === undefined) {
          if (window.isVisible()) window.hide();
          else window.showInactive();
        } else command(value);
      });
      if (registered) owned.push(accelerator);
      else conflicts.push({ action, accelerator, reason: 'unavailable' });
    } catch {
      conflicts.push({ action, accelerator, reason: 'unavailable' });
    }
  }
  onConflicts?.(conflicts);
  return dispose;
}

/** Owns only this feature's native registrations; settings probes never release foreign keys. */
export class InterviewShortcutController {
  private bindings: ShortcutBindings;
  private conflicts: ShortcutConflict[] = [];
  private revision = 0;
  private capturing = false;
  private error: string | null = null;
  private session?: ShortcutSession;
  private release?: () => void;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    private registry: ShortcutRegistry,
    private changed: (state: ShortcutSettingsState) => void,
    private persist: (bindings: ShortcutBindings) => Promise<void>,
  ) {
    this.bindings = defaultShortcuts();
  }
  state(): ShortcutSettingsState {
    return {
      revision: this.revision,
      bindings: { ...this.bindings },
      conflicts: this.conflicts.map((item) => ({ ...item })),
      capturing: this.capturing,
      error: this.error,
    };
  }
  private publish() {
    ++this.revision;
    this.changed(this.state());
  }
  private probe(bindings: ShortcutBindings) {
    const conflicts = duplicateShortcuts(bindings);
    for (const action of shortcutActions) {
      const accelerator = bindings[action];
      if (!accelerator || conflicts.some((item) => item.action === action)) continue;
      try {
        if (this.registry.register(accelerator, () => {})) this.registry.unregister(accelerator);
        else conflicts.push({ action, accelerator, reason: 'unavailable' });
      } catch {
        conflicts.push({ action, accelerator, reason: 'unavailable' });
      }
    }
    return conflicts;
  }
  check() {
    this.release?.();
    this.release = undefined;
    const checked = this.probe(this.bindings);
    this.conflicts = checked;
    if (this.session && !this.capturing) {
      this.release = registerInterviewShortcuts({
        ...this.session,
        registry: this.registry,
        bindings: this.bindings,
        onConflicts: (actual) => {
          this.conflicts = actual;
        },
      });
    }
    this.publish();
    return this.state();
  }
  test(bindings: ShortcutBindings) {
    this.release?.();
    this.release = undefined;
    const result = this.probe(bindings);
    this.check();
    return result;
  }
  configure(bindings: ShortcutBindings, error: string | null = null) {
    this.bindings = { ...bindings };
    this.error = error;
    return this.check();
  }
  capture(active: boolean) {
    this.capturing = active;
    return this.check();
  }
  save(action: ShortcutAction | null, accelerator: string | null, defaults: ShortcutBindings) {
    const operation = this.writes.then(async () => {
      const next = action ? { ...this.bindings, [action]: accelerator } : defaults;
      if (action) {
        const rejected = this.test(next).find((item) => item.action === action);
        if (rejected) return { state: this.state(), rejected };
      }
      await this.persist(next);
      return { state: this.configure(next) };
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  attach(session: ShortcutSession) {
    this.session = session;
    this.check();
    return () => {
      if (this.session !== session) return;
      this.release?.();
      this.release = undefined;
      this.session = undefined;
      this.publish();
    };
  }
}
