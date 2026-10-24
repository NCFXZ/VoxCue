import { headerCoverage } from '../../shared/src/platform/chromeGeometry';
import { materialColor, materialOpacity } from './materialGeometry';
import type { ScrollChromeState } from '../../shared/electron/contracts/desktop';

if (
  window.desktop?.platform === 'macos' &&
  window.desktop.presentation?.liquidGlass === true &&
  !location.hash
) {
  const desktop = window.desktop,
    root = document.documentElement;
  let disposed = false,
    frame = 0,
    queued: ScrollChromeState | null | undefined,
    working = false,
    applied = '',
    settleUntil = 0;
  let followHovered = false;
  const rectangle = (element: Element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  };
  const flush = async () => {
    if (working || disposed) return;
    working = true;
    while (queued !== undefined && !disposed) {
      const state = queued;
      queued = undefined;
      const key = JSON.stringify(state);
      if (key === applied) continue;
      try {
        const native = await desktop.setScrollChrome(state);
        applied = key;
        if (!disposed) root.classList.toggle('native-scroll-chrome', native && !!state);
      } catch (error) {
        console.error('native scroll chrome', error);
        // A resize can invalidate in-flight geometry before the renderer gets
        // its new viewport. The previous native surface is still installed;
        // keep it alive and retry once with fresh layout instead of destroying
        // the composer projection and its focused editor.
        const retry = !!applied && !disposed;
        applied = '';
        if (retry) update();
      }
    }
    working = false;
  };
  const update = () => {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const workspace = document.querySelector<HTMLElement>(
        '.preparation-route:not([hidden]) .preparation-workspace, .management-page, .history-detail',
      );
      const column = workspace?.querySelector('.chat-column') ?? workspace;
      const toolbar = workspace?.querySelector('.page-toolbar');
      const title = toolbar?.querySelector('strong');
      const composer = workspace?.querySelector('.macos-composer-slot');
      const follow = workspace?.querySelector('.macos-follow-slot');
      const modal = [...document.querySelectorAll('dialog[open]')].at(-1);
      if (
        root.classList.contains('sidebar-liquid-glass') &&
        column &&
        toolbar &&
        (!composer || composer.getClientRects().length)
      ) {
        const area = rectangle(workspace!),
          form = composer ? rectangle(composer) : null;
        const header = toolbar.getBoundingClientRect();
        if (
          area.x >= 0 &&
          area.y >= 0 &&
          area.width > 0 &&
          (!form ||
            (form.width > 0 &&
              form.height > 0 &&
              form.x >= 0 &&
              form.y >= 0 &&
              form.y + form.height <= innerHeight + 1))
        )
          queued = {
            area,
            title: title ? rectangle(title) : null,
            titleText: title?.textContent?.trim() ?? '',
            titleOpacity: title ? materialOpacity(title) : 0,
            composer: form,
            follow: follow?.getClientRects().length ? rectangle(follow) : null,
            followHovered: !!follow?.getClientRects().length && followHovered,
            modal: modal ? rectangle(modal) : null,
            modalRadius: modal ? parseFloat(getComputedStyle(modal).borderTopLeftRadius) : 0,
            topHeight: toolbar.getBoundingClientRect().height,
            headerOpacity: headerCoverage(column, header),
            foregroundColor: materialColor(
              root,
              root.classList.contains('macos-window-inactive') ? '--muted' : '--foreground',
            ),
          };
      } else queued = null;
      void flush();
      if (performance.now() < settleUntil) update();
    });
  };
  const resize = new ResizeObserver(update);
  const locate = () => {
    settleUntil = performance.now() + 400;
    resize.disconnect();
    for (const element of document.querySelectorAll(
      '.chat-column,.chat-scroll,.chat-thread,.macos-composer-slot,.macos-follow-slot,.page-toolbar,.management-page,.management-scroll,.management-container,dialog[open]',
    ))
      resize.observe(element);
    update();
  };
  let fadingUntil = 0;
  const fade = () => {
    fadingUntil = performance.now() + 400;
    const tick = () => {
      update();
      if (!disposed && performance.now() < fadingUntil) requestAnimationFrame(tick);
    };
    tick();
  };
  document.addEventListener('transitionrun', fade, true);
  const changes = new MutationObserver(locate);
  changes.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'open'],
  });
  const appearance = new MutationObserver(update);
  appearance.observe(root, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', update);
  const emphasizeFollow = (event: Event) => {
    followHovered = !!(event as CustomEvent).detail;
    update();
  };
  document.addEventListener('voxcue-follow-emphasis', emphasizeFollow);
  document.addEventListener('scroll', update, true);
  locate();
  const dispose = () => {
    disposed = true;
    document.removeEventListener('voxcue-follow-emphasis', emphasizeFollow);
    cancelAnimationFrame(frame);
    resize.disconnect();
    changes.disconnect();
    document.removeEventListener('transitionrun', fade, true);
    appearance.disconnect();
    window.removeEventListener('resize', update);
    document.removeEventListener('scroll', update, true);
    root.classList.remove('native-scroll-chrome');
    void desktop.setScrollChrome(null).catch(() => {});
  };
  window.addEventListener('beforeunload', dispose, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(dispose);
}
