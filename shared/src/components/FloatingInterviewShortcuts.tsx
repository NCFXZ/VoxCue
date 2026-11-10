import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { InterviewShortcutHelp } from './InterviewShortcutHelp';
import { useInterviewRendererReady } from './useInterviewRendererReady';
import { useShortcuts } from '../stores/shortcuts';
import type { InterviewShortcutsState } from '../../electron/contracts/desktop';

// This auxiliary surface reads its presentation, owns its hit area and closes itself. The
// interview owner remains responsible for speech, account and session state.
export function FloatingInterviewShortcuts() {
  const shortcutSettings = useShortcuts((state) => state.state);
  const [state, setState] = useState<InterviewShortcutsState>();
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const surface = useRef<HTMLDivElement>(null);
  useInterviewRendererReady(state?.rendererRevision, surface, setError);
  useEffect(() => {
    let current = true;
    let stateReceived = false;
    active.current = true;
    const stopState = window.desktop?.onInterviewShortcutsState((state) => {
      if (!current) return;
      stateReceived = true;
      setState(state);
    });
    void window.desktop
      ?.interviewShortcutsState()
      .then((state) => {
        if (current && !stateReceived) setState(state);
      })
      .catch(() => {
        if (current) setError('窗口切换失败，请重试。');
      });
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', escape);
    return () => {
      active.current = false;
      current = false;
      stopState?.();
      window.removeEventListener('keydown', escape);
    };
  }, []);
  useEffect(() => {
    if (!window.desktop?.presentation?.interviewMousePassthrough) return;
    let pointer: { x: number; y: number } | undefined;
    let ignored: boolean | undefined;
    const refresh = () => {
      const panel = surface.current
        ?.querySelector('.floating-shortcut-help')
        ?.getBoundingClientRect();
      if (!panel || !pointer) return;
      const ignore =
        pointer.x < panel.left ||
        pointer.x > panel.right ||
        pointer.y < panel.top ||
        pointer.y > panel.bottom;
      if (ignore !== ignored) window.desktop!.setInterviewMousePassthrough((ignored = ignore));
    };
    const move = (event: MouseEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      refresh();
    };
    const observer = new ResizeObserver(refresh);
    const panel = surface.current?.querySelector('.floating-shortcut-help');
    if (panel) observer.observe(panel);
    window.addEventListener('mousemove', move);
    return () => {
      observer.disconnect();
      window.removeEventListener('mousemove', move);
    };
  }, [state?.rendererRevision]);
  function close() {
    void window.desktop?.setInterviewShortcutsOpen(false).catch(() => {
      if (active.current) setError('窗口切换失败，请重试。');
    });
  }
  return (
    <div
      ref={surface}
      className="floating-shell floating-shortcuts-viewport"
      style={{ visibility: state?.rendererRevision || error ? undefined : 'hidden' }}
    >
      {state?.rendererRevision && (
        <InterviewShortcutHelp
          bindings={shortcutSettings.bindings}
          conflicts={shortcutSettings.conflicts}
          deviceConnected={state.deviceConnected}
          status={state}
          onClose={close}
        />
      )}
      {error && <p role="alert">{t(error)}</p>}
    </div>
  );
}
