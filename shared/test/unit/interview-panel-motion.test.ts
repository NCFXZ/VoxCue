import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const cleanup = vi.hoisted(() => [] as Array<() => void>);
vi.mock('react', () => ({
  useEffect: (effect: () => () => void) => cleanup.push(effect()),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock('react-dom', () => ({ flushSync: (change: () => void) => change() }));
import { useInterviewPanelMotion } from '../../src/components/useInterviewPanelMotion';

beforeEach(() => {
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup(collapsed: boolean, transcriptVisible: boolean) {
  const querySelector = vi.fn(() => null);
  const setCollapsed = vi.fn(),
    setTranscriptVisible = vi.fn(),
    onError = vi.fn();
  const motion = useInterviewPanelMotion({
    shell: { current: { querySelector } as unknown as HTMLDivElement },
    collapsed,
    transcriptVisible,
    setCollapsed,
    setTranscriptVisible,
    canStart: () => true,
    onError,
  });
  return { motion, setCollapsed, setTranscriptVisible, querySelector, onError };
}
it('changes the saved transcript visibility while folded without unfolding or animating', async () => {
  const setVisible = vi.fn(async () => false),
    toggle = vi.fn();
  vi.stubGlobal('window', {
    desktop: {
      interviewState: async () => ({ visible: true }),
      setInterviewTranscriptVisible: setVisible,
      toggleInterviewCollapse: toggle,
    },
  });
  const { motion, setCollapsed, setTranscriptVisible, querySelector } = setup(true, true);
  await motion.toggleTranscript();
  expect(setVisible).toHaveBeenCalledExactlyOnceWith(false);
  expect(setTranscriptVisible).toHaveBeenCalledExactlyOnceWith(false);
  expect(toggle).not.toHaveBeenCalled();
  expect(setCollapsed).not.toHaveBeenCalled();
  expect(querySelector).not.toHaveBeenCalled();
});
it('keeps a previously hidden transcript hidden when expanding the panels', async () => {
  const setVisible = vi.fn(),
    toggle = vi.fn(async () => false);
  vi.stubGlobal('window', {
    desktop: {
      interviewState: async () => ({ visible: true }),
      setInterviewTranscriptVisible: setVisible,
      toggleInterviewCollapse: toggle,
    },
  });
  const { motion, setCollapsed, setTranscriptVisible } = setup(true, false);
  await motion.toggleCollapsed();
  expect(toggle).toHaveBeenCalledTimes(1);
  expect(setCollapsed).toHaveBeenCalledWith(false);
  expect(setVisible).not.toHaveBeenCalled();
  expect(setTranscriptVisible).not.toHaveBeenCalled();
});
it('serializes native layout changes and ignores repeated or conflicting commands while busy', async () => {
  let finish!: (value: boolean) => void;
  const setVisible = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const toggle = vi.fn();
  vi.stubGlobal('window', {
    desktop: {
      interviewState: async () => ({ visible: true }),
      setInterviewTranscriptVisible: setVisible,
      toggleInterviewCollapse: toggle,
    },
  });
  const { motion } = setup(true, false);
  const pending = motion.toggleTranscript();
  await Promise.resolve();
  await motion.toggleTranscript();
  await motion.toggleCollapsed();
  expect(setVisible).toHaveBeenCalledExactlyOnceWith(true);
  expect(toggle).not.toHaveBeenCalled();
  finish(true);
  await pending;
  expect(motion.busy.current).toBe(false);
});

it('uses native hidden state even when Chromium reports visible and never waits for suspended animation', async () => {
  const toggle = vi.fn(async () => true);
  vi.stubGlobal('window', {
    desktop: { interviewState: async () => ({ visible: false }), toggleInterviewCollapse: toggle },
  });
  const animate = vi.fn(() => {
    throw Error('A hidden document must not animate');
  });
  const collapsed = vi.fn();
  const motion = useInterviewPanelMotion({
    shell: { current: { querySelector: () => ({ animate }) } as unknown as HTMLDivElement },
    collapsed: false,
    transcriptVisible: true,
    setCollapsed: collapsed,
    setTranscriptVisible: vi.fn(),
    canStart: () => true,
    onError: vi.fn(),
  });
  await motion.toggleCollapsed();
  expect(toggle).toHaveBeenCalledOnce();
  expect(collapsed).toHaveBeenCalledWith(true);
  expect(animate).not.toHaveBeenCalled();
  expect(motion.busy.current).toBe(false);
});

it('finishes a layout command if the compositor stops after an animation starts', async () => {
  vi.useFakeTimers();
  let finish!: () => void;
  const player = {
    finished: new Promise<void>((resolve) => {
      finish = resolve;
    }),
    cancel: vi.fn(() => finish()),
  };
  const toggle = vi.fn(async () => true);
  vi.stubGlobal('window', {
    desktop: { interviewState: async () => ({ visible: true }), toggleInterviewCollapse: toggle },
  });
  const motion = useInterviewPanelMotion({
    shell: {
      current: { querySelector: () => ({ animate: () => player }) } as unknown as HTMLDivElement,
    },
    collapsed: false,
    transcriptVisible: true,
    setCollapsed: vi.fn(),
    setTranscriptVisible: vi.fn(),
    canStart: () => true,
    onError: vi.fn(),
  });
  const pending = motion.toggleCollapsed();
  await vi.advanceTimersByTimeAsync(400);
  await pending;
  expect(player.cancel).toHaveBeenCalled();
  expect(toggle).toHaveBeenCalledOnce();
  expect(motion.busy.current).toBe(false);
});
