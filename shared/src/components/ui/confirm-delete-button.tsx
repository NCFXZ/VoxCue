import { t } from '../../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, type ButtonProps } from './button';
import { Trash, Reset, Loader } from '../icons';

interface Props extends Omit<ButtonProps, 'onClick' | 'children' | 'variant' | 'size'> {
  target: string;
  label?: string;
  iconOnly?: boolean;
  compact?: boolean;
  fixedWidth?: boolean;
  active?: boolean;
  revision?: unknown;
  warning?: string;
  onConfirm(): void | boolean | Promise<void | boolean>;
}

/** Confirmation stays on the initiating control; no data operation occurs on the first click. */
function ConfirmActionButton({
  target,
  action,
  icon: Icon,
  reportError = true,
  label = action,
  iconOnly = false,
  compact = false,
  fixedWidth = false,
  active = true,
  revision,
  warning = '删除后无法恢复',
  onConfirm,
  disabled,
  className = '',
  'aria-label': ariaLabel,
  ...props
}: Props & { action: '删除' | '重置'; icon: typeof Trash; reportError?: boolean }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [widths, setWidths] = useState({ idle: iconOnly ? (compact ? 32 : 36) : 88, confirm: 128 });
  const idleContent = useRef<HTMLSpanElement>(null);
  const confirmContent = useRef<HTMLSpanElement>(null);
  const inFlight = useRef(false);
  const armedRevision = useRef<unknown>(undefined);
  useLayoutEffect(() => {
    // Measure intrinsic content, never the animated button or native artwork.
    // Both states keep enough room for the system title, icon and end caps.
    const measure = () => {
      const idle = iconOnly
        ? compact
          ? 32
          : 36
        : Math.ceil((idleContent.current?.scrollWidth ?? 48) + 40);
      const confirm = Math.ceil((confirmContent.current?.scrollWidth ?? 77) + 24);
      setWidths((previous) =>
        previous.idle === idle && previous.confirm === confirm ? previous : { idle, confirm },
      );
    };
    const observer = new ResizeObserver(measure);
    if (idleContent.current) observer.observe(idleContent.current);
    if (confirmContent.current) observer.observe(confirmContent.current);
    measure();
    return () => observer.disconnect();
  }, [label, iconOnly, compact]);
  useEffect(() => {
    if (inFlight.current) return;
    setArmed(false);
    setError(false);
  }, [active, revision, target]);
  useEffect(() => {
    if (disabled && !inFlight.current) setArmed(false);
  }, [disabled]);
  useEffect(() => {
    if (!armed || busy) return;
    const cancel = () => setArmed(false);
    const timer = window.setTimeout(cancel, 3000);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', cancel);
    };
  }, [armed, busy]);
  return (
    <span
      className={`confirm-delete-control ${armed ? 'is-confirming' : ''}`}
      style={fixedWidth ? { minWidth: Math.max(widths.idle, widths.confirm) } : undefined}
    >
      <Button
        {...props}
        type={props.type || 'button'}
        className={`confirm-delete ${className} ${compact ? 'is-compact' : ''} ${armed ? 'is-confirming' : ''}`}
        style={{
          ...props.style,
          width: fixedWidth ? '100%' : armed ? widths.confirm : widths.idle,
        }}
        variant={armed ? 'destructive' : 'dangerGhost'}
        size={iconOnly && !armed ? 'icon' : 'default'}
        disabled={disabled || busy || !active}
        aria-busy={busy}
        aria-label={
          armed
            ? t('确认{0}：{1}', [t(action), target])
            : ariaLabel || t('{0}：{1}', [t(label), target])
        }
        aria-description={
          armed ? t('{0}，{1}。再次点击确认；Esc 或三秒后取消。', [target, t(warning)]) : undefined
        }
        onBlur={() => {
          if (!inFlight.current) setArmed(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && armed && !inFlight.current) {
            event.preventDefault();
            event.stopPropagation();
            setArmed(false);
          }
          props.onKeyDown?.(event);
        }}
        onClick={async (event) => {
          event.stopPropagation();
          if (inFlight.current) return;
          if (!armed) {
            armedRevision.current = revision;
            setError(false);
            setArmed(true);
            return;
          }
          if (!Object.is(armedRevision.current, revision)) {
            setArmed(false);
            return;
          }
          inFlight.current = true;
          setBusy(true);
          try {
            const result = await onConfirm();
            setError(result === false);
          } catch {
            setError(true);
          } finally {
            inFlight.current = false;
            setBusy(false);
            setArmed(false);
          }
        }}
      >
        <span ref={idleContent} className="confirm-delete-idle" aria-hidden="true">
          <Icon size={iconOnly && !compact ? 17 : 14} />
          {!iconOnly && <span>{t(label)}</span>}
        </span>
        <span ref={confirmContent} className="confirm-delete-confirm" aria-hidden="true">
          {busy ? <Loader size={14} /> : <Icon size={14} />}
          <span>{t(busy ? `${action}中…` : `确认${action}`)}</span>
        </span>
      </Button>
      {error && reportError && (
        <span role="alert" className="confirm-delete-error">
          {t('{0}失败，请重试。', [t(action)])}
        </span>
      )}
    </span>
  );
}

export function ConfirmDeleteButton(props: Props) {
  return (
    <ConfirmActionButton {...props} iconOnly={props.iconOnly ?? true} action="删除" icon={Trash} />
  );
}

/** UsagePanel displays the reset service's error next to its usage statistics. */
export function ConfirmResetButton(props: Props) {
  return <ConfirmActionButton {...props} action="重置" icon={Reset} reportError={false} />;
}
