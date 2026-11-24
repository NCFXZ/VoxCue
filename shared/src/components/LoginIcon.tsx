import type { CSSProperties } from 'react';

export function LogIn({ size = 20 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-ui-icon="true"
      style={{ width: size, height: size, flexShrink: 0, '--icon-size': `${size}px` } as CSSProperties}
    >
      <rect x="4.8" y="5.25" width="9.5" height="13.5" rx="1.8" />
      <path d="M19.6 12H9m3.2-3.2L9 12l3.2 3.2" />
    </svg>
  );
}
