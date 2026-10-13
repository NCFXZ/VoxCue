import { useEffect } from 'react';

// Shared by login, main and floating interview renderers.
export function useSystemAccent() {
  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop) return;
    let active = true;
    let updated = false;
    const apply = (color: string | null) => {
      if (!active) return;
      const style = document.documentElement.style;
      if (!color || !/^#[a-f0-9]{6}$/i.test(color)) {
        style.removeProperty('--system-accent');
        return;
      }
      style.setProperty('--system-accent', color);
    };
    const unsubscribe = desktop.onSystemAccent((color) => {
      updated = true;
      apply(color);
    });
    void desktop
      .systemAccent()
      .then((color) => {
        if (!updated) apply(color);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
}
