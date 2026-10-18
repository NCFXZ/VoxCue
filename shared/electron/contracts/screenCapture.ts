export type ScreenCapturePermissionAction = 'check' | 'request' | 'open-settings';
export interface ScreenCapturePermission {
  status:
    'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' | 'error' | 'not-required';
  message: string;
}
export interface ScreenCaptureAccess {
  call(action: ScreenCapturePermissionAction): Promise<ScreenCapturePermission>;
}
