import type { DesktopAPI } from '../electron/contracts/desktop';

declare global {
  interface Window {
    desktop?: DesktopAPI;
  }
}
