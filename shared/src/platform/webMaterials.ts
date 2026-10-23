import { headerCoverage } from './chromeGeometry';
import './webMaterials.css';

// Shared fallback for Windows, older macOS and unavailable native materials.
// Native adapters announce successful installation with their bounded scope.
export function installWebMaterials() {
  const root = document.documentElement;
  let frame = 0;
  const refresh = () => {
    const fallback = !root.matches('.sidebar-liquid-glass,.macos-interview-glass');
    if (root.classList.contains('web-materials') !== fallback)
      root.classList.toggle('web-materials', fallback);
    if (!fallback) return;
    const workspace = document.querySelector(
      '.preparation-route:not([hidden]) .preparation-workspace, .management-page',
    );
    const toolbar = workspace?.querySelector('.page-toolbar');
    const column = workspace?.querySelector('.chat-column') ?? workspace;
    const opacity = toolbar && column ? headerCoverage(column, toolbar.getBoundingClientRect()) : 0;
    const value = String(opacity);
    if (root.style.getPropertyValue('--web-header-opacity') !== value)
      root.style.setProperty('--web-header-opacity', value);
  };
  const schedule = () => {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        refresh();
      });
  };
  const scope = new MutationObserver(schedule);
  scope.observe(root, { attributes: true, attributeFilter: ['class'] });
  const content = new MutationObserver(schedule);
  content.observe(document.getElementById('root')!, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', schedule, true);
  refresh();
  const dispose = () => {
    cancelAnimationFrame(frame);
    scope.disconnect();
    content.disconnect();
    window.removeEventListener('resize', schedule);
    document.removeEventListener('scroll', schedule, true);
  };
  window.addEventListener('beforeunload', dispose, { once: true });
  return dispose;
}
