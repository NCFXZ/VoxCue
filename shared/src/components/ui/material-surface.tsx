import type { MaterialSurfaceProps } from '../../platform/controls';

// Shared remains the sole owner of form content, layout and business state.
export function MaterialSurface({ children }: MaterialSurfaceProps) {
  return <>{children}</>;
}
