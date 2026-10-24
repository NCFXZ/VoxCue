import type { MaterialSurfaceProps } from '../../shared/src/platform/controls';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './sidebarGlass.css';
import { registerPresentationDocument } from './presentationDocuments';
let surfaceSequence = 0;

// This is a presentation document only. Its React nodes, handlers, contexts and
// business state still belong to the one shared parent tree.
export function MaterialSurface({
  children,
  kind = 'composer',
  active = true,
}: MaterialSurfaceProps) {
  const slot = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let child: Window | null = null,
      disposed = false,
      failed = false;
    let unregister = () => {};
    let removeFollowHover = () => {};
    const close = () => {
      removeFollowHover();
      if (kind === 'follow')
        document.dispatchEvent(new CustomEvent('voxcue-follow-emphasis', { detail: false }));
      unregister();
      setTarget(null);
      child?.close();
      child = null;
      slot.current?.style.removeProperty('height');
    };
    const update = () => {
      const interviewFollow =
        kind === 'follow' &&
        location.hash === '#interview' &&
        !!slot.current?.closest('.floating-composer');
      if (
        !document.documentElement.classList.contains(
          interviewFollow ? 'macos-interview-glass' : 'native-scroll-chrome',
        )
      ) {
        failed = false;
        if (child) close();
        return;
      }
      if (child || disposed || failed) return;
      const area = slot.current,
        bounds = area?.getBoundingClientRect();
      // A management header can keep native chrome active while preparation
      // is hidden. Never freeze a hidden composer's zero-height anchor.
      if (!area?.getClientRects().length || !bounds || bounds.width <= 0 || bounds.height <= 0)
        return;
      child = window.open('about:blank', `voxcue-${kind}-surface-${++surfaceSequence}`);
      if (!child) return;
      const doc = child.document;
      unregister = registerPresentationDocument(doc);
      doc.open();
      doc.write('<!doctype html><html><head></head><body></body></html>');
      doc.close();
      const base = doc.createElement('base');
      base.href = document.baseURI;
      doc.head.append(base);
      try {
        // A running parent can still hold a stylesheet whose hashed file was
        // replaced by a later build. Reuse its loaded rules rather than making
        // the projection fetch that file again. Inline rules apply before the
        // shared form moves here, so bare browser controls never become visible.
        const style = doc.createElement('style');
        style.dataset.presentationStyles = 'loaded';
        style.textContent = [...document.styleSheets]
          .filter((sheet) => !sheet.disabled)
          .map((sheet) => [...sheet.cssRules].map((rule) => rule.cssText).join('\n'))
          .join('\n');
        if (!style.textContent) throw Error('No loaded presentation styles');
        doc.head.append(style);
      } catch (error) {
        failed = true;
        close();
        console.error('Presentation styles unavailable; retaining the main form', error);
        return;
      }
      doc.body.className = 'macos-presentation-document native-window-controls';
      doc.title = `VoxCue ${kind}`;
      const frame = doc.createElement('div');
      frame.className =
        kind === 'composer' ? 'chat-composer macos-projected-composer' : 'macos-projected-follow';
      doc.body.append(frame);
      if (kind === 'follow') {
        // The original button remains the one accessible hit target in the
        // parent renderer. This inert projection only supplies its foreground.
        // Keeping pointer tracking in the owning window avoids forwarding
        // AppKit hit-test context into a reparented Electron event view.
        frame.inert = true;
        frame.setAttribute('aria-hidden', 'true');
        const emphasize = () => {
          const emphasized = !!area
            .querySelector('.follow-latest')
            ?.matches(':hover,:focus-visible');
          frame.dataset.emphasized = String(emphasized);
          document.dispatchEvent(
            new CustomEvent('voxcue-follow-emphasis', {
              detail: emphasized,
            }),
          );
        };
        const events = ['pointerover', 'pointerout', 'focusin', 'focusout'];
        for (const event of events) area.addEventListener(event, emphasize);
        removeFollowHover = () => {
          for (const event of events) area.removeEventListener(event, emphasize);
        };
        emphasize();
      }
      doc.documentElement.className = document.documentElement.className;
      doc.documentElement.style.cssText = document.documentElement.style.cssText;
      if (kind === 'composer') area.style.height = `${bounds.height}px`;
      setTarget(frame);
    };
    const observer = new MutationObserver(() => {
      if (child) {
        child.document.documentElement.className = document.documentElement.className;
        child.document.documentElement.style.cssText = document.documentElement.style.cssText;
      }
      update();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    document.addEventListener('voxcue-interview-materials-updated', update);
    const visibility = new ResizeObserver(update);
    for (let node: Element | null = slot.current; node; node = node.parentElement)
      visibility.observe(node);
    update();
    return () => {
      disposed = true;
      observer.disconnect();
      document.removeEventListener('voxcue-interview-materials-updated', update);
      visibility.disconnect();
      close();
    };
  }, [kind]);
  useLayoutEffect(() => {
    if (!target || !slot.current) return;
    const area = slot.current;
    const align = () => {
      const rect = area.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      // Width affects wrapping; measure it before deriving the anchored top.
      if (target.style.width !== `${rect.width}px`) target.style.width = `${rect.width}px`;
      const height = target.getBoundingClientRect().height;
      if (
        kind === 'composer' &&
        height > 0 &&
        Math.abs(area.getBoundingClientRect().height - height) > 0.1
      )
        area.style.height = `${height}px`;
      const current = area.getBoundingClientRect();
      const style = `position:absolute;left:${current.x}px;top:${current.y}px;width:${current.width}px;margin:0;transform:none;bottom:auto`;
      if (target.dataset.geometry !== style) {
        target.style.cssText = style;
        target.dataset.geometry = style;
      }
    };
    // ResizeObserver runs before paint. An extra animation frame leaves the
    // foreground one layout behind the native material during rapid edits.
    const resize = new ResizeObserver(align);
    for (let ancestor: Element | null = area; ancestor; ancestor = ancestor.parentElement)
      resize.observe(ancestor);
    resize.observe(target);
    window.addEventListener('resize', align);
    align();
    return () => {
      resize.disconnect();
      window.removeEventListener('resize', align);
    };
  }, [target]);
  return (
    <div
      className={
        kind === 'composer'
          ? 'macos-composer-slot'
          : `follow-latest macos-follow-slot${target ? ' is-projected' : ''}`
      }
      ref={slot}
      hidden={!active}
    >
      {kind === 'follow' ? (
        <>
          {children}
          {target && createPortal(children, target)}
        </>
      ) : target ? (
        createPortal(children, target)
      ) : (
        children
      )}
    </div>
  );
}
