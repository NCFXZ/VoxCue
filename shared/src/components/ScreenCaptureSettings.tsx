import { useEffect, useRef, useState } from 'react';
import type {
  ScreenCapturePermission,
  ScreenCapturePermissionAction,
} from '../../electron/contracts/screenCapture';
import { Button } from './ui/button';
export function ScreenCaptureSettings({ disabled }: { disabled: boolean }) {
  const supported = window.desktop?.screenCapturePermissionSupported === true;
  const [permission, setPermission] = useState<ScreenCapturePermission | null>(null);
  const [pending, setPending] = useState<ScreenCapturePermissionAction | null>(
    supported ? 'check' : null,
  );
  const [error, setError] = useState('');
  const generation = useRef(0);
  const mounted = useRef(false);
  const requesting = useRef(false);
  const run = async (action: ScreenCapturePermissionAction) => {
    if (!supported || !window.desktop || requesting.current) return;
    const attempt = ++generation.current;
    requesting.current = action !== 'check';
    setPending(action);
    setError('');
    try {
      const result = await window.desktop.screenCapturePermission(action);
      if (mounted.current && attempt === generation.current) setPermission(result);
    } catch {
      if (mounted.current && attempt === generation.current)
        setError('操作失败，请重试或打开系统设置。');
    } finally {
      if (attempt === generation.current) {
        requesting.current = false;
        if (mounted.current) setPending(null);
      }
    }
  };
  useEffect(() => {
    if (!supported) return;
    mounted.current = true;
    void run('check');
    const refresh = () => void run('check');
    window.addEventListener('focus', refresh);
    return () => {
      mounted.current = false;
      ++generation.current;
      window.removeEventListener('focus', refresh);
    };
  }, [supported]);
  const granted = permission?.status === 'granted';
  const notRequired = permission?.status === 'not-required';
  return (
    <section className="speech-settings-section screen-capture-settings" aria-label="屏幕捕获权限">
      <div className="screen-capture-row">
        <div className="screen-capture-summary">
          <div className="screen-capture-heading">
            <h3>{notRequired ? '屏幕捕获' : '允许捕获屏幕'}</h3>
            <span className="screen-capture-status" role="status" aria-label="屏幕捕获权限状态">
              {!supported
                ? '待适配'
                : pending === 'request'
                  ? '正在申请…'
                  : pending === 'check'
                    ? '正在检查…'
                    : notRequired
                      ? '无需单独授权'
                      : granted
                        ? '已允许'
                        : permission?.status === 'restricted'
                          ? '受系统限制'
                          : permission?.status === 'error' || permission?.status === 'unknown'
                            ? '无法确认'
                            : '未允许'}
            </span>
          </div>
          <p className="screen-capture-description">
            {notRequired ? permission.message + ' ' : ''}仅在截图时使用，不持续录屏。
          </p>
        </div>
        {!notRequired && (
          <div className="screen-capture-actions">
            <Button
              type="button"
              variant="outline"
              disabled={!supported || disabled || !!pending || granted}
              onClick={() => void run('request')}
            >
              {!supported
                ? '待适配'
                : granted
                  ? '已允许'
                  : pending === 'request'
                    ? '正在申请…'
                    : '申请权限'}
            </Button>
          </div>
        )}
      </div>
      {(error || permission?.status === 'error' || permission?.status === 'unknown') && (
        <p role="alert" className="danger-text">
          {error || permission?.message}
        </p>
      )}
    </section>
  );
}
