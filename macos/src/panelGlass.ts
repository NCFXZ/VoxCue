import type { InterviewMaterialPlacement } from '../../shared/electron/contracts/desktop';
import { materialOpacity } from './materialGeometry';
import { readLiquidGlass, subscribeLiquidGlass } from './liquidGlassPreference';

// The login has no top-layer dialog. Punch only its CSS background paint,
// keeping all sample text in the shared renderer above the native materials.
function loginCutout(outer: DOMRect, card: DOMRect) {
  const x = card.x - outer.x,
    y = card.y - outer.y;
  return `path(evenodd, "M0 0H${outer.width}V${outer.height}H0Z M${x} ${y}H${x + card.width}V${y + card.height}H${x}Z")`;
}

// Shared panes and the interview preview retain their DOM, layout and input.
// AppKit draws only their backplates beneath Chromium's transparent paint.
if (
  window.desktop?.platform === 'macos' &&
  window.desktop.presentation?.liquidGlass === true &&
  (!location.hash || location.hash === '#login')
) {
  const desktop = window.desktop,
    root = document.documentElement;
  const login = location.hash === '#login';
  const accessibility = [
    matchMedia('(prefers-reduced-transparency: reduce)'),
    matchMedia('(prefers-contrast: more)'),
    matchMedia('(forced-colors: active)'),
  ];
  const selector =
    '.personal-panel,.record-answer-panel,.interview-preview-scene,.interview-preview-scene :is(.floating-toolbar,.floating-panel,.transcript-item > p,.floating-question,.answer-bubble,.floating-composer)';
  const ids = new WeakMap<Element, number>();
  let serial = 0,
    frame = 0,
    disposed = false,
    working = false,
    applied = '',
    until = 0;
  let painted: HTMLElement[] = [];
  let queued:
    | {
        materials: InterviewMaterialPlacement[];
        elements: HTMLElement[];
        dialog: HTMLElement | null;
        cutout: string;
        bodyCutout: string;
        loginCutout: string;
      }
    | undefined;
  const clear = () => {
    for (const element of painted) element.classList.remove('macos-native-panel-material');
    painted = [];
    root.style.removeProperty('--macos-preview-page-cutout');
    root.classList.remove('macos-login-preview');
    root.style.removeProperty('--macos-login-preview-cutout');
    for (const dialog of document.querySelectorAll<HTMLElement>('[data-native-preview]')) {
      delete dialog.dataset.nativePreview;
      dialog.style.removeProperty('--macos-preview-cutout');
    }
  };
  const flush = async () => {
    if (working || disposed) return;
    working = true;
    while (queued && !disposed) {
      const next = queued;
      queued = undefined;
      const key = JSON.stringify([next.materials, next.cutout, next.bodyCutout, next.loginCutout]);
      if (key === applied) continue;
      try {
        const active = await desktop.setInterviewMaterials(next.materials);
        applied = key;
        for (const element of painted)
          if (!active || !next.elements.includes(element))
            element.classList.remove('macos-native-panel-material');
        painted = active ? next.elements : [];
        for (const element of painted)
          if (!element.classList.contains('macos-native-panel-material'))
            element.classList.add('macos-native-panel-material');
        for (const dialog of document.querySelectorAll<HTMLElement>('[data-native-preview]'))
          if (!active || dialog !== next.dialog) {
            delete dialog.dataset.nativePreview;
            dialog.style.removeProperty('--macos-preview-cutout');
          }
        if (active && next.dialog) {
          next.dialog.dataset.nativePreview = 'true';
          next.dialog.style.setProperty('--macos-preview-cutout', next.cutout);
          root.style.setProperty('--macos-preview-page-cutout', next.bodyCutout);
        } else root.style.removeProperty('--macos-preview-page-cutout');
        root.classList.toggle('macos-login-preview', active && !!next.loginCutout);
        if (active && next.loginCutout) {
          root.style.setProperty('--macos-login-preview-cutout', next.loginCutout);
        } else {
          root.style.removeProperty('--macos-login-preview-cutout');
        }
      } catch {
        // Restore legible shared surfaces when a native update fails. Leaving
        // transparent markers behind would expose an unrelated stale backplate.
        clear();
        applied = '';
      }
    }
    working = false;
  };
  const read = () => {
    frame = 0;
    const materials: InterviewMaterialPlacement[] = [],
      elements: HTMLElement[] = [];
    const enabled = login
      ? readLiquidGlass() && !accessibility.some((media) => media.matches)
      : root.classList.contains('sidebar-liquid-glass');
    let preview: HTMLElement | null = null;
    if (enabled)
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        if (
          !element.getClientRects().length ||
          element.closest('[hidden]') ||
          getComputedStyle(element).visibility === 'hidden'
        )
          continue;
        // The neutral login background covers the whole right column. An
        // interior scene-shaped cutout would leave two unnecessary seams.
        const loginScene = login && element.matches('.interview-preview-scene');
        const geometry = loginScene ? element.closest<HTMLElement>('.login-preview')! : element;
        const area = geometry.getBoundingClientRect();
        let left = Math.max(0, area.left),
          top = Math.max(0, area.top),
          right = Math.min(innerWidth, area.right),
          bottom = Math.min(innerHeight, area.bottom);
        for (let parent = geometry.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent),
            box = parent.getBoundingClientRect();
          if (/(auto|hidden|scroll|clip)/.test(css.overflowX)) {
            left = Math.max(left, box.left);
            right = Math.min(right, box.right);
          }
          if (/(auto|hidden|scroll|clip)/.test(css.overflowY)) {
            top = Math.max(top, box.top);
            bottom = Math.min(bottom, box.bottom);
          }
        }
        if (right <= left || bottom <= top || area.width <= 0 || area.height <= 0) continue;
        let id = ids.get(element);
        if (!id) ids.set(element, (id = ++serial));
        const css = getComputedStyle(geometry);
        materials.push({
          id,
          style: element.matches('.interview-preview-scene')
            ? login
              ? 'preview-login-scene'
              : 'preview-scene'
            : element.matches('.floating-toolbar,.floating-panel')
              ? 'clear'
              : 'regular',
          radius: parseFloat(css.borderTopLeftRadius) || 0,
          round: css.getPropertyValue('corner-shape') === 'round',
          dark:
            login && element.matches('.interview-preview-scene')
              ? root.classList.contains('dark')
              : !!element.closest('.interview-preview-scene'),
          x: area.x,
          y: area.y,
          width: area.width,
          height: area.height,
          clip: { x: left, y: top, width: right - left, height: bottom - top },
          fadeBottom: 0,
          opacity: Number(css.opacity) * materialOpacity(element),
        });
        elements.push(element);
        preview ??= element.closest<HTMLElement>('.interview-preview-scene');
      }
    const dialog = preview?.closest<HTMLElement>('dialog') ?? null;
    let cutout = '',
      bodyCutout = '';
    if (preview && dialog) {
      const box = dialog.getBoundingClientRect(),
        scene = preview.getBoundingClientRect(),
        scroll = preview.closest('.settings-content-body')!.getBoundingClientRect();
      const x = Math.max(scene.left, scroll.left) - box.left,
        y = Math.max(scene.top, scroll.top) - box.top;
      const r = Math.min(scene.right, scroll.right) - box.left,
        b = Math.min(scene.bottom, scroll.bottom) - box.top;
      const body = document.querySelector('.app-body')!.getBoundingClientRect();
      bodyCutout = `path(evenodd, "M0 0H${body.width}V${body.height}H0Z M${x + box.left - body.left} ${y + box.top - body.top}H${r + box.left - body.left}V${b + box.top - body.top}H${x + box.left - body.left}Z")`;
      cutout = `path(evenodd, "M0 0H${box.width}V${box.height}H0Z M${x} ${y}H${r}V${b}H${x}Z")`;
    }
    if (dialog?.hasAttribute('data-native-preview')) {
      dialog.style.setProperty('--macos-preview-cutout', cutout);
      root.style.setProperty('--macos-preview-page-cutout', bodyCutout);
    }
    const shell = preview?.closest<HTMLElement>('.login-shell');
    const card = preview?.closest<HTMLElement>('.login-preview');
    const loginBackground =
      shell && card ? loginCutout(shell.getBoundingClientRect(), card.getBoundingClientRect()) : '';
    if (root.classList.contains('macos-login-preview')) {
      root.style.setProperty('--macos-login-preview-cutout', loginBackground);
    }
    queued = {
      materials,
      elements,
      dialog,
      cutout,
      bodyCutout,
      loginCutout: loginBackground,
    };
    void flush();
    if (performance.now() < until) update();
  };
  const update = () => {
    if (frame || disposed) return;
    frame = requestAnimationFrame(read);
  };
  const synchronizeScroll = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (!disposed) read();
  };
  document.addEventListener('voxcue-native-scroll', synchronizeScroll);
  const resize = new ResizeObserver(update);
  const locate = () => {
    resize.disconnect();
    const observed = new Set<Element>();
    for (const element of document.querySelectorAll(selector))
      for (let node: Element | null = element; node; node = node.parentElement)
        if (!observed.has(node)) {
          observed.add(node);
          resize.observe(node);
        }
    update();
  };
  const changes = new MutationObserver((records) => {
    if (
      records.every(
        (record) =>
          record.type === 'attributes' &&
          record.target instanceof HTMLElement &&
          ((record.attributeName === 'class' &&
            (record.oldValue ?? '').replace(/\bmacos-native-panel-material\b/g, '').trim() ===
              record.target.className.replace(/\bmacos-native-panel-material\b/g, '').trim()) ||
            (record.attributeName === 'style' && record.target.matches('[data-native-preview]'))),
      )
    )
      return;
    if (records.some((record) => record.type === 'childList')) locate();
    else update();
  });
  changes.observe(document.getElementById('root')!, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['open', 'hidden', 'class', 'style', 'inert'],
  });
  const appearance = new MutationObserver(update);
  appearance.observe(root, { attributes: true, attributeFilter: ['class'] });
  const transition = () => {
    until = performance.now() + 350;
    update();
  };
  document.addEventListener('transitionrun', transition, true);
  document.addEventListener('scroll', update, true);
  window.addEventListener('resize', update);
  const unsubscribe = subscribeLiquidGlass(update);
  for (const media of accessibility) media.addEventListener('change', update);
  locate();
  const dispose = () => {
    disposed = true;
    document.removeEventListener('voxcue-native-scroll', synchronizeScroll);
    cancelAnimationFrame(frame);
    resize.disconnect();
    changes.disconnect();
    appearance.disconnect();
    unsubscribe();
    for (const media of accessibility) media.removeEventListener('change', update);
    clear();
    document.removeEventListener('transitionrun', transition, true);
    document.removeEventListener('scroll', update, true);
    window.removeEventListener('resize', update);
    void desktop.setInterviewMaterials([]).catch(() => {});
  };
  window.addEventListener('beforeunload', dispose, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(dispose);
}
