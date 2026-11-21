import { useLayoutEffect, type RefObject } from 'react';
import type { ComponentId } from '../../../electron/contracts/components';
import { highlightLocation } from './locationHighlight';

export type SettingsTarget =
  | ComponentId
  | 'account-migration'
  | 'chatgpt'
  | 'copilot'
  | 'speech-model'
  | 'speech-device'
  | 'microphone'
  | 'system'
  | 'audio-devices'
  | 'remote-connection';

/** Some targets, such as model downloads, appear after the catalog has loaded. */
export function useSettingsTarget(
  scope: RefObject<HTMLElement | null>,
  targets?: readonly SettingsTarget[],
) {
  useLayoutEffect(() => {
    if (!targets?.length || !scope.current) return;
    const root = scope.current;
    let frame = 0;
    const cancelHighlights: Array<() => void> = [];
    const reveal = () => {
      const rows = targets
        .map((id) => root.querySelector<HTMLElement>(`[data-settings-target="${id}"]`))
        .filter((row) => row !== null);
      if (rows.length !== targets.length) return;
      observer.disconnect();
      const regions = rows.map((row) =>
        row.closest<HTMLElement>('[data-settings-highlight-group]') ?? row,
      );
      for (const region of new Set(regions)) cancelHighlights.push(highlightLocation(region));
      const actionable = rows
        .map((row) => row.querySelector<HTMLElement>('button:enabled, input:enabled'))
        .find((el) => el !== null);
      const focus = actionable ?? rows[0];
      if (!actionable) focus.tabIndex = -1;
      focus.focus({ preventScroll: true });
      const region = regions.find((item) => item.contains(focus))!;
      region.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
    };
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    });
    observer.observe(root, { childList: true, subtree: true });
    frame = requestAnimationFrame(reveal);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const cancel of cancelHighlights) cancel();
    };
  }, [scope, targets]);
}
