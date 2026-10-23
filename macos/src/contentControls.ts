import type { ContentControlPlacement } from '../../shared/electron/contracts/desktop';
import { materialColor, materialOpacity } from './materialGeometry';
import { readLiquidGlass } from './liquidGlassPreference';

export function applyContentRange(element: HTMLElement | undefined, value: number) {
  if (
    !(element instanceof HTMLInputElement) ||
    element.type !== 'range' ||
    !element.isConnected ||
    element.disabled ||
    !Number.isInteger(value) ||
    value < 12 ||
    value > 24
  )
    return;
  const modal = document.querySelector('dialog[open]');
  if (modal && !modal.contains(element)) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
    element,
    String(value),
  );
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

export function contentControl(
  element: HTMLElement,
  id: number,
  modal: Element | undefined | null,
): ContentControlPlacement {
  const root = document.documentElement;
  const toggle = element.getAttribute('role') === 'switch';
  const preview = element.hasAttribute('data-interview-preview-button');
  const input = element instanceof HTMLInputElement;
  const slider = input && element.type === 'range';
  const progress = element.matches('.download-ring[role="progressbar"]');
  const download = element.matches('.download-button');
  const sidebarUpdate = element.matches('.sidebar-update');
  const login = location.hash === '#login' && element.matches('.service-login');
  const cancelling =
    download &&
    getComputedStyle(element.querySelector('.download-button-cancel')!).visibility === 'visible';
  // Confirmation buttons retain both animation layers in the DOM;
  // only the current layer supplies native text and its leading icon.
  const content = element.matches('.confirm-delete')
    ? (element.querySelector<HTMLElement>(
        element.classList.contains('is-confirming')
          ? '.confirm-delete-confirm'
          : '.confirm-delete-idle',
      ) ?? element)
    : download
      ? (element.querySelector<HTMLElement>(
          cancelling ? '.download-button-cancel' : '.download-button-progress',
        ) ?? element)
      : element;
  const swatch = content.querySelector('.accent-swatch');
  const symbol = [...content.querySelectorAll<SVGElement>('svg[data-sf-symbol]')].find(
    (icon) =>
      !icon.closest('.dropdown-check') &&
      !['chevron.down', 'chevron.up.chevron.down'].includes(
        icon.getAttribute('data-sf-symbol') ?? '',
      ),
  );
  const { x, y, width, height } = element.getBoundingClientRect();
  const sourceLabel = input
    ? element.placeholder
    : progress
      ? (element.getAttribute('aria-label') ?? '')
      : content.innerText.trim().replace(/\s+/g, ' ');
  const danger =
    element.matches('.button-danger-ghost,.button-destructive') || (sidebarUpdate && cancelling);
  const accent = element.classList.contains('button-primary') || (sidebarUpdate && !download);
  // Match AppKit's actual backing surface rather than the action's shape.
  // Dialogs/settings use content controls; native glass panes and sidebar use
  // over-glass artwork, including their expanded confirmation state.
  const overGlass =
    !slider &&
    (['over-glass', 'standalone-glass'].includes(element.dataset.nativeControlStyle ?? '') ||
      (!element.closest('dialog[open]') &&
        !!element.closest('.macos-native-panel-material,.sidebar')));
  const systemForeground = !login && (accent || overGlass);
  return {
    id,
    x,
    y,
    width,
    height,
    kind: slider
      ? 'font-slider'
      : progress
        ? 'progress'
        : preview || (download && !sidebarUpdate)
          ? 'button-background'
          : toggle
            ? 'switch'
            : input
              ? 'search'
              : element.getAttribute('aria-haspopup') === 'menu'
                ? 'popup'
                : element.matches('.chat-copy')
                  ? 'button-hover'
                  : element.dataset.nativeControlStyle === 'standalone-glass'
                    ? 'button-glass'
                    : 'button',
    label: preview ? '' : sourceLabel.slice(0, 300),
    value: input
      ? element.value.slice(0, 6000)
      : progress
        ? (element.getAttribute('aria-valuenow') ?? '')
        : '',
    symbol: login
      ? 'brand.chatgpt'
      : preview
        ? null
        : (symbol?.getAttribute('data-sf-symbol') ?? (swatch ? 'circle.fill' : null)),
    symbolColor: swatch ? materialColor(swatch, 'background-color') : null,
    color: materialColor(
      danger || systemForeground ? root : element,
      danger ? '--danger' : accent ? '--accent' : systemForeground ? '--foreground' : 'color',
    ),
    disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
    covered: !!modal && !modal.contains(element),
    overGlass: preview || overGlass,
    pressed: element.matches(':active'),
    focused: element.matches(':focus-visible'),
    hovered: element.matches(':hover'),
    trailing: element.dataset.nativeSymbolPosition === 'trailing',
    opacity: materialOpacity(element),
    checked: toggle && element.getAttribute('aria-checked') === 'true',
  };
}

// AppKit paints standard content-area controls. The original shared elements
// retain trusted button/menu events, form submission and file-picker gestures.
if (
  window.desktop?.platform === 'macos' &&
  window.desktop.presentation?.liquidGlass === true &&
  (!location.hash || location.hash === '#login')
) {
  const desktop = window.desktop,
    root = document.documentElement;
  const identities = new WeakMap<Element, number>();
  let sequence = 0,
    frame = 0,
    disposed = false,
    working = false,
    applied = '';
  let elements = new Map<number, HTMLElement>();
  let queued:
    { controls: ContentControlPlacement[]; elements: Map<number, HTMLElement> } | undefined;
  const selector =
    'button,input[type="search"],input[type="range"][aria-label="面试字体大小"],[data-interview-preview-button],.download-ring[role="progressbar"]';
  const excluded =
    '.macos-material-button,.follow-latest,.user-button,.conversation-delete,.nav-item,.conversation,.knowledge-card,.history-row,.record-answer-link,.settings-sidebar nav button,.composer button,.chat-composer button,.floating-toolbar button,.floating-composer button';
  const clear = () => {
    for (const element of elements.values()) element.classList.remove('macos-content-native');
    elements.clear();
  };
  const flush = async () => {
    if (working || disposed) return;
    working = true;
    while (queued && !disposed) {
      const next = queued;
      queued = undefined;
      const key = JSON.stringify(next.controls);
      if (key === applied) continue;
      try {
        const active = await desktop.setContentControls(next.controls);
        applied = key;
        for (const [id, element] of elements)
          if (!active || !next.elements.has(id)) element.classList.remove('macos-content-native');
        if (active && !disposed) {
          elements = next.elements;
          for (const element of elements.values())
            if (!element.classList.contains('macos-content-native'))
              element.classList.add('macos-content-native');
        }
      } catch (error) {
        console.error('native content controls', error);
        clear();
        applied = '';
      }
    }
    working = false;
  };
  const visible = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect(),
      style = getComputedStyle(element);
    if (
      !element.getClientRects().length ||
      element.closest('[hidden],[inert]') ||
      style.visibility === 'hidden' ||
      rect.width < 12 ||
      rect.height < 12 ||
      rect.height > 100 ||
      rect.x < 0 ||
      rect.y < 0 ||
      rect.right > innerWidth + 1 ||
      rect.bottom > innerHeight + 1
    )
      return false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent);
      if (parent instanceof HTMLDetailsElement) {
        const summary = parent.querySelector(':scope > summary');
        if (!summary?.contains(element)) {
          // Chromium clips details through an anonymous ::details-content
          // box, which isn't represented by a DOM overflow ancestor.
          if (!parent.open) return false;
          const box = parent.getBoundingClientRect();
          if (
            rect.top < (summary?.getBoundingClientRect().bottom ?? box.top) - 1 ||
            rect.bottom >
              box.bottom - parseFloat(css.paddingBottom) - parseFloat(css.borderBottomWidth) + 1
          )
            return false;
        }
      }
      if (/(auto|scroll|hidden|clip)/.test(css.overflowY + css.overflowX)) {
        const clip = parent.getBoundingClientRect();
        if (
          rect.top < clip.top - 1 ||
          rect.bottom > clip.bottom + 1 ||
          rect.left < clip.left - 1 ||
          rect.right > clip.right + 1
        )
          return false;
      }
    }
    return true;
  };
  let fadingUntil = 0;
  const fade = () => {
    fadingUntil = performance.now() + 400;
    update();
  };
  const read = () => {
    frame = 0;
    if (disposed) return;
    const controls: ContentControlPlacement[] = [],
      next = new Map<number, HTMLElement>();
    const modal = [...document.querySelectorAll('dialog[open]')].at(-1);
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      // Keep the unhovered update progress ring alone. Only its cancel action
      // acquires a native button; the shared download guard still owns clicks.
      if (
        element.matches('.sidebar-update.download-button') &&
        getComputedStyle(element.querySelector('.download-button-cancel')!).visibility !== 'visible'
      )
        continue;
      if (
        element.matches('.floating-toolbar [data-interview-preview-button]') &&
        !element.matches(':hover,:focus-visible,:active')
      )
        continue;
      if (
        element.hasAttribute('data-native-reveal-on-hover') &&
        !element.matches(':hover,:focus-visible,:active')
      )
        continue;
      const toggle = element.getAttribute('role') === 'switch';
      if (toggle && element.dataset.nativeControlStyle !== 'switch') continue;
      if (
        !toggle &&
        !element.matches('input[type="range"]') &&
        !root.classList.contains('sidebar-liquid-glass') &&
        !(
          location.hash === '#login' &&
          (element.matches('.service-login') ||
            (root.classList.contains('macos-login-preview') &&
              element.hasAttribute('data-interview-preview-button'))) &&
          readLiquidGlass()
        )
      )
        continue;
      if (
        (element.matches(excluded) && !element.matches('.conversation-delete.is-confirming')) ||
        !visible(element) ||
        controls.length >= 256
      )
        continue;
      // Copy and the component-notice action use standard content buttons;
      // response timing/disclosures retain their shared presentation.
      if (
        element.tagName === 'BUTTON' &&
        !element.matches('.chat-copy,.components-notice button') &&
        element.dataset.nativeControlStyle !== 'over-glass' &&
        element.closest('.preparation-workspace,.floating-panel,.interview-workspace') &&
        !element.closest('.personal-panel,.app-dialog')
      )
        continue;
      let id = identities.get(element);
      if (!id) identities.set(element, (id = ++sequence));
      controls.push(contentControl(element, id, modal));
      next.set(id, element);
    }
    queued = { controls, elements: next };
    void flush();
    if (performance.now() < fadingUntil) update();
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
  const mutations = new MutationObserver((records) => {
    // Native artwork markers have no layout effect and must not schedule an
    // endless remove/add/IPC loop of their own.
    const withoutMarker = (value: string) =>
      value
        .split(/\s+/)
        .filter((name) => name && name !== 'macos-content-native')
        .sort()
        .join(' ');
    if (
      records.every(
        (record) =>
          record.type === 'attributes' &&
          record.attributeName === 'class' &&
          record.target instanceof Element &&
          withoutMarker(record.oldValue ?? '') === withoutMarker(record.target.className),
      )
    )
      return;
    if (records.some((record) => record.type === 'childList')) locate();
    else update();
  });
  mutations.observe(document.getElementById('root')!, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: [
      'class',
      'style',
      'disabled',
      'aria-expanded',
      'aria-checked',
      'data-state',
      'open',
      'hidden',
    ],
  });
  const appearance = new MutationObserver(update);
  appearance.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
  const removeSearch = desktop.onContentSearch((id, value) => {
    const input = elements.get(id);
    if (!(input instanceof HTMLInputElement) || !input.isConnected || input.disabled) return;
    const modal = [...document.querySelectorAll('dialog[open]')].at(-1);
    if (modal && !modal.contains(input)) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const removeToggle = desktop.onContentToggle((id, checked) => {
    const button = elements.get(id);
    if (
      !(button instanceof HTMLButtonElement) ||
      button.getAttribute('role') !== 'switch' ||
      !button.isConnected ||
      button.disabled
    )
      return;
    const modal = [...document.querySelectorAll('dialog[open]')].at(-1);
    if (modal && !modal.contains(button)) return;
    if ((button.getAttribute('aria-checked') === 'true') !== checked) button.click();
  });
  const removeRange = desktop.onContentRange((id, value) =>
    applyContentRange(elements.get(id), value),
  );
  const events = [
    'scroll',
    'input',
    'pointerdown',
    'pointerup',
    'focusin',
    'focusout',
    'pointerover',
    'pointerout',
    'animationstart',
    'animationend',
  ] as const;
  for (const event of events) document.addEventListener(event, update, true);
  window.addEventListener('resize', update);
  document.addEventListener('transitionrun', fade, true);
  locate();
  const dispose = () => {
    disposed = true;
    document.removeEventListener('voxcue-native-scroll', synchronizeScroll);
    cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    appearance.disconnect();
    removeSearch();
    removeToggle();
    removeRange();
    document.removeEventListener('transitionrun', fade, true);
    clear();
    for (const event of events) document.removeEventListener(event, update, true);
    window.removeEventListener('resize', update);
    void desktop.setContentControls([]).catch(() => {});
  };
  window.addEventListener('beforeunload', dispose, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(dispose);
}
