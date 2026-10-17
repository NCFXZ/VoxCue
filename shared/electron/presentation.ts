import type { BrowserWindow } from 'electron';

/** Main owns session/window lifetimes; this port only applies native presentation. */
export interface NativePresentation {
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
