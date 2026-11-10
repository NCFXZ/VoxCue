import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>,
  index: 0,
  started: false,
  cleanup: undefined as undefined | (() => void),
}));
vi.mock('react', () => ({
  useRef: (value: unknown) =>
    hooks.refs[hooks.index++] ?? (hooks.refs[hooks.index - 1] = { current: value }),
  useLayoutEffect: (effect: () => void) => effect(),
  useEffect: (effect: () => () => void) => {
    if (!hooks.started) {
      hooks.started = true;
      hooks.cleanup = effect();
    }
  },
}));
import { useHeightTransition } from '../../src/components/ui/useHeightTransition';
let preference: {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
let resize: (() => void) | undefined;
beforeEach(() => {
  hooks.refs = [];
  hooks.index = 0;
  hooks.started = false;
  preference = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', () => preference);
  vi.stubGlobal('window', {
    addEventListener: (_event: string, callback: () => void) => {
      resize = callback;
    },
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (key: string) =>
      key === '--panel-motion-duration' ? '240ms' : 'cubic-bezier(0.2, 0, 0, 1)',
  }));
});
afterEach(() => {
  hooks.cleanup?.();
  vi.unstubAllGlobals();
});
function fixture(height = 100, scroll = { style: { overflowAnchor: 'auto' } }) {
  let active: { height: number } | undefined;
  const model = { height };
  const players: Array<{ height: number; cancel: ReturnType<typeof vi.fn>; finish(): void }> = [];
  const node = {
    getBoundingClientRect: () => ({ height: active?.height ?? model.height }),
    closest: () => scroll,
    animate: vi.fn((frames: Array<{ height: string }>) => {
      let resolve!: () => void, reject!: () => void;
      const finished = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const player = {
        height: parseFloat(frames[0].height),
        finished,
        finish: resolve,
        cancel: vi.fn(() => {
          if (active === player) active = undefined;
          reject();
        }),
      };
      active = player;
      players.push(player);
      return player;
    }),
  } as unknown as HTMLElement & { animate: ReturnType<typeof vi.fn> };
  const render = (key: string, targets: HTMLElement[] = [node]) => {
    hooks.index = 0;
    useHeightTransition(key, () => targets);
  };
  return { node, model, players, render, scroll };
}
it('uses only height/clip with the shared tab timing and continues a rapid reverse from its current height', async () => {
  const f = fixture();
  f.render('remote');
  expect(f.node.animate).not.toHaveBeenCalled();
  f.model.height = 50;
  f.render('transcription');
  expect(f.node.animate).toHaveBeenLastCalledWith(
    [
      { height: '100px', minHeight: 0, overflow: 'clip' },
      { height: '50px', minHeight: 0, overflow: 'clip' },
    ],
    { duration: 240, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'both' },
  );
  f.players[0].height = 75;
  f.model.height = 100;
  f.render('remote');
  expect(f.node.animate.mock.calls[1][0][0].height).toBe('75px');
  expect(f.players[0].cancel).toHaveBeenCalled();
  expect(f.scroll.style.overflowAnchor).toBe('none');
  await Promise.resolve();
  expect(f.scroll.style.overflowAnchor).toBe('none');
  f.players[1].finish();
  await Promise.resolve();
  expect(f.scroll.style.overflowAnchor).toBe('auto');
});
it('skips equal heights and reduced motion, and cancels on resize or scope removal', async () => {
  const f = fixture();
  f.render('remote');
  f.render('same-height');
  expect(f.node.animate).not.toHaveBeenCalled();
  preference.matches = true;
  f.model.height = 50;
  f.render('reduced');
  expect(f.node.animate).not.toHaveBeenCalled();
  preference.matches = false;
  f.model.height = 100;
  f.render('expanded');
  resize!();
  expect(f.players[0].cancel).toHaveBeenCalled();
  expect(f.scroll.style.overflowAnchor).toBe('auto');
  f.model.height = 50;
  f.render('small');
  f.render('closed', []);
  await Promise.resolve();
  expect(f.players[1].cancel).toHaveBeenCalled();
  expect(f.scroll.style.overflowAnchor).toBe('auto');
});
it('keeps the shared scroller stable until all height tracks finish or reduced motion cancels the remainder', async () => {
  const scroll = { style: { overflowAnchor: 'auto' } };
  const a = fixture(100, scroll),
    b = fixture(100, scroll);
  a.render('remote', [a.node, b.node]);
  a.model.height = 50;
  b.model.height = 70;
  a.render('transcription', [a.node, b.node]);
  expect(scroll.style.overflowAnchor).toBe('none');
  a.players[0].finish();
  await Promise.resolve();
  expect(scroll.style.overflowAnchor).toBe('none');
  preference.matches = true;
  preference.addEventListener.mock.calls[0][1]();
  expect(b.players[0].cancel).toHaveBeenCalled();
  expect(scroll.style.overflowAnchor).toBe('auto');
  await Promise.resolve();
  expect(scroll.style.overflowAnchor).toBe('auto');
});
