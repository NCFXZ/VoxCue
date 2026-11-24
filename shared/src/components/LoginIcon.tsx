import type { CSSProperties } from 'react';

// Feather log-in, paired with the existing LogOut icon.
export function LogIn({ size = 20 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-ui-icon="true"
      style={{ width: size, height: size, flexShrink: 0, '--icon-size': `${size}px` } as CSSProperties}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
    </svg>
  );
}
