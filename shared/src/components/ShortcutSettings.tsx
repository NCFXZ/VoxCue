import { useEffect, useRef, useState } from 'react';
import { InterviewReveal } from './InterviewReveal';
import { t } from '../i18n';
import { useShortcuts } from '../stores/shortcuts';
import {
  shortcutActions,
  shortcutLabels,
  shortcutFromEvent,
  shortcutPreview,
  displayShortcut,
  shortcutModifierHint,
  type ShortcutAction,
} from '../../electron/contracts/shortcuts';
import { Button } from './ui/button';
import { Check, Refresh, X } from './icons';

export function ShortcutAvailabilityStatus() {
  const { state, loading, error } = useShortcuts();
  const available =
    !loading &&
    !error &&
    !state.error &&
    !state.capturing &&
    !state.conflicts.length &&
    shortcutActions.every((action) => !!state.bindings[action]);
  return (
    <span className="interview-access-status" role="status">
      {available ? <Check size={14} /> : <X size={14} />}
      {t(available ? '快捷键可用' : '部分快捷键不可用')}
    </span>
  );
}

export function ShortcutSettings() {
  const mac = window.desktop?.platform === 'macos';
  const { state, loading, error, call } = useShortcuts();
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [feedback, setFeedback] = useState<{ action: ShortcutAction; text: string } | null>(null);
  const [preview, setPreview] = useState('');
  const pendingKey = useRef<string | null | undefined>(undefined);
  const heldKey = useRef<{ key: string; code?: string } | null>(null);
  const commandHeld = useRef(false);
  const rejectedAttempt = useRef(false);
  const lastModifiers = useRef({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
  const saving = useRef(false);
  const active = useRef(true);
  const captureRequested = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (captureRequested.current || useShortcuts.getState().state.capturing)
        void useShortcuts.getState().call({ op: 'capture', active: false });
    };
  }, []);
  useEffect(() => {
    if (!state.capturing) setRecording(null);
  }, [state.capturing]);
  const cancel = () => {
    captureRequested.current = false;
    setRecording(null);
    setPreview('');
    pendingKey.current = undefined;
    heldKey.current = null;
    commandHeld.current = false;
    void call({ op: 'capture', active: false });
  };
  useEffect(() => {
    if (!recording) return;
    let sawKey = false;
    const down = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!captureRequested.current || event.repeat || event.isComposing || saving.current) return;
      if (mac && (event.key === 'Meta' || event.metaKey)) commandHeld.current = true;
      lastModifiers.current = {
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey || (mac && commandHeld.current),
      };
      rejectedAttempt.current = false;
      if (
        event.key === 'Escape' &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !event.metaKey
      ) {
        cancel();
        return;
      }
      if (!['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(event.key))
        heldKey.current = { key: event.key, code: event.code };
      const current = {
        ...lastModifiers.current,
        key: heldKey.current?.key ?? event.key,
        code: heldKey.current?.code ?? event.code,
      };
      setPreview(shortcutPreview(current, window.desktop?.platform === 'macos'));
      try {
        pendingKey.current =
          ['Backspace', 'Delete'].includes(event.key) &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.metaKey &&
          !event.shiftKey
            ? null
            : shortcutFromEvent(current, window.desktop?.platform === 'macos');
        setFeedback(null);
        sawKey = pendingKey.current !== undefined;
        if (pendingKey.current === null) setPreview('未设置');
      } catch {
        sawKey = true;
        pendingKey.current = undefined;
        rejectedAttempt.current = true;
        setPreview('');
        setFeedback({
          action: recording,
          text: shortcutModifierHint(mac),
        });
      }
    };
    const up = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (mac && event.key === 'Meta') commandHeld.current = false;
      if (!captureRequested.current || event.isComposing) return;
      const held = heldKey.current;
      const modifier = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(event.key);
      const releasingKey =
        held &&
        (held.code && event.code
          ? held.code === event.code
          : held.key.toLowerCase() === event.key.toLowerCase());
      if (releasingKey) heldKey.current = null;
      if (rejectedAttempt.current) return;
      // AppKit can omit the letter's keyup while Command is held. Preserve the
      // last complete chord and finish on Command release in that case.
      const commandChord =
        mac &&
        typeof pendingKey.current === 'string' &&
        pendingKey.current.split('+').includes('Command');
      const commandRelease = commandChord && event.key === 'Meta' && !!held;
      if (commandRelease) heldKey.current = null;
      const modifiers = {
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey:
          mac && event.key === 'Meta' ? false : event.metaKey || (mac && commandHeld.current),
      };
      const remaining = {
        ...modifiers,
        key: heldKey.current?.key ?? '',
        code: heldKey.current?.code,
      };
      setPreview(shortcutPreview(remaining, window.desktop?.platform === 'macos'));
      if (saving.current) return;
      if (modifier && heldKey.current) {
        if (!commandChord) {
          try {
            pendingKey.current = shortcutFromEvent(remaining, window.desktop?.platform === 'macos');
          } catch {
            pendingKey.current = undefined;
          }
        }
        return;
      }
      if (!modifier && held && !releasingKey) return;
      let accelerator: string | null | undefined;
      try {
        accelerator = commandRelease
          ? pendingKey.current
          : pendingKey.current === null && ['Backspace', 'Delete'].includes(event.key)
            ? null
            : shortcutFromEvent(
                { ...(held ? modifiers : lastModifiers.current), key: event.key, code: event.code },
                window.desktop?.platform === 'macos',
              );
        if (accelerator === undefined) {
          if (!sawKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey)
            setFeedback({ action: recording, text: '未捕获组合键，请重试' });
          return;
        }
      } catch {
        rejectedAttempt.current = true;
        setPreview('');
        setFeedback({ action: recording, text: shortcutModifierHint(mac) });
        return;
      }
      sawKey = true;
      pendingKey.current = undefined;
      const action = recording;
      saving.current = true;
      void (async () => {
        try {
          const result = await call({ op: 'set', action, accelerator });
          if (!active.current || !useShortcuts.getState().state.capturing) return;
          if (!result || result.rejected) {
            rejectedAttempt.current = true;
            heldKey.current = null;
            setPreview('');
          }
          if (!result) return;
          if (result.rejected) {
            setFeedback({
              action,
              text: result.rejected.reason === 'duplicate' ? '快捷键重复' : '快捷键冲突或不可用',
            });
            return;
          }
          setRecording(null);
          setFeedback(null);
          captureRequested.current = false;
          await call({ op: 'capture', active: false });
        } finally {
          saving.current = false;
        }
      })();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, [recording, call, mac]);
  return (
    <section
      className="shortcut-settings"
      aria-label={t('快捷键')}
      data-shortcut-platform={mac ? 'macos' : undefined}
    >
      {shortcutActions.map((action) => {
        const conflict = state.conflicts.find((item) => item.action === action);
        const message =
          feedback?.action === action
            ? feedback.text
            : conflict
              ? conflict.reason === 'duplicate'
                ? '快捷键重复'
                : '快捷键冲突或不可用'
              : null;
        return (
          <div className="shortcut-setting-row" key={action}>
            <div>
              <strong>{t(shortcutLabels[action])}</strong>
              <InterviewReveal resizeKey={message ?? ''}>
                {message ? (
                  <p className="danger-text" role="alert">
                    {t(message)}
                  </p>
                ) : null}
              </InterviewReveal>
            </div>
            <Button
              variant="outline"
              className="shortcut-binding"
              disabled={loading || (!!recording && recording !== action)}
              aria-label={t('修改快捷键：{0}', [t(shortcutLabels[action])])}
              aria-pressed={recording === action}
              onClick={async () => {
                if (recording) {
                  cancel();
                  return;
                }
                setFeedback(null);
                setPreview('');
                pendingKey.current = undefined;
                heldKey.current = null;
                commandHeld.current = false;
                rejectedAttempt.current = false;
                captureRequested.current = true;
                await call({ op: 'capture', active: true });
                if (active.current && useShortcuts.getState().state.capturing) setRecording(action);
              }}
            >
              <kbd>
                {recording === action
                  ? t(preview || '请按快捷键…')
                  : t(displayShortcut(state.bindings[action], mac))}
              </kbd>
            </Button>
          </div>
        );
      })}
      <InterviewReveal>
        {(error || state.error) ? (
          <p className="danger-text" role="alert">
            {t(error || state.error)}
          </p>
        ) : null}
      </InterviewReveal>
      <div className="shortcut-settings-actions">
        <Button
          variant="ghost"
          disabled={loading || !!recording}
          onClick={() => {
            setFeedback(null);
            void call({ op: 'reset' });
          }}
        >
          <Refresh size={15} />
          {t('恢复默认设置')}
        </Button>
      </div>
    </section>
  );
}
