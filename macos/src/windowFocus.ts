// A presentation WebContents can own keyboard focus while the NSWindow remains
// active. Use the actual BrowserWindow focus instead of document.hasFocus().
if (window.desktop?.platform === 'macos' && !location.hash) {
  const root = document.documentElement;
  const update = (focused: boolean) => root.classList.toggle('macos-window-inactive', !focused);
  const remove = window.desktop.onWindowFocus(update);
  void window.desktop.windowFocused().then(update);
  const dispose = () => {
    remove();
    root.classList.remove('macos-window-inactive');
  };
  window.addEventListener('beforeunload', dispose, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(dispose);
}
