interface WindowSurface {
  isDestroyed(): boolean;
  isVisible(): boolean;
  getOpacity(): number;
  setOpacity(value: number): void;
  showInactive(): void;
  hide(): void;
}

/** Only opacity changes; native bounds and the content's material opacity stay intact. */
export class WindowVisibility {
  private timer?: ReturnType<typeof setTimeout>;
  private completion?: { promise: Promise<boolean>; resolve(value: boolean): void };
  private generation = 0;
  private target: boolean;
  private readonly opacity: number;
  constructor(
    private window: WindowSurface,
    private reducedMotion: () => boolean,
    private failure: (error: unknown) => void = () => {},
  ) {
    this.target = window.isVisible();
    this.opacity = window.getOpacity();
  }
  get visible() {
    return this.target;
  }
  set(visible: boolean): Promise<boolean> {
    try {
      return this.change(visible);
    } catch (error) {
      this.fail(error);
      return Promise.resolve(false);
    }
  }
  private change(visible: boolean): Promise<boolean> {
    if (this.window.isDestroyed()) return Promise.resolve(false);
    if (this.target === visible && this.completion) return this.completion.promise;
    if (this.target === visible && this.window.isVisible() === visible)
      return Promise.resolve(true);
    this.cancel();
    this.target = visible;
    const generation = this.generation;
    const from = this.window.isVisible() ? this.window.getOpacity() : 0;
    const to = visible ? this.opacity : 0;
    let resolve!: (completed: boolean) => void;
    const promise = new Promise<boolean>((complete) => {
      resolve = complete;
    });
    this.completion = { promise, resolve };
    const finish = () => {
      if (generation !== this.generation || this.window.isDestroyed()) return;
      if (!visible) this.window.hide();
      this.window.setOpacity(this.opacity);
      this.timer = undefined;
      const completion = this.completion;
      this.completion = undefined;
      completion?.resolve(true);
    };
    if (visible) {
      this.window.setOpacity(from);
      this.window.showInactive();
    }
    if (this.reducedMotion() || from === to) finish();
    else {
      const started = performance.now();
      const tick = () => {
        try {
          if (generation !== this.generation) return;
          if (this.window.isDestroyed()) {
            this.cancel();
            return;
          }
          const progress = Math.min(1, (performance.now() - started) / 160);
          const eased = progress * progress * (3 - 2 * progress);
          this.window.setOpacity(from + (to - from) * eased);
          if (progress === 1) finish();
          else this.timer = setTimeout(tick, 16);
        } catch (error) {
          this.fail(error);
        }
      };
      this.timer = setTimeout(tick, 16);
    }
    return promise;
  }
  private cancel() {
    ++this.generation;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.completion?.resolve(false);
    this.completion = undefined;
  }
  private fail(error: unknown) {
    this.cancel();
    try {
      if (!this.window.isDestroyed()) this.window.setOpacity(this.opacity);
    } catch {}
    try {
      this.failure(error);
    } catch {}
  }
  dispose() {
    this.cancel();
    try {
      if (!this.window.isDestroyed()) this.window.setOpacity(this.opacity);
    } catch (error) {
      this.fail(error);
    }
  }
}
