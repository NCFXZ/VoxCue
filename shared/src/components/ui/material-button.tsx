import { Button } from './button';
import type { MaterialButtonProps } from '../../platform/controls';

export function MaterialButton({ materialAction: _action, ...props }: MaterialButtonProps) {
  return <Button {...props} />;
}
