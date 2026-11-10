import { afterEach, expect, it, vi } from 'vitest';
const cleanups = vi.hoisted(() => [] as Array<() => void>);
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: (effect: () => () => void) => {
    cleanups.push(effect());
  },
}));
import { useMobileViewport } from '../../src/mobile/App';

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});

function setup(hasViewport = true) {
  const properties = new Map<string, string>();
  class Rule {
    selectorText = ':root';
    style = {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    };
  }
  const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 });
  const owner = Object.assign(new EventTarget(), {
    visualViewport: hasViewport ? viewport : undefined,
    innerHeight: 800,
  });
  const scrollIntoView = vi.fn();
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal('CSSStyleRule', Rule);
  vi.stubGlobal('document', {
    styleSheets: [{ cssRules: [new Rule()] }],
    activeElement: { scrollIntoView },
  });
  vi.stubGlobal('window', owner);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    frame = undefined;
  });
  useMobileViewport();
  const flush = () => {
    const current = frame;
    frame = undefined;
    current?.(0);
  };
  return { viewport, owner, properties, flush, scrollIntoView };
}

it('tracks the keyboard viewport height and pan together without scrolling the document', () => {
  const f = setup();
  f.flush();
  expect(f.properties.get('--mobile-viewport')).toBe('800px');
  f.viewport.height = 330;
  f.viewport.offsetTop = 190;
  f.viewport.dispatchEvent(new Event('resize'));
  f.viewport.dispatchEvent(new Event('scroll'));
  f.flush();
  expect(f.properties.get('--mobile-viewport')).toBe('330px');
  expect(f.properties.get('--mobile-viewport-top')).toBe('190px');
  expect(f.scrollIntoView).not.toHaveBeenCalled();
  f.viewport.height = 800;
  f.viewport.offsetTop = 0;
  f.viewport.dispatchEvent(new Event('resize'));
  f.flush();
  expect(f.properties.get('--mobile-viewport-top')).toBe('0px');
  expect(f.properties.get('--mobile-viewport')).toBe('800px');
});

it('falls back without VisualViewport and removes subscriptions on unmount', () => {
  const f = setup(false);
  f.owner.innerHeight = 500;
  f.owner.dispatchEvent(new Event('resize'));
  f.flush();
  expect(f.properties.get('--mobile-viewport')).toBe('500px');
  expect(f.properties.get('--mobile-viewport-top')).toBe('0px');
  cleanups.splice(0).forEach((cleanup) => cleanup());
  f.owner.dispatchEvent(new Event('resize'));
  f.viewport.dispatchEvent(new Event('resize'));
  f.flush();
  expect(f.properties.size).toBe(0);
});
