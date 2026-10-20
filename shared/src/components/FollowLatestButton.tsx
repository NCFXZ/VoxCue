import { ArrowUp } from './icons';
import { Button } from './ui/button';

export function FollowLatestButton({
  label,
  busy = false,
  onClick,
}: {
  label: string;
  busy?: boolean;
  onClick(): void;
}) {
  return (
    <Button
      className="follow-latest"
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      aria-busy={busy}
      title={busy ? `正在回复 · ${label}` : label}
      onClick={onClick}
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
  );
}
