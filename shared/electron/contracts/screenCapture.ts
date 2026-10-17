export type ScreenCapturePermissionAction = 'check' | 'request' | 'open-settings';
export interface ScreenCapturePermission {
  status: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' | 'error';
  message: string;
}
export interface ScreenCaptureAccess {
  call(action: ScreenCapturePermissionAction): Promise<ScreenCapturePermission>;
}
