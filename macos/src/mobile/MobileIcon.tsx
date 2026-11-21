import type { MobileIconName } from '../../../shared/src/mobile/MobileIcon';
import './symbols.css';

export function MobileIcon({ name }: { name: MobileIconName }) {
  return <span className={name === 'loading' ? 'mobile-spinner' : undefined} data-mobile-symbol={name} aria-hidden="true" />;
}
