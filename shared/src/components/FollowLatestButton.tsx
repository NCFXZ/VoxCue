import { ArrowUp } from './icons';
import { Button } from './ui/button';

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
    <>
      <Button
        className="follow-latest"
        type="button"
        variant="outline"
        size="icon"
        aria-label={label}
        aria-busy={busy}
        aria-hidden={!visible}
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
    </>
  );
}
