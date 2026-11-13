import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { ChatModel, ReasoningEffort } from '../../electron/contracts/chat';
import { t } from '../i18n';
import {
  effortLabels,
  resolveReasoningEffort,
  supportedReasoningEfforts,
} from '../services/chatOptions';
import * as Menu from './ui/dropdown-menu';
import { Button } from './ui/button';
import { Check, ChevronDown, ChevronRight, Refresh } from './icons';
import './reasoningEffortControl.css';

interface ModelProps {
  models: ChatModel[];
  modelId: string;
  onModelChange(id: string): void;
  effort: ReasoningEffort | 'auto';
  onEffortChange(value: ReasoningEffort): void;
  loading?: boolean;
  error?: string | null;
  onRefresh?(): void;
  onRequestModels?(): Promise<void>;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  label?: string;
  effortLabel?: string;
  revealOnHover?: boolean;
}

export function ModelReasoningControl(selection: ModelProps) {
  const model = selection.models.find((item) => item.id === selection.modelId);
  const value = selection.effort;
  const onChange = selection.onEffortChange;
  const label = selection.effortLabel ?? t('思考强度');
  const className = selection.className ?? 'choice-trigger effort-model-trigger';
  const [open, setOpen] = useState(false);
  const [requestingModels, setRequestingModels] = useState(false);
  const [panel, setPanel] = useState<'effort' | 'models'>('effort');
  const [draft, setDraft] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const pending = useRef<number | null>(null);
  const pointerStart = useRef<number | null>(null);
  const [boundary, setBoundary] = useState<HTMLDialogElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const previousHeight = useRef<number | null>(null);
  const range = useRef<HTMLInputElement>(null);
  const modelButton = useRef<HTMLButtonElement>(null);
  const levels = supportedReasoningEfforts(model);
  const effort = resolveReasoningEffort(model, value);
  const index = effort === 'auto' ? 0 : Math.max(0, levels.indexOf(effort));
  const position = draft ?? index;
  const progress = levels.length > 1 ? position / (levels.length - 1) : 0;
  const previewEffort = levels[Math.round(position)];
  const current = previewEffort ? t(effortLabels[previewEffort]) : '';
  const loading = selection.loading || requestingModels;
  const modelLabel =
    model?.label ??
    t(loading ? '加载模型…' : selection.onRequestModels ? '选择模型' : '模型不可用');
  const blocked =
    selection.disabled ||
    (!requestingModels &&
      !selection.onRequestModels &&
      (selection.loading || (!selection.models.length && !selection.onRefresh)));
  // Saving locks edits without dismissing the popup or blurring its focused range.
  const locked = blocked || selection.busy || loading;
  const lockedNow = useRef(locked);
  lockedNow.current = locked;
  const restoreFocus = useRef(false);
  const preview = (next: number) => {
    if (lockedNow.current) return;
    pending.current = Math.max(0, Math.min(levels.length - 1, next));
    setDraft(pending.current);
  };
  const commit = () => {
    const next = pending.current === null ? undefined : levels[Math.round(pending.current)];
    pending.current = null;
    pointerStart.current = null;
    setDraft(null);
    setDragging(false);
    if (!lockedNow.current && next && next !== effort) onChange(next);
  };
  const cancel = () => {
    pending.current = null;
    pointerStart.current = null;
    setDraft(null);
    setDragging(false);
  };
  useEffect(cancel, [model?.id, value, open, selection.busy]);
  const changePanel = (next: 'effort' | 'models') => {
    previousHeight.current = body.current?.getBoundingClientRect().height ?? null;
    setPanel(next);
  };
  useLayoutEffect(() => {
    const node = body.current;
    const from = previousHeight.current;
    previousHeight.current = null;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    if (!open || !node || from === null || preference.matches) return;
    let animation: Animation | undefined;
    // Portal content commits after the owning component's layout effect.
    const frame = requestAnimationFrame(() => {
      if (preference.matches) return;
      const to = node.getBoundingClientRect().height;
      if (Math.abs(from - to) < 0.5) return;
      const style = getComputedStyle(node);
      const duration = style.getPropertyValue('--panel-motion-duration').trim();
      animation = node.animate([{ height: `${from}px` }, { height: `${to}px` }], {
        duration: parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000),
        easing: style.getPropertyValue('--panel-motion-easing').trim(),
      });
    });
    const stop = () => {
      if (preference.matches) animation?.cancel();
    };
    preference.addEventListener('change', stop);
    return () => {
      preference.removeEventListener('change', stop);
      cancelAnimationFrame(frame);
      animation?.cancel();
    };
  }, [open, panel]);
  useEffect(() => {
    if (blocked) setOpen(false);
    else if (!selection.busy && restoreFocus.current) {
      restoreFocus.current = false;
      const active = document.activeElement;
      if (active === document.body || active === trigger.current?.closest('dialog'))
        trigger.current?.focus({ preventScroll: true });
    }
  }, [blocked, selection.busy]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (panel === 'models') {
        const item =
          content.current?.querySelector<HTMLElement>(
            '[role="menuitemradio"][data-state="checked"]',
          ) ??
          content.current?.querySelector<HTMLElement>(
            '[role="menuitemradio"], .reasoning-model-refresh',
          );
        item?.focus();
      } else if (range.current && !range.current.disabled) range.current.focus();
      else modelButton.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, panel, selection.models]);
  const popup = (
    <Menu.Content
      ref={content}
      role="dialog"
      aria-label={label}
      aria-busy={locked || undefined}
      aria-labelledby={undefined}
      className="dropdown-content compact-tool-menu reasoning-effort-popup"
      side="top"
      align="start"
      sideOffset={10}
      collisionBoundary={boundary ?? undefined}
      collisionPadding={8}
      onCloseAutoFocus={(event) => {
        if (lockedNow.current) {
          event.preventDefault();
          restoreFocus.current = true;
        }
      }}
      onKeyDownCapture={(event) => {
        if (panel !== 'effort' || event.key !== 'Tab') return;
        const controls = Array.from(
          content.current?.querySelectorAll<HTMLElement>('input:enabled, button:enabled') ?? [],
        );
        if (!controls.length) return;
        event.preventDefault();
        const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
        controls[
          (currentIndex + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
        ].focus();
      }}
    >
      <div ref={body} className="reasoning-popup-body">
        <div key={panel} className="reasoning-popup-view" data-panel={panel}>
          {panel === 'models' ? (
            <>
              <Menu.RadioGroup
                role="menu"
                aria-label={t('选择模型')}
                className="reasoning-model-list"
                value={model?.id}
              >
                {selection.models.map((item) => (
                  <Menu.RadioItem
                    className="dropdown-item model-option"
                    value={item.id}
                    key={item.id}
                    disabled={locked}
                    onSelect={(event) => {
                      event.preventDefault();
                      if (lockedNow.current) return;
                      selection.onModelChange(item.id);
                      changePanel('effort');
                    }}
                  >
                    <span className="model-name">{t(item.label)}</span>
                    <Menu.ItemIndicator className="model-check dropdown-check">
                      <Check size={15} />
                    </Menu.ItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
              {selection.error && (
                <p className="model-error" role="alert">
                  {t(selection.error)}
                </p>
              )}
              {selection.onRefresh && (
                <Menu.Item
                  className="dropdown-item reasoning-model-refresh"
                  disabled={locked}
                  onSelect={(event) => {
                    event.preventDefault();
                    if (lockedNow.current) return;
                    selection.onRefresh?.();
                  }}
                >
                  <Refresh size={14} />
                  {t(selection.loading ? '正在读取…' : '刷新模型列表')}
                </Menu.Item>
              )}
            </>
          ) : (
            <>
              <button
                ref={modelButton}
                type="button"
                className="reasoning-model-selector"
                aria-label={t('选择模型')}
                disabled={locked}
                onClick={() => changePanel('models')}
              >
                {current && <span className="reasoning-level-heading">{current}</span>}
                <span className="reasoning-model-caption">
                  <span>{modelLabel}</span>
                  <ChevronRight size={14} />
                </span>
              </button>
              {levels.length > 0 && (
                <div
                  className="reasoning-slider"
                  data-single={levels.length === 1}
                  data-dragging={dragging}
                  data-at-start={position === 0}
                  style={
                    {
                      '--reasoning-fill': `calc(14px + ${progress * 100}% - ${progress * 28}px)`,
                    } as CSSProperties
                  }
                >
                  <span className="reasoning-slider-track" aria-hidden="true">
                    <span className="reasoning-slider-fill" />
                    {levels.map((level, position) => (
                      <span
                        key={level}
                        className="reasoning-slider-dot"
                        data-active={position <= Math.round(draft ?? index)}
                        style={{
                          left:
                            levels.length > 1
                              ? `calc(14px + ${(position / (levels.length - 1)) * 100}% - ${(position / (levels.length - 1)) * 28}px)`
                              : '50%',
                        }}
                      />
                    ))}
                  </span>
                  <span className="reasoning-slider-thumb" aria-hidden="true" />
                  <input
                    ref={range}
                    type="range"
                    min={0}
                    max={Math.max(0, levels.length - 1)}
                    step="any"
                    value={position}
                    aria-label={label}
                    aria-valuetext={current}
                    aria-valuenow={Math.round(position)}
                    disabled={levels.length < 2}
                    aria-disabled={selection.busy || undefined}
                    onChange={(event) => preview(event.currentTarget.valueAsNumber)}
                    onPointerDown={(event) => {
                      if (lockedNow.current) {
                        event.preventDefault();
                        return;
                      }
                      event.currentTarget.setPointerCapture(event.pointerId);
                      pointerStart.current = event.clientX;
                    }}
                    onPointerMove={(event) => {
                      if (
                        lockedNow.current ||
                        pointerStart.current === null ||
                        Math.abs(event.clientX - pointerStart.current) < 2
                      )
                        return;
                      setDragging(true);
                      const rect = event.currentTarget.getBoundingClientRect();
                      preview(
                        ((event.clientX - rect.left - 14) / (rect.width - 28)) *
                          (levels.length - 1),
                      );
                    }}
                    onPointerUp={commit}
                    onLostPointerCapture={commit}
                    onPointerCancel={cancel}
                    onBlur={commit}
                    onKeyUp={(event) => {
                      if (
                        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
                          event.key,
                        )
                      )
                        commit();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        cancel();
                        return;
                      }
                      event.stopPropagation();
                      if (lockedNow.current) {
                        event.preventDefault();
                        return;
                      }
                      const step = ['ArrowRight', 'ArrowUp'].includes(event.key)
                        ? 1
                        : ['ArrowLeft', 'ArrowDown'].includes(event.key)
                          ? -1
                          : 0;
                      if (step || event.key === 'Home' || event.key === 'End') {
                        event.preventDefault();
                        preview(
                          event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? levels.length - 1
                              : Math.round(pending.current ?? index) + step,
                        );
                      }
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commit();
                      }
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Menu.Content>
  );
  return (
    <Menu.Root
      open={open && !blocked}
      onOpenChange={(next) => {
        if (next && lockedNow.current) return;
        if (next) {
          setBoundary(trigger.current?.closest('dialog') ?? null);
          setPanel(selection.onRequestModels ? 'models' : 'effort');
          if (selection.onRequestModels) {
            setRequestingModels(true);
            void selection.onRequestModels().finally(() => setRequestingModels(false));
          }
        }
        setOpen(next);
      }}
    >
      <Menu.Trigger asChild disabled={locked}>
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          className={className}
          aria-label={selection.label ?? t('聊天模型')}
          aria-haspopup="dialog"
          disabled={locked}
          aria-busy={loading || selection.busy || undefined}
          data-reveal-on-hover={selection.revealOnHover || undefined}
        >
          <span className="model-name">{modelLabel}</span>
          {current && <span className="reasoning-trigger-level">{current}</span>}
          <ChevronDown size={12} />
        </Button>
      </Menu.Trigger>
      {boundary ? popup : <Menu.Portal>{popup}</Menu.Portal>}
    </Menu.Root>
  );
}
