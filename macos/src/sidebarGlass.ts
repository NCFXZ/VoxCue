import { readLiquidGlass, subscribeLiquidGlass } from './liquidGlassPreference';
import { materialColor } from './materialGeometry';
import './sidebarGlass.css';
import './scrollChrome';
import './menuGlass';
import './windowFocus';
import './contentControls';
import './interviewGlass';
import './panelGlass';
import './settingsScroll';

if (location.hash === '#interview' && window.desktop?.presentation?.liquidGlass === true)
  document.documentElement.classList.add('dark');

// Loaded only by the Mac renderer entry. Shared React owns the complete layout.
if (
  window.desktop?.platform === 'macos' &&
  window.desktop.presentation?.liquidGlass === true &&
  typeof window.desktop.setSidebarGlass === 'function' &&
  !location.hash
) {
  const desktop = window.desktop;
  const root = document.documentElement;
  const mount = document.getElementById('root')!;
  const accessibility = [
    matchMedia('(prefers-reduced-transparency: reduce)'),
    matchMedia('(prefers-contrast: more)'),
    matchMedia('(forced-colors: active)'),
  ];
  let sidebar: HTMLElement | null = null;
  let toolbar: HTMLElement | null = null;
  let disposed = false;
  let inFlight = false;
  let pending:
    { width: number; toolbarHeight: number; surfaceColor: string; dark: boolean } | undefined;
  let applied = '';
  let frame = 0;

  const flush = async () => {
    if (inFlight || disposed) return;
    inFlight = true;
    while (!disposed && pending !== undefined) {
      const { width, toolbarHeight, surfaceColor, dark } = pending;
      pending = undefined;
      const key = `${width}:${toolbarHeight}:${surfaceColor}:${dark}`;
      if (key === applied) continue;
      applied = key;
      try {
        const active = await desktop.setSidebarGlass(width, toolbarHeight, surfaceColor, dark);
        if (!disposed) root.classList.toggle('sidebar-liquid-glass', active && width > 0);
      } catch (error) {
        console.error('native sidebar glass', error);
        applied = '';
        if (!disposed) root.classList.remove('sidebar-liquid-glass');
      }
    }
    inFlight = false;
  };
  const update = () => {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const width = sidebar?.isConnected ? sidebar.getBoundingClientRect().width : 0;
      root.classList.toggle('sidebar-liquid-glass-off', !readLiquidGlass());
      root.style.setProperty('--macos-sidebar-width', `${width}px`);
      const enabled = readLiquidGlass() && !accessibility.some((media) => media.matches);
      pending = {
        dark: root.classList.contains('dark'),
        surfaceColor: materialColor(root, '--surface'),
        width: enabled ? Math.min(320, width) : 0,
        toolbarHeight:
          enabled && toolbar ? Math.min(96, toolbar.getBoundingClientRect().height) : 0,
      };
      void flush();
    });
  };
  const resize = new ResizeObserver(update);
  const locate = () => {
    const next = mount.querySelector<HTMLElement>('.app-body > .sidebar');
    const nextToolbar = mount.querySelector<HTMLElement>(
      '.preparation-route:not([hidden]) .preparation-workspace > .page-toolbar, .management-page > .page-toolbar, .history-detail > .page-toolbar',
    );
    if (next === sidebar && nextToolbar === toolbar) {
      update();
      return;
    }
    resize.disconnect();
    sidebar = next;
    toolbar = nextToolbar;
    if (toolbar) resize.observe(toolbar);
    if (sidebar) resize.observe(sidebar);
    update();
  };
  const mutations = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.type === 'attributes' ||
          [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches('.sidebar, .preparation-route, .management-page') ||
                node.querySelector('.sidebar, .preparation-route, .management-page')),
          ),
      )
    )
      locate();
  });
  mutations.observe(mount, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });
  const appearance = new MutationObserver(update);
  appearance.observe(root, { attributes: true, attributeFilter: ['class'] });
  const unsubscribe = subscribeLiquidGlass(update);
  document.addEventListener('scroll', update, true);
  for (const media of accessibility) media.addEventListener('change', update);
  locate();

  const dispose = () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    appearance.disconnect();
    unsubscribe();
    document.removeEventListener('scroll', update, true);
    for (const media of accessibility) media.removeEventListener('change', update);
    root.classList.remove('sidebar-liquid-glass');
    root.classList.remove('sidebar-liquid-glass-off');
    root.style.removeProperty('--macos-sidebar-width');
    void desktop.setSidebarGlass(0).catch(() => {});
    window.removeEventListener('beforeunload', dispose);
  };
  window.addEventListener('beforeunload', dispose);
  if (import.meta.hot) import.meta.hot.dispose(dispose);
}
