import { useEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';

type Motion = 'collapse' | 'expand' | 'hide-transcript' | 'show-transcript';

// Shrink native windows only after content leaves. Grow them before content enters.
// The existing bounded window commands remain the authority for final layout.
export function useInterviewPanelMotion({
  shell,
  collapsed,
  transcriptVisible,
  setCollapsed,
  setTranscriptVisible,
  canStart,
  onError,
}: {
  shell: RefObject<HTMLDivElement | null>;
  collapsed: boolean;
  transcriptVisible: boolean;
  setCollapsed(value: boolean): void;
  setTranscriptVisible(value: boolean): void;
  canStart(): boolean;
  onError(message: string): void;
}) {
  const [motion, setMotion] = useState<Motion | null>(null);
  const busy = useRef(false);
  const disposed = useRef(false);
  const players = useRef(new Set<Animation>());
  const clear = () => {
    for (const player of players.current) player.cancel();
    players.current.clear();
  };
  useEffect(() => {
    disposed.current = false;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => {
      if (preference.matches) clear();
    };
    preference.addEventListener('change', changed);
    return () => {
      disposed.current = true;
      clear();
      preference.removeEventListener('change', changed);
    };
  }, []);
  const play = (node: Element | null | undefined, frames: Keyframe[], duration: number) => {
    if (!node || disposed.current || matchMedia('(prefers-reduced-motion: reduce)').matches)
      return Promise.resolve();
    const player = node.animate(frames, {
      duration,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'both',
    });
    players.current.add(player);
    return player.finished.then(
      () => undefined,
      () => undefined,
    );
  };
  const run = async (kind: Motion, change: () => Promise<void>) => {
    if (busy.current || disposed.current || !canStart()) return;
    busy.current = true;
    setMotion(kind);
    try {
      await change();
    } catch {
      // A failed/late IPC may still have changed the native canvas. Reconcile
      // from its confirmed state rather than leaving an invisible larger window.
      if (!disposed.current) {
        try {
          const actual = await window.desktop!.interviewState();
          if (!disposed.current)
            flushSync(() => {
              setCollapsed(actual.collapsed);
              setTranscriptVisible(actual.transcriptVisible);
            });
        } catch {
          /* The window may already be closing. */
        }
        if (!disposed.current) onError('窗口切换失败，请重试。');
      }
    } finally {
      clear();
      busy.current = false;
      if (!disposed.current) setMotion(null);
    }
  };
  const fold = {
    opacity: 0,
    transform: 'translateY(-14px)',
  };
  // Preserve the panels' continuous corners and shadows throughout the motion.
  // An inset(... round ...) animation adds a different, circular clipping contour.
  const open = { opacity: 1, transform: 'translateY(0)' };
  return {
    motion,
    busy,
    toggleCollapsed: () =>
      run(collapsed ? 'expand' : 'collapse', async () => {
        if (!collapsed) {
          await Promise.all([
            play(shell.current?.querySelector('.floating-panels'), [open, fold], 220),
            play(
              shell.current?.querySelector('.floating-notices'),
              [{ opacity: 1 }, { opacity: 0 }],
              140,
            ),
          ]);
          if (disposed.current) return;
          flushSync(() => setCollapsed(true));
          clear();
          const actual = await window.desktop!.toggleInterviewCollapse();
          if (!disposed.current) setCollapsed(actual);
        } else {
          const actual = await window.desktop!.toggleInterviewCollapse();
          if (disposed.current) return;
          flushSync(() => setCollapsed(actual));
          if (!actual)
            await Promise.all([
              play(shell.current?.querySelector('.floating-panels'), [fold, open], 280),
              play(
                shell.current?.querySelector('.floating-notices'),
                [{ opacity: 0 }, { opacity: 1 }],
                200,
              ),
            ]);
        }
      }),
    toggleTranscript: () =>
      run(transcriptVisible ? 'hide-transcript' : 'show-transcript', async () => {
        const hidden = {
          opacity: 0,
          transform: 'translateX(-18px)',
        };
        const visible = {
          opacity: 1,
          transform: 'translateX(0)',
        };
        const offset = () => {
          const panel = shell.current!.querySelector('.floating-answer')!.getBoundingClientRect();
          const frame = shell.current!.querySelector('.floating-panels')!.getBoundingClientRect();
          return frame.x + frame.width / 2 - panel.x - panel.width / 2;
        };
        if (transcriptVisible) {
          await Promise.all([
            play(shell.current?.querySelector('.floating-transcript'), [visible, hidden], 200),
            play(
              shell.current?.querySelector('.floating-answer'),
              [{ transform: 'translateX(0)' }, { transform: `translateX(${offset()}px)` }],
              240,
            ),
          ]);
          if (disposed.current) return;
          flushSync(() => setTranscriptVisible(false));
          clear();
          const actual = await window.desktop!.setInterviewTranscriptVisible(false);
          if (!disposed.current) setTranscriptVisible(actual);
        } else {
          const actual = await window.desktop!.setInterviewTranscriptVisible(true);
          if (disposed.current) return;
          flushSync(() => setTranscriptVisible(actual));
          if (!actual) return;
          await Promise.all([
            play(shell.current?.querySelector('.floating-transcript'), [hidden, visible], 240),
            play(
              shell.current?.querySelector('.floating-answer'),
              [{ transform: `translateX(${offset()}px)` }, { transform: 'translateX(0)' }],
              240,
            ),
          ]);
        }
      }),
  };
}
