import type { BrowserWindow, Rectangle } from 'electron';
import type { PresentationCapabilities } from './contracts/presentation';
/** Main owns session/window lifetimes; this port only applies native presentation. */
export interface NativePresentation {
  moveInterview?(win: BrowserWindow, bounds: Rectangle): void;
  readonly capabilities?: PresentationCapabilities;
  initialize(): void;
  setTheme(theme: 'light' | 'dark' | 'system'): void;
  pinInterview(win: BrowserWindow): void;
  prepareInterview(win: BrowserWindow): void;
  hideMain(win: BrowserWindow): void;
  hideInterviewIcon(): void;
  restoreInterviewIcon(): Promise<void>;
  setMousePassthrough(win: BrowserWindow, ignore: boolean): void;
  dispose(): void;
}
