import { presentationDocuments } from './presentationDocuments';
import { materialColor } from './materialGeometry';

// Shared Radix state and item actions remain authoritative. On Mac, NSMenu
// supplies the actual popup, material and keyboard tracking instead of placing
// an empty glass view behind Chromium text.
if (
  window.desktop?.platform === 'macos' &&
  window.desktop.presentation?.liquidGlass === true &&
  (!location.hash || location.hash === '#interview')
) {
  const desktop = window.desktop;
  let disposed = false;
  const opened = new WeakSet<HTMLElement>();
  const locate = () => {
    const menu = document.querySelector<HTMLElement>('.dropdown-content[data-state="open"]');
    if (
      !menu ||
      opened.has(menu) ||
      !document.documentElement.matches('.sidebar-liquid-glass,.macos-interview-glass')
    )
      return;
    opened.add(menu);
    requestAnimationFrame(async () => {
      if (disposed || !menu.isConnected) return;
      const rows = [
        ...menu.querySelectorAll<HTMLElement>(
          '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="separator"]',
        ),
      ];
      if (!rows.length || rows.some((row) => row.getAttribute('aria-haspopup') === 'menu')) return;
      const rect = menu.getBoundingClientRect();
      const triggerId = menu.getAttribute('aria-labelledby');
      const trigger = presentationDocuments()
        .flatMap((doc) => [
          ...(triggerId ? [doc.getElementById(triggerId)] : []),
          ...doc.querySelectorAll<HTMLElement>('[aria-haspopup="menu"][data-state="open"]'),
        ])
        .find(
          (element) =>
            element &&
            (element.id === triggerId || element.getAttribute('aria-controls') === menu.id),
        );
      if (!trigger || rect.width < 32) return;
      const anchor = trigger.getBoundingClientRect();
      if (anchor.width <= 0 || anchor.height <= 0 || anchor.x < 0 || anchor.y < 0) return;
      menu.classList.add('macos-system-menu');
      try {
        const selected = await desktop.popUpNativeMenu({
          anchor: {
            x: anchor.x,
            y: anchor.y,
            width: anchor.width,
            height: anchor.height,
          },
          side: menu.dataset.side === 'top' ? 'top' : 'bottom',
          align: menu.dataset.align === 'end' ? 'end' : 'start',
          width: Math.min(innerWidth, rect.width),
          items: rows.map((row) => ({
            label: (row.innerText || row.textContent || '')
              .trim()
              .replace(/\s+/g, ' ')
              .slice(0, 200),
            separator: row.getAttribute('role') === 'separator',
            disabled:
              row.getAttribute('aria-disabled') === 'true' || row.hasAttribute('data-disabled'),
            checked: row.getAttribute('aria-checked') === 'true',
            symbol:
              [...row.querySelectorAll('svg[data-sf-symbol]')]
                .find((icon) => !icon.closest('.dropdown-check'))
                ?.getAttribute('data-sf-symbol') ??
              (row.querySelector('.accent-swatch') ? 'circle.fill' : null),
            symbolColor: row.querySelector('.accent-swatch')
              ? materialColor(row.querySelector('.accent-swatch')!, 'background-color')
              : null,
          })),
        });
        if (disposed || !menu.isConnected) return;
        if (selected !== null && rows[selected]?.isConnected) rows[selected].click();
        if (menu.isConnected)
          menu.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
          );
      } catch {
        // A rejected/unsupported native request keeps the ordinary shared menu.
      } finally {
        menu.classList.remove('macos-system-menu');
      }
    });
  };
  const mutations = new MutationObserver(locate);
  mutations.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-state'],
  });
  locate();
  const dispose = () => {
    disposed = true;
    mutations.disconnect();
  };
  window.addEventListener('beforeunload', dispose, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(dispose);
}
