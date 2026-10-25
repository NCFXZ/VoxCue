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
