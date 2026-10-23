import { useEffect, useRef, useState, type RefObject } from 'react';
import type { GlassButtonAction } from '../../shared/electron/contracts/desktop';
import { materialColor } from './materialGeometry';

// Shared HTML retains semantics and actions. This hook only places a native
// material control over its existing layout slot and forwards native activation.
export function useGlassControl(
  ref: RefObject<HTMLButtonElement | null>,
  kind: GlassButtonAction,
  enabled: boolean,
  disabled: boolean,
  activate: (enabled: boolean) => void,
) {
  const [native, setNative] = useState(false);
  const current = useRef({ enabled, disabled, activate });
  current.current = { enabled, disabled, activate };
  const synchronize = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const desktop = window.desktop;
    const element = ref.current!;
    if (!desktop) return;
    let disposed = false,
      frame = 0;
    let working = false,
      pending = false,
      applied = '';
    let transitionUntil = 0;
    const covered = () => {
      const modal = [...document.querySelectorAll('dialog[open]')].at(-1);
      if (modal && !modal.contains(element)) return true;
      const rect = element.getBoundingClientRect();
      const menus = [...document.querySelectorAll('[role="menu"][data-state="open"]')];
      return menus.some((menu) => {
        const area = menu.getBoundingClientRect();
        return (
          area.left < rect.right &&
          area.right > rect.left &&
          area.top < rect.bottom &&
          area.bottom > rect.top
        );
      });
    };
    const visible = () => {
      const rect = element.getBoundingClientRect();
      const panel = element.closest('.settings-content-body')?.getBoundingClientRect();
      return (
        element.isConnected &&
        element.getClientRects().length > 0 &&
        rect.x >= 0 &&
        rect.right <= innerWidth &&
        rect.top >= Math.max(0, panel?.top ?? 0) &&
        rect.bottom <= Math.min(innerHeight, panel?.bottom ?? innerHeight)
      );
    };
    const hide = () => desktop.setGlassButton(kind, null);
    const update = async () => {
      pending = true;
      if (working) return;
      working = true;
      while (pending && !disposed) {
        pending = false;
        try {
          const rect = element.getBoundingClientRect();
          const placement = visible()
            ? {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                enabled: current.current.enabled,
              }
            : null;
          const value = placement && {
            ...placement,
            disabled: current.current.disabled,
            behindContent: covered(),
            hovered: element.matches(':hover'),
            pressed: element.matches(':active'),
            foregroundColor: materialColor(
              element,
              document.documentElement.classList.contains('macos-window-inactive')
                ? '--muted'
                : kind === 'start'
                  ? '--accent'
                  : '--foreground',
            ),
          };
          const key = JSON.stringify(value);
          if (key === applied) continue;
          const active = await desktop.setGlassButton(
            kind,
            value as import('../../shared/electron/contracts/desktop').GlassButtonPlacement | null,
          );
          applied = key;
          if (!disposed) setNative(active);
        } catch {
          applied = '';
          if (!disposed) {
            setNative(false);
            void hide().catch(() => {});
          }
        }
      }
      working = false;
    };
    synchronize.current = update;
    const schedule = () => {
      if (frame || disposed) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        void update();
        if (performance.now() < transitionUntil) schedule();
      });
    };
    const resize = new ResizeObserver(schedule);
    for (let target: Element | null = element; target; target = target.parentElement)
      resize.observe(target);
    const popups = new MutationObserver(schedule);
    popups.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-state', 'open', 'hidden', 'class', 'aria-expanded'],
    });
    const appearance = new MutationObserver(schedule);
    appearance.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    const activated = (value: boolean) => {
      if (!disposed && visible() && !covered() && !current.current.disabled) {
        if (document.querySelector('[role="menu"][data-state="open"]'))
          element.dispatchEvent(
            new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }),
          );
        current.current.activate(value);
        if (element.isConnected) element.focus({ preventScroll: true });
      }
    };
    const remove = desktop.onGlassButton((action) => {
      if (action === kind) activated(true);
    });
    const transition = () => {
      transitionUntil = performance.now() + 350;
      schedule();
    };
    document.addEventListener('transitionrun', transition, true);
    const pointerEvents = ['pointerover', 'pointerout', 'pointerdown', 'pointerup'] as const;
    for (const event of pointerEvents) document.addEventListener(event, schedule, true);
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    schedule();
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      popups.disconnect();
      appearance.disconnect();
      remove();
      document.removeEventListener('transitionrun', transition, true);
      for (const event of pointerEvents) document.removeEventListener(event, schedule, true);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
      synchronize.current = async () => {};
      void hide().catch(() => {});
      window.removeEventListener('beforeunload', dispose);
    };
    window.addEventListener('beforeunload', dispose);
    return dispose;
  }, [kind]);
  useEffect(() => {
    void synchronize.current();
  }, [enabled, disabled]);
  return { native, synchronize };
}
