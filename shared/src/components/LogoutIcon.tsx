import type { CSSProperties } from 'react';

export function LogOut({ size = 20 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-ui-icon="true"
      style={{ width: size, height: size, flexShrink: 0, '--icon-size': `${size}px` } as CSSProperties}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
