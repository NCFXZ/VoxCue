import { ArrowUp } from './icons';
import { Button } from './ui/button';
import { MaterialSurface } from './ui/material-surface';

export function FollowLatestButton({
  label,
  busy = false,
  visible = true,
  onClick,
}: {
  label: string;
  busy?: boolean;
  visible?: boolean;
  onClick(): void;
}) {
  return (
    <MaterialSurface kind="follow" active={visible}>
      <Button
        className="follow-latest"
        type="button"
        variant="outline"
        size="icon"
        aria-label={label}
        aria-busy={busy}
        title={busy ? `正在回复 · ${label}` : label}
        onClick={onClick}
        style={visible ? undefined : { display: 'none' }}
      >
        {busy ? (
          <span className="follow-latest-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        ) : (
          <span className="follow-latest-arrow">
            <ArrowUp size={18} />
          </span>
        )}
      </Button>
    </MaterialSurface>
  );
}
