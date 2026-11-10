import { useEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { interviewPanelAnimation, playInterviewTranscript } from './ui/interview-panel-animation';

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
  const nativeVisible = useRef(true);
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
    if (
      !node ||
      disposed.current ||
      !nativeVisible.current ||
      document.visibilityState === 'hidden' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return Promise.resolve();
    const player = node.animate(frames, {
      duration,
      easing: interviewPanelAnimation.easing,
      fill: 'both',
    });
    players.current.add(player);
    // A native hide can suspend Chromium's compositor after the motion starts.
    const timer = setTimeout(() => player.cancel(), duration + 100);
    return player.finished
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => clearTimeout(timer));
  };
  const run = async (kind: Motion, change: () => Promise<void>) => {
    if (busy.current || disposed.current || !canStart()) return;
    busy.current = true;
    setMotion(kind);
    try {
      nativeVisible.current = (await window.desktop!.interviewState()).visible;
      if (disposed.current) return;
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
  const { open, fold, collapseDuration, expandDuration } = interviewPanelAnimation;
  // Preserve the panels' continuous corners and shadows throughout the motion.
  // An inset(... round ...) animation adds a different, circular clipping contour.
  return {
    motion,
    busy,
    toggleCollapsed: () =>
      run(collapsed ? 'expand' : 'collapse', async () => {
        if (!collapsed) {
          await Promise.all([
            play(shell.current?.querySelector('.floating-panels'), [open, fold], collapseDuration),
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
              play(shell.current?.querySelector('.floating-panels'), [fold, open], expandDuration),
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
        if (collapsed) {
          const actual = await window.desktop!.setInterviewTranscriptVisible(!transcriptVisible);
          if (!disposed.current) setTranscriptVisible(actual);
          return;
        }
        if (transcriptVisible) {
          await playInterviewTranscript(
            shell.current?.querySelector('.floating-panels'),
            false,
            play,
          );
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
          await playInterviewTranscript(
            shell.current?.querySelector('.floating-panels'),
            true,
            play,
          );
        }
      }),
  };
}
