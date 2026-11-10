import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { InterviewShortcutHelp } from './InterviewShortcutHelp';
import { useInterviewRendererReady } from './useInterviewRendererReady';
import { useShortcuts } from '../stores/shortcuts';

// This auxiliary surface only reads its presentation and closes itself. The
// interview owner remains responsible for speech, account and session state.
export function FloatingInterviewShortcuts() {
  const shortcutSettings = useShortcuts((state) => state.state);
  const [rendererRevision, setRendererRevision] = useState<number>();
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const surface = useRef<HTMLDivElement>(null);
  useInterviewRendererReady(rendererRevision, surface, setError);
  useEffect(() => {
    let current = true;
    let connectionReceived = false;
    active.current = true;
    const stopConnection = window.desktop?.onInterviewDeviceConnection((connected) => {
      if (!current) return;
      connectionReceived = true;
      setDeviceConnected(connected);
    });
    void window.desktop
      ?.interviewShortcutsState()
      .then((state) => {
        if (current) {
          setRendererRevision(state.rendererRevision);
          if (!connectionReceived) setDeviceConnected(state.deviceConnected);
        }
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
      stopConnection?.();
      window.removeEventListener('keydown', escape);
    };
  }, []);
  function close() {
    void window.desktop?.setInterviewShortcutsOpen(false).catch(() => {
      if (active.current) setError('窗口切换失败，请重试。');
    });
  }
  return (
    <div
      ref={surface}
      className="floating-shell floating-shortcuts-viewport"
      style={{ visibility: rendererRevision || error ? undefined : 'hidden' }}
    >
      {rendererRevision && (
        <InterviewShortcutHelp
          bindings={shortcutSettings.bindings}
          conflicts={shortcutSettings.conflicts}
          deviceConnected={deviceConnected}
          onClose={close}
        />
      )}
      {error && <p role="alert">{t(error)}</p>}
    </div>
  );
}
