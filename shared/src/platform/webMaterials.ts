import { headerCoverage } from './chromeGeometry';
import './webMaterials.css';

// One material and control implementation for every desktop platform.
export function installWebMaterials() {
  const root = document.documentElement;
  let frame = 0;
  const measured = new Set<Element>();
  const scrollbarWidths = new WeakMap<Element, number>();
  const setProperty = (element: HTMLElement, name: string, value: string) => {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
  };
  const refresh = () => {
    if (!root.classList.contains('web-materials')) root.classList.add('web-materials');
    const workspace = document.querySelector(
      '.preparation-route:not([hidden]) .preparation-workspace, .management-page, .history-detail',
    );
    const toolbar = workspace?.querySelector('.page-toolbar');
    const column = workspace?.querySelector('.chat-column') ?? workspace;
    const opacity = toolbar && column ? headerCoverage(column, toolbar.getBoundingClientRect()) : 0;
    const value = String(opacity);
    if (root.style.getPropertyValue('--web-header-opacity') !== value)
      root.style.setProperty('--web-header-opacity', value);
    const current = new Set<Element>();
    if (
      workspace instanceof HTMLElement &&
      toolbar instanceof HTMLElement &&
      workspace.matches('.management-page')
    ) {
      const scroll = workspace.querySelector<HTMLElement>(':scope > .management-scroll');
      if (scroll) {
        for (const node of [workspace, toolbar, scroll]) {
          current.add(node);
          if (!measured.has(node)) resize.observe(node);
        }
        setProperty(
          workspace,
          '--page-toolbar-height',
          toolbar.getBoundingClientRect().height + 'px',
        );
        setProperty(
          workspace,
          '--page-scrollbar-width',
          (scrollbarWidths.get(scroll) ?? 0) + 'px',
        );
      }
    }
    for (const panel of document.querySelectorAll<HTMLElement>(
      '.personal-panel, .record-answer-panel, .settings-content',
    )) {
      const header = panel.querySelector<HTMLElement>(':scope > header')!;
      const scroll = panel.querySelector<HTMLElement>(
        ':scope > .personal-panel-scroll, :scope > .record-answer-scroll, :scope > .settings-content-body',
      )!;
      for (const node of [panel, header, scroll]) {
        current.add(node);
        if (!measured.has(node)) resize.observe(node);
      }
      if (!panel.clientHeight || !header.clientHeight) continue;
      setProperty(panel, '--panel-header-height', header.getBoundingClientRect().height + 'px');
      setProperty(
        panel,
        '--panel-scrollbar-width',
        (scrollbarWidths.get(scroll) ?? 0) + 'px',
      );
      setProperty(
        panel,
        '--panel-header-opacity',
        String(headerCoverage(scroll, header.getBoundingClientRect(), ':scope > *')),
      );
    }
    for (const panel of document.querySelectorAll<HTMLElement>(
      '.floating-panels .floating-panel, .interview-preview-scene .floating-panel',
    )) {
      const header = panel.querySelector<HTMLElement>(':scope > header')!;
      const composer = panel.querySelector<HTMLElement>(':scope > .floating-composer');
      for (const node of [panel, header, composer]) {
        if (!node) continue;
        current.add(node);
        if (!measured.has(node)) resize.observe(node);
      }
      if (!panel.clientHeight) continue;
      // Chromium snaps borders to device pixels at fractional display scales.
      setProperty(panel, '--floating-panel-border-width', getComputedStyle(panel).borderLeftWidth);
      setProperty(panel, '--floating-header-height', header.getBoundingClientRect().height + 'px');
      setProperty(
        panel,
        '--floating-composer-height',
        (composer?.getBoundingClientRect().height ?? 0) + 'px',
      );
    }
    for (const node of measured) if (!current.has(node)) resize.unobserve(node);
    measured.clear();
    for (const node of current) measured.add(node);
  };
  const schedule = () => {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        refresh();
      });
  };
  const resize = new ResizeObserver(entries => {
    for (const entry of entries) {
      const scroll = entry.target;
      if (!scroll.matches('.management-scroll, .personal-panel-scroll, .record-answer-scroll, .settings-content-body')) continue;
      // offsetWidth and clientWidth round separately to whole CSS pixels. The
      // occupied gutter is a whole number of device pixels, including at 175% DPI.
      const style = getComputedStyle(scroll);
      const edges = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
        parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      const gutter = entry.borderBoxSize[0].inlineSize - entry.contentBoxSize[0].inlineSize - edges;
      scrollbarWidths.set(scroll, Math.max(0, Math.round(gutter * devicePixelRatio)) / devicePixelRatio);
    }
    schedule();
  });
  const scope = new MutationObserver(schedule);
  scope.observe(root, { attributes: true, attributeFilter: ['class'] });
  const content = new MutationObserver(schedule);
  // Menus portaled beside #root need the same material geometry as inline menus.
  content.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', schedule, true);
  refresh();
  const dispose = () => {
    cancelAnimationFrame(frame);
    scope.disconnect();
    content.disconnect();
    resize.disconnect();
    window.removeEventListener('resize', schedule);
    document.removeEventListener('scroll', schedule, true);
  };
  window.addEventListener('beforeunload', dispose, { once: true });
  return dispose;
}
