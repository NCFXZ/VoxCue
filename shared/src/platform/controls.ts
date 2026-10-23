import type { ReactNode } from 'react';
import type { ButtonProps } from '../components/ui/button';
import type { GlassButtonAction } from '../../electron/contracts/desktop';

// Presentation ports share semantics and geometry, never native rendering.
export interface MaterialButtonProps extends ButtonProps {
  materialAction: GlassButtonAction;
}
export interface MaterialSurfaceProps {
  children: ReactNode;
  kind?: 'composer' | 'follow';
  active?: boolean;
}
