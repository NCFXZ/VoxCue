import { cloneElement, Component, createRef, type ReactElement, type ReactNode } from 'react';
import { modalExitRemaining } from './modal-motion';
import { continuedTiming, runningMotion, type RunningMotion } from './motion-continuation';
import { prepareVisualSnapshot } from './visual-snapshot';
import './animated-collection.css';

type Item = ReactElement<{
  'data-collection-item'?: string;
  'data-motion-revision'?: string | number | boolean;
}>;

interface Props {
  className: string;
  children: Item[];
  before?: ReactNode;
  label?: string;
  enabled?: boolean;
  wrapped?: boolean;
  resizeDialog?: boolean;
  waitForDialogExit?: boolean;
}

interface ItemPosition {
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
  clipPath: string;
  background: string;
  exit?: HTMLElement;
}

interface Layout {
  width: number;
  height: number;
  sameOrder: boolean;
  dialogHeight?: number;
  scrollable: boolean;
  items: Map<string, ItemPosition>;
}

const shown = 'inset(0 0 0% 0)';
const folded = 'inset(0 0 100% 0)';
const reducedMotion = '(prefers-reduced-motion: reduce)';

export class AnimatedCollection extends Component<Props> {
  private readonly root = createRef<HTMLDivElement>();
  private readonly overlay = createRef<HTMLDivElement>();
  private readonly animations = new Map<HTMLElement, Animation>();
  private readonly travel = new Map<HTMLElement, readonly number[]>();
  private preference?: MediaQueryList;
  private frame = 0;

  componentDidMount() {
    this.preference = this.root.current?.ownerDocument.defaultView?.matchMedia?.(reducedMotion);
    this.preference?.addEventListener('change', this.onMotionPreference);
  }

  componentWillUnmount() {
    this.preference?.removeEventListener('change', this.onMotionPreference);
    this.stop();
  }

  getSnapshotBeforeUpdate(previous: Props): Layout | null {
    const { children, enabled } = this.props;
    if (enabled === false || previous.enabled === false || this.preference?.matches) return null;
    const sameOrder = previous.children.length === children.length &&
      previous.children.every((item, i) => item.key === children[i].key);
    if (sameOrder && previous.children.every((item, i) =>
      item.props['data-motion-revision'] === children[i].props['data-motion-revision'])) return null;

    const live = new Set(children.map(item => String(item.key)));
    const origin = this.overlay.current!.getBoundingClientRect();
    const items = new Map<string, ItemPosition>();
    for (const node of this.itemNodes()) {
      const key = node.dataset.collectionItem!;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      items.set(key, {
        left: rect.left - origin.left,
        top: rect.top - origin.top,
        width: rect.width,
        height: rect.height,
        opacity: Number(style.opacity),
        clipPath: style.clipPath,
        background: style.backgroundColor,
        exit: live.has(key) ? undefined : node.cloneNode(true) as HTMLElement,
      });
    }
    const root = this.root.current!;
    const { width, height } = root.getBoundingClientRect();
    return {
      items,
      width,
      height,
      sameOrder,
      dialogHeight: this.props.resizeDialog ? root.closest('dialog')?.getBoundingClientRect().height : undefined,
      scrollable: root.scrollHeight > root.clientHeight + 1,
    };
  }

  componentDidUpdate(previous: Props, _state: unknown, layout: Layout | null) {
    if (this.props.enabled === false || this.preference?.matches) {
      this.stop();
      return;
    }
    if (!layout) return;
    const { wrapped } = this.props;
    const root = this.root.current!;
    const nodes = this.itemNodes();
    // Let status changes paint inside cards without interrupting a slide when
    // the new content fits in the same layout.
    if (wrapped && layout.sameOrder && this.animations.size > 0 &&
      Math.abs(root.getBoundingClientRect().width - layout.width) < 0.5 && nodes.every(node => {
        const before = layout.items.get(node.dataset.collectionItem!)!;
        const rect = node.getBoundingClientRect();
        return Math.abs(rect.width - before.width) < 0.5 && Math.abs(rect.height - before.height) < 0.5;
      })) return;
    // Read each sliding item's carried speed before its retarget cancels it.
    const running = new Map<HTMLElement, RunningMotion>();
    for (const [node, animation] of this.animations) {
      const travel = this.travel.get(node);
      const motion = travel && runningMotion(animation, travel);
      if (motion) running.set(node, motion);
    }
    // Release earlier transforms before measuring the new flow. Existing exit
    // visuals are independent, so a second edit can finish their original fades.
    for (const node of Array.from(this.animations.keys()))
      if (!node.hasAttribute('data-collection-exit')) this.cancel(node);
    const style = getComputedStyle(root);
    const duration = style.getPropertyValue('--panel-motion-duration').trim();
    const removed = [...layout.items.values()].some(item => item.exit);
    const timing = {
      duration: parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000),
      easing: style.getPropertyValue('--panel-motion-easing').trim(),
      delay: removed && this.props.waitForDialogExit ? modalExitRemaining(root.ownerDocument) : 0,
    };
    if (!(timing.duration > 0) || !timing.easing) return;
    const height = root.getBoundingClientRect().height;
    const origin = this.overlay.current!.getBoundingClientRect();
    const revisions = new Map(previous.children.map(item => [String(item.key), String(item.props['data-motion-revision'] ?? '')]));
    const targets = nodes.map(node => {
      const key = node.dataset.collectionItem!;
      const rect = node.getBoundingClientRect();
      const from = layout.items.get(key);
      const x = from ? from.left - (rect.left - origin.left) : 0;
      const y = from ? from.top - (rect.top - origin.top) : 0;
      return { node, key, from, x, y, wraps: wrapped && Math.abs(x) >= 0.5 && Math.abs(y) >= 0.5 };
    });
    const reflow = wrapped && (removed || targets.some(target => target.wraps));
    const resized = Math.abs(layout.height - height) >= 0.5;
    const columnTravel = wrapped ? parseFloat(style.columnGap) || 0 : 0;
    const rowTravel = wrapped ? (parseFloat(style.rowGap) || 0) / 2 : 0;
    const direction = style.direction === 'rtl' ? -1 : 1;
    // Leave room for the departing tiles, then reveal the incoming tiles
    // while the last part of the slide is still settling.
    const delay = reflow ? timing.duration * 0.3 : 0;
    const layoutTiming = { ...timing, duration: timing.duration - delay, delay: timing.delay + delay };
    const exitTiming = reflow ? { ...timing, duration: timing.duration * 0.45 } : timing;
    const revealTiming = reflow ? {
      ...timing,
      delay: layoutTiming.delay + layoutTiming.duration * 0.4,
      duration: timing.duration * 0.65,
    } : wrapped && resized ? {
      ...timing,
      delay: timing.delay + timing.duration * 0.22,
      duration: timing.duration * 0.75,
    } : timing;
    const dialog = this.props.resizeDialog ? root.closest('dialog') : null;
    const dialogHeight = dialog?.getBoundingClientRect().height;
    if (resized) {
      root.toggleAttribute('data-collection-fits', !layout.scrollable && root.scrollHeight <= root.clientHeight + 1);
      // Give a new row room to reveal. Begin shrinking as the outgoing row
      // finishes fading so the container and cards settle together.
      const heightTiming = wrapped ? {
        ...timing,
        delay: height < layout.height ? layoutTiming.delay : timing.delay,
        duration: timing.duration * 0.75,
      } : layoutTiming;
      this.play(root, [
        { height: `${layout.height}px` },
        { height: `${height}px` },
      ], heightTiming);
    }
    if (dialog && layout.dialogHeight !== undefined && dialogHeight !== undefined &&
      Math.abs(layout.dialogHeight - dialogHeight) >= 0.5) {
      this.play(dialog, [
        { height: `${layout.dialogHeight}px` },
        { height: `${dialogHeight}px` },
      ], timing);
    }
    for (const { node, key, from, x, y, wraps } of targets) {
      const previousExit = this.overlay.current!.querySelector<HTMLElement>(
        `[data-collection-exit="${CSS.escape(key)}"]`,
      );
      if (previousExit) {
        this.cancel(previousExit);
        previousExit.remove();
      }
      if (!from) {
        this.play(node, [
          {
            opacity: 0,
            clipPath: wrapped ? shown : folded,
            translate: wrapped ? `0px ${rowTravel}px` : undefined,
          },
          { opacity: 1, clipPath: shown, translate: wrapped ? '0px 0px' : undefined },
        ], revealTiming);
        continue;
      }
      const moved = Math.abs(x) >= 0.5 || Math.abs(y) >= 0.5;
      const updated = revisions.get(key) !== (node.dataset.motionRevision ?? '');
      if (wraps) {
        const travel = -Math.sign(y) * direction * columnTravel;
        this.exit(key, node.cloneNode(true) as HTMLElement, from, exitTiming, `${travel}px 0px`);
        this.play(node, [
          { opacity: 0, translate: `${-travel}px 0px` },
          { opacity: 1, translate: '0px 0px' },
        ], revealTiming);
      } else if (moved || updated || from.opacity < 1 || from.clipPath !== 'none') {
        this.play(node, [
          {
            translate: `${x}px ${y}px`,
            opacity: updated ? Math.min(from.opacity, 0.65) : from.opacity,
            clipPath: from.clipPath === 'none' ? shown : from.clipPath,
          },
          { translate: '0px 0px', opacity: 1, clipPath: shown },
        ], moved ? continuedTiming(layoutTiming, running.get(node), [-x, -y]) : layoutTiming);
        if (moved) this.travel.set(node, [-x, -y]);
      }
    }
    for (const [key, item] of layout.items)
      if (item.exit && item.width > 0 && item.height > 0)
        this.exit(key, item.exit, item, exitTiming, wrapped ? `0px ${rowTravel}px` : undefined);
    this.notifyFrame();
  }

  private itemNodes() {
    return Array.from(this.root.current!.querySelectorAll<HTMLElement>(':scope > [data-collection-item]'));
  }

  private exit(key: string, node: HTMLElement, from: ItemPosition, timing: EffectTiming, translate?: string) {
    prepareVisualSnapshot([node, ...node.querySelectorAll('*')]);
    node.classList.remove('active');
    node.removeAttribute('data-collection-item');
    node.dataset.collectionExit = key;
    node.inert = true;
    node.setAttribute('aria-hidden', 'true');
    Object.assign(node.style, {
      left: `${from.left}px`, top: `${from.top}px`,
      width: `${from.width}px`, height: `${from.height}px`,
      backgroundColor: from.background,
    });
    this.overlay.current!.append(node);
    this.play(node, [
      {
        opacity: from.opacity,
        clipPath: from.clipPath === 'none' ? shown : from.clipPath,
        translate: translate ? '0px 0px' : undefined,
      },
      { opacity: 0, clipPath: this.props.wrapped ? shown : folded, translate },
    ], timing, () => node.remove());
  }

  private play(node: HTMLElement, frames: Keyframe[], timing: EffectTiming, done?: () => void) {
    if (node === this.root.current) node.dataset.collectionResizing = '';
    const animation = node.animate(frames, { ...timing, fill: 'both' });
    this.animations.set(node, animation);
    const finish = () => {
      if (this.animations.get(node) !== animation) return;
      this.cancel(node);
      done?.();
    };
    void animation.finished.then(finish, finish);
  }

  private cancel(node: HTMLElement) {
    const animation = this.animations.get(node);
    this.animations.delete(node);
    this.travel.delete(node);
    animation?.cancel();
    if (node === this.root.current) {
      delete node.dataset.collectionResizing;
      delete node.dataset.collectionFits;
    }
  }

  private notifyFrame = () => {
    cancelAnimationFrame(this.frame);
    this.root.current?.dispatchEvent(new Event('collection-motion', { bubbles: true }));
    this.frame = this.animations.size ? requestAnimationFrame(this.notifyFrame) : 0;
  };

  private onMotionPreference = () => {
    if (this.preference?.matches) this.stop();
  };

  private stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const node of this.animations.keys()) this.cancel(node);
    this.overlay.current?.replaceChildren();
  }

  render() {
    const { className, children, before, label } = this.props;
    return (
      <div ref={this.root} className={`${className} animated-collection`}
        role={label ? 'region' : undefined} aria-label={label}>
        {before}
        {children.map(item => cloneElement(item, { 'data-collection-item': String(item.key) }))}
        <div ref={this.overlay} className="collection-exits" aria-hidden="true" inert />
      </div>
    );
  }
}
