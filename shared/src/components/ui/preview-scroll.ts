type PreviewScrollEffects = {
  fold(progress: number, reducedMotion: boolean, animate?: boolean): void;
  reveal(): void;
  reset(): void;
};

// Only the story stretches. Its fixed overlay scrubs the real collapse animation.
export function installPreviewScroll(
  node: HTMLElement,
  effects: PreviewScrollEffects,
  toggle?: HTMLButtonElement | null,
  controls?: HTMLElement,
) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let scrollFrame = 0;
  let hintTimer: ReturnType<typeof window.setTimeout> | undefined;
  let releaseFrame = 0;
  let releaseTimer: ReturnType<typeof window.setTimeout> | undefined;
  let started = false;
  let hintCancelled = false;
  let revealed = false;
  let revealing = false;
  let visible = false;
  let scriptedTop = node.scrollTop;
  let pullDistance = 0;
  let stretch = 0;
  let touchY: number | undefined;
  let wheelPull = false;
  let lastWheelAt: number | undefined;
  let manualFold: number | undefined;
  let foldProgress = 0;
  const threshold = () =>
    wheelPull
      ? Math.min(600, Math.max(400, node.clientHeight))
      : Math.min(480, Math.max(320, node.clientHeight * 0.8));
  const cancelScroll = () => {
    hintCancelled = true;
    window.clearTimeout(hintTimer);
    cancelAnimationFrame(scrollFrame);
    if (revealing) {
      revealing = false;
      syncFold();
    }
  };
  const syncFold = (animate = false) => {
    // After the first slide, the final page's visible fraction controls the
    // same fold in both directions as the user scrolls.
    let progress = pullDistance / threshold();
    if (revealing) progress = 1;
    else if (revealed) {
      const height = node.clientHeight;
      const remaining = node.scrollHeight - height - node.scrollTop;
      // Chromium rounds scroll bounds at fractional DPI; keep both endpoints exact.
      if (height <= 0) progress = 0;
      else if (remaining <= 1) progress = 1;
      else if (remaining >= height - 1) progress = 0;
      else progress = 1 - remaining / height;
    }
    foldProgress = manualFold ?? Math.max(0, Math.min(1, progress));
    effects.fold(foldProgress, reducedMotion.matches, animate);
  };
  const paintPull = (value: number) => {
    pullDistance = value;
    const limit = Math.min(96, node.clientHeight * 0.18);
    stretch = limit > 0 ? limit * (1 - Math.exp((-value * 0.4) / limit)) : 0;
    if (stretch && !reducedMotion.matches)
      node.style.setProperty('--preview-overscroll', `${-stretch}px`);
    else node.style.removeProperty('--preview-overscroll');
    syncFold();
  };
  const stopRelease = () => {
    window.clearTimeout(releaseTimer);
    cancelAnimationFrame(releaseFrame);
  };
  const resetGesture = () => {
    cancelScroll();
    stopRelease();
    wheelPull = false;
    paintPull(0);
    touchY = undefined;
  };
  const animateScroll = (
    target: number,
    duration: number,
    easing: (progress: number) => number,
    finished?: () => void,
  ) => {
    const from = node.scrollTop;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      node.scrollTop = from + (target - from) * easing(progress);
      scriptedTop = node.scrollTop;
      if (progress < 1) scrollFrame = requestAnimationFrame(tick);
      else {
        scrollFrame = 0;
        finished?.();
      }
    };
    scrollFrame = requestAnimationFrame(tick);
  };
  const release = () => {
    stopRelease();
    if (!pullDistance) return;
    if (reducedMotion.matches) return paintPull(0);
    const from = pullDistance;
    let start: number | undefined;
    const tick = (now: number) => {
      // A critically damped spring also reverses a partially folded overlay.
      const elapsed = ((now - (start ??= now)) / 1000) * 14;
      const value = from * (1 + elapsed) * Math.exp(-elapsed);
      paintPull(value < 0.1 ? 0 : value);
      if (pullDistance) releaseFrame = requestAnimationFrame(tick);
    };
    releaseFrame = requestAnimationFrame(tick);
  };
  const pull = (delta: number) => {
    if (manualFold === 0) manualFold = undefined;
    stopRelease();
    const next = Math.max(0, pullDistance + delta);
    if (next < threshold()) return paintPull(next);
    const overscroll = stretch;
    revealed = true;
    revealing = !reducedMotion.matches;
    paintPull(0);
    effects.reveal();
    const target = node.scrollHeight - node.clientHeight;
    // Continue from the resisted position instead of snapping the story back first.
    node.scrollTop = reducedMotion.matches ? target : Math.min(target, node.scrollTop + overscroll);
    scriptedTop = node.scrollTop;
    syncFold();
    if (revealing)
      animateScroll(
        target,
        460,
        (progress) => 1 - (1 - progress) ** 3,
        () => {
          revealing = false;
          syncFold();
        },
      );
  };
  const atBottom = () =>
    node.scrollHeight > node.clientHeight &&
    node.scrollHeight - node.clientHeight - node.scrollTop <= 1;
  const canPull = () => !revealed && visible && !document.hidden;
  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= 0.35;
      if (reducedMotion.matches || (node.scrollTop > 0 && !started)) cancelScroll();
      if (!visible) {
        if (started || pullDistance || revealed) resetGesture();
        return;
      }
      if (started || hintCancelled) return;
      started = true;
      hintTimer = window.setTimeout(() => {
        const target = Math.max(0, node.firstElementChild!.clientHeight - node.clientHeight / 2);
        // Replay the accepted start backwards in time and distance for the stop.
        animateScroll(target, 1000, (progress) => {
          const start = Math.min(progress, 1 - progress);
          const eased = start ** 3 * (10 + start * (-15 + 6 * start));
          return progress <= 0.5 ? eased : 1 - eased;
        });
      }, 1000);
    },
    { threshold: 0.35 },
  );
  const blockRevealInput = (event: Event) => {
    if (!revealing) return false;
    if (event.cancelable) event.preventDefault();
    return true;
  };
  const wheel = (event: WheelEvent) => {
    if (blockRevealInput(event)) return;
    cancelScroll();
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      !canPull() ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
    )
      return;
    const delta =
      event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1);
    const now = performance.now();
    // Rate-limit distance rather than guessing the physical device. Dense
    // touchpad/momentum events share a 500px/s allowance, not 80px per event.
    const allowance =
      lastWheelAt === undefined ? 80 : Math.min(80, Math.max(0, now - lastWheelAt) * 0.5);
    lastWheelAt = now;
    if ((delta > 0 || (delta < 0 && pullDistance)) && atBottom() && event.cancelable) {
      event.preventDefault();
      wheelPull = true;
      pull(delta > 0 ? Math.min(delta, allowance) : delta);
      if (!revealed) releaseTimer = window.setTimeout(release, 160);
    }
  };
  const touchStart = (event: TouchEvent) => {
    if (revealing) return;
    resetGesture();
    touchY = event.touches.length === 1 ? event.touches[0].clientY : undefined;
  };
  const touchMove = (event: TouchEvent) => {
    if (blockRevealInput(event)) return;
    if (revealed) return cancelScroll();
    if (event.touches.length !== 1) return resetGesture();
    const nextY = event.touches[0].clientY;
    const delta = touchY === undefined ? 0 : touchY - nextY;
    touchY = nextY;
    if (event.defaultPrevented || !canPull() || !event.cancelable) return;
    if ((delta > 0 && atBottom()) || (delta < 0 && pullDistance)) {
      event.preventDefault();
      pull(delta);
    }
  };
  const touchEnd = () => {
    touchY = undefined;
    if (revealing) return;
    release();
  };
  const touchCancel = () => {
    if (!revealing) resetGesture();
  };
  const pointerdown = (event: PointerEvent) => {
    if (!blockRevealInput(event)) resetGesture();
  };
  const keydown = (event: KeyboardEvent) => {
    if (revealing) {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key))
        event.preventDefault();
      return;
    }
    cancelScroll();
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (['ArrowDown', 'PageDown', 'End'].includes(event.key) && atBottom() && canPull()) {
      event.preventDefault();
      pull(event.key === 'ArrowDown' ? 32 : threshold());
      if (!revealed) releaseTimer = window.setTimeout(release, 80);
    } else resetGesture();
  };
  const scroll = () => {
    if (revealing) {
      // Native scrollbar drags can bypass pointer events; preserve this slide.
      if (node.scrollTop !== scriptedTop) node.scrollTop = scriptedTop;
      return;
    }
    if (node.scrollTop !== scriptedTop) cancelScroll();
    if (pullDistance && !atBottom()) resetGesture();
    // Scrolling never overrides either explicit choice or its running animation.
    if (revealed && manualFold === undefined) syncFold();
  };
  const toggleFold = () => {
    // The first reveal remains uninterrupted, including clicks on its capsule.
    if (revealing) return;
    const target = foldProgress < 0.5 ? 1 : 0;
    cancelScroll();
    stopRelease();
    pullDistance = 0;
    stretch = 0;
    touchY = undefined;
    node.style.removeProperty('--preview-overscroll');
    manualFold = target;
    syncFold(true);
  };
  const visibility = () => {
    if (document.hidden) resetGesture();
  };
  const motion = () => {
    if (reducedMotion.matches) resetGesture();
  };
  const controlInput = () => {
    if (!revealing) cancelScroll();
  };
  observer.observe(node);
  node.addEventListener('wheel', wheel, { passive: false });
  node.addEventListener('touchstart', touchStart, { passive: true });
  node.addEventListener('touchmove', touchMove, { passive: false });
  node.addEventListener('touchend', touchEnd, { passive: true });
  node.addEventListener('touchcancel', touchCancel, { passive: true });
  node.addEventListener('pointerdown', pointerdown);
  node.addEventListener('keydown', keydown);
  node.addEventListener('scroll', scroll, { passive: true });
  toggle?.addEventListener('click', toggleFold);
  controls?.addEventListener('pointerdown', controlInput);
  controls?.addEventListener('keydown', controlInput);
  reducedMotion.addEventListener('change', motion);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    resetGesture();
    observer.disconnect();
    effects.reset();
    node.removeEventListener('wheel', wheel);
    node.removeEventListener('touchstart', touchStart);
    node.removeEventListener('touchmove', touchMove);
    node.removeEventListener('touchend', touchEnd);
    node.removeEventListener('touchcancel', touchCancel);
    node.removeEventListener('pointerdown', pointerdown);
    node.removeEventListener('keydown', keydown);
    node.removeEventListener('scroll', scroll);
    toggle?.removeEventListener('click', toggleFold);
    controls?.removeEventListener('pointerdown', controlInput);
    controls?.removeEventListener('keydown', controlInput);
    reducedMotion.removeEventListener('change', motion);
    document.removeEventListener('visibilitychange', visibility);
  };
}
