/** Available native effects. Shared controls remain visible when an effect is pending. */
export interface PresentationCapabilities {
  readonly frostedTransparency: boolean;
  readonly nativeTheme: boolean;
  readonly screenCapturePermission: boolean;
  readonly interviewMousePassthrough: boolean;
  readonly interviewIconVisibility: boolean;
}

export const pendingPresentation: PresentationCapabilities = Object.freeze({
  frostedTransparency: false,
  nativeTheme: false,
  screenCapturePermission: false,
  interviewMousePassthrough: false,
  interviewIconVisibility: false,
});

/** CSS pixels relative to the owning web contents. Only geometry and theme cross the bridge. */
export interface ApiKeyField {
  x: number;
  y: number;
  width: number;
  height: number;
  dark: boolean;
}
export type ApiKeyPromptCommand =
  | { action: 'layout'; field: ApiKeyField }
  | { action: 'visibility'; visible: boolean }
  | { action: 'submit' | 'cancel' | 'focus' };
