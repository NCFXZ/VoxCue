import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, type ButtonProps } from './button';
import { Trash, RotateCcw, Loader } from '../icons';

interface Props extends Omit<ButtonProps, 'onClick' | 'children' | 'variant' | 'size'> {
  target: string;
  label?: string;
  iconOnly?: boolean;
  compact?: boolean;
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
  const [width, setWidth] = useState<number>();
  const button = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const armedRevision = useRef<unknown>(undefined);
  useLayoutEffect(() => {
    const measured = button.current?.getBoundingClientRect().width;
    if (measured) setWidth(measured);
  }, [label, iconOnly, active]);
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
    <span className={`confirm-delete-control ${armed ? 'is-confirming' : ''}`}>
      <Button
        {...props}
        ref={button}
        type={props.type || 'button'}
        className={`confirm-delete ${className} ${compact ? 'is-compact' : ''} ${armed ? 'is-confirming' : ''}`}
        style={{
          ...props.style,
          width:
            width === undefined ? undefined : armed ? Math.max(compact ? 80 : 112, width) : width,
        }}
        variant={armed ? 'destructive' : 'dangerGhost'}
        size={iconOnly && !armed ? 'icon' : 'default'}
        disabled={disabled || busy || !active}
        aria-busy={busy}
        aria-label={armed ? `确认${action}：${target}` : ariaLabel || `${label}：${target}`}
        aria-description={
          armed ? `${target}，${warning}。再次点击确认；Esc 或三秒后取消。` : undefined
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
        <span className="confirm-delete-idle" aria-hidden="true">
          {compact && armed ? null : <Icon size={14} />}
          {!iconOnly && <span>{label}</span>}
        </span>
        <span className="confirm-delete-confirm" aria-hidden="true">
          {compact ? null : busy ? <Loader size={14} /> : <Icon size={14} />}
          <span>{busy ? `${action}中…` : `确认${action}`}</span>
        </span>
      </Button>
      {error && reportError && (
        <span role="alert" className="confirm-delete-error">
          {action}失败，请重试。
        </span>
      )}
    </span>
  );
}

export function ConfirmDeleteButton(props: Props) {
  return <ConfirmActionButton {...props} action="删除" icon={Trash} />;
}

/** UsagePanel displays the reset service's error next to its usage statistics. */
export function ConfirmResetButton(props: Props) {
  return <ConfirmActionButton {...props} action="重置" icon={RotateCcw} reportError={false} />;
}
