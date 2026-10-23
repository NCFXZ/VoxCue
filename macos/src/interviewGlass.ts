import type {
  ContentControlPlacement,
  GlassSurfacePlacement,
  InterviewMaterialPlacement,
} from '../../shared/electron/contracts/desktop';
import { readLiquidGlass, subscribeLiquidGlass } from './liquidGlassPreference';
import { materialColor } from './materialGeometry';
import { contentControl, applyContentRange } from './contentControls';

if (
  window.desktop?.platform === 'macos' &&
  window.desktop.presentation?.liquidGlass === true &&
  location.hash === '#interview'
) {
  const desktop = window.desktop,
    root = document.documentElement;
  const identities = new WeakMap<Element, number>();
  const clearSelector = '.floating-toolbar,.floating-panel';
  const regularSelector =
    '.transcript-item > p,.floating-question,.answer-bubble,.floating-composer,.floating-notices > div,.interview-answer-failure,.follow-latest.ui-button,.floating-composer .macos-follow-slot';
  const buttonSelector =
    '.floating-toolbar button,.floating-drag-handle,.floating-panel > header button,.interview-answer-retry';
  const accessibility = [
    matchMedia('(prefers-reduced-transparency: reduce)'),
    matchMedia('(prefers-contrast: more)'),
    matchMedia('(forced-colors: active)'),
  ];
  let sequence = 0,
    frame = 0,
    disposed = false,
    working = false,
    applied = '';
  let queued:
    | {
        materials: InterviewMaterialPlacement[];
        buttons: ContentControlPlacement[];
        elements: HTMLElement[];
        controls: HTMLElement[];
      }
    | undefined;
  let painted: HTMLElement[] = [];
  let paintedControls: HTMLElement[] = [];
  let followHovered = false;
  const identity = (element: Element) => {
    let id = identities.get(element);
    if (!id) identities.set(element, (id = ++sequence));
    return id;
  };
  const rect = (element: Element): GlassSurfacePlacement => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  };
  const clear = () => {
    for (const element of painted) element.classList.remove('macos-native-interview-material');
    painted = [];
    for (const element of paintedControls) element.classList.remove('macos-content-native');
    paintedControls = [];
  };
  const flush = async () => {
    if (working || disposed) return;
    working = true;
    while (queued && !disposed) {
      const next = queued;
      queued = undefined;
      const key = JSON.stringify([next.materials, next.buttons]);
      if (key === applied) continue;
      try {
        const active = await desktop.setInterviewMaterials(next.materials);
        await desktop.setContentControls(active ? next.buttons : []);
        applied = key;
        clear();
        root.classList.toggle('macos-interview-glass', active);
        if (active) {
          painted = next.elements;
          for (const element of painted) element.classList.add('macos-native-interview-material');
          paintedControls = next.controls;
          for (const element of paintedControls) element.classList.add('macos-content-native');
        }
        document.dispatchEvent(new Event('voxcue-interview-materials-updated'));
      } catch (error) {
        console.error('native interview glass', error);
        // Keep the already-installed material during in-flight resize geometry.
        const retry = !!applied;
        applied = '';
        if (retry) schedule();
      }
    }
    working = false;
  };
  const geometry = (element: HTMLElement) => {
    if (
      !element.getClientRects().length ||
      element.closest('[hidden],dialog:not([open])') ||
      getComputedStyle(element).visibility === 'hidden'
    )
      return null;
    const area = rect(element);
    let left = Math.max(0, area.x),
      top = Math.max(0, area.y),
      right = Math.min(innerWidth, area.x + area.width),
      bottom = Math.min(innerHeight, area.y + area.height),
      fadeEnd = 0;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent),
        box = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY)) {
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
      }
      if (/(auto|scroll|hidden|clip)/.test(css.overflowX)) {
        left = Math.max(left, box.left);
        right = Math.min(right, box.right);
      }
      if (parent.matches('.floating-answer .floating-scroll')) fadeEnd = box.bottom;
    }
    if (
      right - left < 1 ||
      bottom - top < 1 ||
      area.width <= 0 ||
      area.height <= 0 ||
      area.height > 100_000
    )
      return null;
    return {
      ...area,
      clip: { x: left, y: top, width: right - left, height: bottom - top },
      fadeBottom: fadeEnd ? Math.max(0, bottom - fadeEnd + 36) : 0,
    };
  };
  const update = () => {
    const materials: InterviewMaterialPlacement[] = [],
      buttons: ContentControlPlacement[] = [],
      elements: HTMLElement[] = [],
      controls: HTMLElement[] = [];
    if (readLiquidGlass() && !accessibility.some((media) => media.matches)) {
      for (const selector of [clearSelector, regularSelector])
        for (const element of document.querySelectorAll<HTMLElement>(selector)) {
          if (element.matches('.follow-latest.ui-button') && element.closest('.floating-composer'))
            continue;
          const box = geometry(element);
          if (!box || materials.length >= 256) continue;
          const css = getComputedStyle(element);
          materials.push({
            id: identity(element),
            style:
              selector === clearSelector
                ? 'clear'
                : element.matches('.floating-composer .macos-follow-slot')
                  ? followHovered
                    ? 'regular-follow-hover'
                    : 'regular-interactive'
                  : element.matches('.floating-capture-notice')
                    ? 'regular-dark'
                    : 'regular',
            radius: element.matches('.follow-latest')
              ? box.width / 2
              : Math.min(1000, parseFloat(css.borderTopLeftRadius) || 0),
            round: css.getPropertyValue('corner-shape') === 'round',
            dark: true,
            opacity: 1,
            ...box,
          });
          elements.push(element);
        }
      const modal = document.querySelector('dialog[open]');
      if (modal && materials.length < 256) {
        const box = rect(modal),
          x = box.x - 32,
          y = box.y - 32;
        materials.push({
          id: identity(modal),
          style: 'dialog-halo',
          radius: parseFloat(getComputedStyle(modal).borderTopLeftRadius) || 0,
          round: false,
          dark: true,
          opacity: 1,
          fadeBottom: 0,
          x,
          y,
          width: box.width + 64,
          height: box.height + 64,
          clip: {
            x: Math.max(0, x),
            y: Math.max(0, y),
            width: Math.min(innerWidth, x + box.width + 64) - Math.max(0, x),
            height: Math.min(innerHeight, y + box.height + 64) - Math.max(0, y),
          },
        });
      }
      for (const element of document.querySelectorAll<HTMLElement>(buttonSelector)) {
        if (
          (element.closest('.floating-toolbar') || element.matches('.follow-latest')) &&
          !element.matches(':hover,:focus-visible,:active,.button-destructive')
        )
          continue;
        const box = geometry(element);
        if (
          !box ||
          box.width < 12 ||
          box.height < 12 ||
          box.height > 100 ||
          box.clip.width !== box.width ||
          box.clip.height !== box.height
        )
          continue;
        const { x, y, width, height } = box;
        if (element.matches('.interview-answer-retry')) {
          buttons.push({ ...contentControl(element, identity(element), modal), overGlass: true });
          controls.push(element);
          continue;
        }
        buttons.push({
          id: identity(element),
          x,
          y,
          width,
          height,
          kind: 'button-background',
          label: '',
          value: '',
          symbol: null,
          symbolColor: null,
          color: materialColor(root, '--foreground'),
          disabled: element.matches(':disabled'),
          covered: !!modal,
          overGlass: true,
          pressed: element.matches(':active') || element.getAttribute('aria-pressed') === 'true',
          focused: element.matches(':focus-visible'),
          checked: false,
          hovered: element.matches(':hover'),
          trailing: false,
          opacity: 1,
        });
        elements.push(element);
      }
      // The floating settings dialog uses the same content-area AppKit
      // controls as the main settings, while interview buttons keep their size.
      if (modal)
        for (const element of modal.querySelectorAll<HTMLElement>(
          'button,input[type="range"][aria-label="面试字体大小"]',
        )) {
          const box = geometry(element);
          if (
            !box ||
            box.height > 100 ||
            box.width < 12 ||
            box.height < 12 ||
            box.width !== box.clip.width ||
            box.height !== box.clip.height
          )
            continue;
          buttons.push(contentControl(element, identity(element), modal));
          controls.push(element);
        }
    }
    queued = { materials, buttons, elements, controls };
    void flush();
  };
  function schedule() {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  }
  const synchronizeScroll = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (!disposed) update();
  };
  document.addEventListener('voxcue-native-scroll', synchronizeScroll);
  const emphasizeFollow = (event: Event) => {
    followHovered = !!(event as CustomEvent).detail;
    schedule();
  };
  document.addEventListener('voxcue-follow-emphasis', emphasizeFollow);
  const resize = new ResizeObserver(schedule);
  const locate = () => {
    resize.disconnect();
    const nodes = new Set<Element>();
    for (const element of document.querySelectorAll(
      [clearSelector, regularSelector, buttonSelector, 'dialog[open]'].join(','),
    ))
      for (let node: Element | null = element; node; node = node.parentElement)
        if (!nodes.has(node)) {
          nodes.add(node);
          resize.observe(node);
        }
    schedule();
  };
  const withoutMarker = (value: string) =>
    value
      .split(/\s+/)
      .filter(
        (name) =>
          name && name !== 'macos-native-interview-material' && name !== 'macos-content-native',
      )
      .sort()
      .join(' ');
  const changes = new MutationObserver((records) => {
    if (
      records.every(
        (record) =>
          record.type === 'attributes' &&
          record.attributeName === 'class' &&
          record.target instanceof HTMLElement &&
          withoutMarker(record.oldValue ?? '') === withoutMarker(record.target.className),
      )
    )
      return;
    locate();
  });
  changes.observe(document.getElementById('root')!, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['class', 'style', 'hidden', 'open', 'disabled', 'aria-pressed'],
  });
  const appearance = new MutationObserver(schedule);
  appearance.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
  const unsubscribe = subscribeLiquidGlass(schedule);
  const removeRange = desktop.onContentRange((id, value) =>
    applyContentRange(
      paintedControls.find((element) => identity(element) === id),
      value,
    ),
  );
  const events = [
    'input',
    'scroll',
    'pointerdown',
    'pointerup',
    'focusin',
    'focusout',
    'pointerover',
    'pointerout',
  ] as const;
  for (const event of events) document.addEventListener(event, schedule, true);
  window.addEventListener('resize', schedule);
  for (const media of accessibility) media.addEventListener('change', schedule);
  locate();
  const dispose = () => {
    disposed = true;
    document.removeEventListener('voxcue-native-scroll', synchronizeScroll);
    document.removeEventListener('voxcue-follow-emphasis', emphasizeFollow);
    cancelAnimationFrame(frame);
    resize.disconnect();
    changes.disconnect();
    appearance.disconnect();
    unsubscribe();
    removeRange();
    clear();
    root.classList.remove('macos-interview-glass');
    for (const event of events) document.removeEventListener(event, schedule, true);
    window.removeEventListener('resize', schedule);
    for (const media of accessibility) media.removeEventListener('change', schedule);
    void desktop
      .setContentControls([])
      .then(() => desktop.setInterviewMaterials([]))
      .catch(() => {});
  };
  window.addEventListener('beforeunload', dispose, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(dispose);
}
