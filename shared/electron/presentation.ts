import type { BrowserWindow, Rectangle } from 'electron';
import type { PresentationCapabilities } from './contracts/presentation';
import type {
  GlassButtonAction,
  GlassButtonPlacement,
  NativeMenuRequest,
  ScrollChromeState,
  ContentControlPlacement,
  InterviewMaterialPlacement,
} from './contracts/desktop';
/** Fixed native binding, resolved by main from the selected platform's resources. */
export interface NativeMaterial {
  readonly available?: boolean;
  configureInterviewAppearance(handle: Buffer): void;
  configureInterviewMaterials(handle: Buffer, materials: InterviewMaterialPlacement[]): boolean;
  configureContentControls(
    handle: Buffer,
    controls: ContentControlPlacement[],
    changed: (id: number, value: string | boolean | number) => void,
  ): boolean;
  configureScrollChrome(handle: Buffer, state: ScrollChromeState | null): boolean;
  attachSurface(handle: Buffer, foreground: Buffer, kind: 'composer' | 'follow'): boolean;
  detachSurface(handle: Buffer, kind: 'composer' | 'follow'): void;
  popUpMenu(handle: Buffer, request: NativeMenuRequest): number | null;
  apply(
    handle: Buffer,
    width: number,
    toolbarHeight: number,
    surfaceColor: string,
    dark: boolean,
  ): boolean;
  configureButton(
    handle: Buffer,
    action: GlassButtonAction,
    placement: GlassButtonPlacement | null,
    clicked: () => void,
  ): boolean;
}
/** Main owns session/window lifetimes; this port only applies native presentation. */
export interface NativePresentation {
  setInterviewMaterials?(win: BrowserWindow, materials: InterviewMaterialPlacement[]): boolean;
  setContentControls?(
    win: BrowserWindow,
    controls: ContentControlPlacement[],
    changed: (id: number, value: string | boolean | number) => void,
  ): boolean;
  configureMain?(win: BrowserWindow): void;
  setScrollChrome?(win: BrowserWindow, state: ScrollChromeState | null): boolean;
  popUpNativeMenu?(win: BrowserWindow, request: NativeMenuRequest): number | null;
  setSidebarGlass?(
    win: BrowserWindow,
    width: number,
    toolbarHeight?: number,
    surfaceColor?: string,
    dark?: boolean,
  ): boolean;
  setGlassButton?(
    win: BrowserWindow,
    action: GlassButtonAction,
    placement: GlassButtonPlacement | null,
    clicked: () => void,
  ): boolean;
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
