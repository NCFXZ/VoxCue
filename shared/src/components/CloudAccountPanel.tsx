import { t } from '../i18n';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { CloudAccountCall } from '../../electron/contracts/cloudAccount';
import { Button } from './ui/button';
import { useCloudAccount } from '../stores/cloudAccount';
import { LogOut } from './icons';
import {
  validCloudEmail,
  normalizeCloudPassword,
  CLOUD_PASSWORD_MIN,
  CLOUD_PASSWORD_MAX,
} from '../../electron/contracts/cloudAccount';

type Mode = 'login' | 'register' | 'reset';
export function CloudAccountPanel({
  showTitle = true,
  entry = false,
  onModeChange,
}: {
  showTitle?: boolean;
  entry?: boolean;
  onModeChange?(mode: Mode): void;
}) {
  const codeId = useId();
  const { state, loaded } = useCloudAccount();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; expiresAt: number }>();
  const [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [resendAt, setResendAt] = useState(0),
    [blockedUntil, setBlockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const alive = useRef(true),
    locked = useRef(false);
  async function run(call: CloudAccountCall) {
    if (locked.current) return;
    if (!window.desktop?.cloudAccount) {
      setError('请在桌面应用中使用账号服务。');
      return;
    }
    locked.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await useCloudAccount.getState().call(call);
      if (!alive.current) return;
      const receivedAt = Date.now();
      setNow(receivedAt);
      if (!result.ok) {
        setError(result.error);
        if (result.retryAfterSeconds) setBlockedUntil(receivedAt + result.retryAfterSeconds * 1000);
        return;
      }
      if (result.challenge) {
        setChallenge({
          id: result.challenge.id,
          expiresAt: receivedAt + result.challenge.expiresInSeconds * 1000,
        });
        setResendAt(receivedAt + result.challenge.retryAfterSeconds * 1000);
        setMessage('验证码将发送至邮箱，请检查收件箱和垃圾邮件。');
      }
      if (result.message) setMessage(result.message);
      if (call.action === 'login' || call.action === 'register' || call.action === 'reset') {
        setPassword('');
        setCode('');
        setChallenge(undefined);
        if (call.action === 'reset') {
          setMode('login');
          onModeChange?.('login');
        }
      }
    } catch {
      if (alive.current) {
        setError('账号服务暂不可用，请稍后重试。');
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function changeLocalMode(enabled: boolean) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await useCloudAccount.getState().setLocalMode(enabled);
      if (alive.current && !result.ok) setError(result.error);
    } catch {
      if (alive.current)
        setError(
          enabled ? '无法进入本地账户，请检查本地存储后重试。' : '无法打开登录界面，请重试。',
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    if (!useCloudAccount.getState().loaded) void useCloudAccount.getState().load();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);
  function changeMode(next: Mode) {
    setMode(next);
    onModeChange?.(next);
    setPassword('');
    setCode('');
    setChallenge(undefined);
    setMessage('');
    setError('');
    setResendAt(0);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || locked.current || Date.now() < blockedUntil) return;
    setMessage('');
    if (!validCloudEmail(email)) {
      setError('请输入有效的邮箱地址。');
      return;
    }
    if (!password) {
      setError('请输入密码。');
      return;
    }
    if (normalizeCloudPassword(password) === undefined) {
      setError('密码包含无效字符或过长，请重新输入。');
      return;
    }
    if (mode !== 'login') {
      const normalized = normalizeCloudPassword(password),
        size = normalized ? Array.from(normalized).length : 0;
      if (size < CLOUD_PASSWORD_MIN || size > CLOUD_PASSWORD_MAX) {
        setError(`密码需要${CLOUD_PASSWORD_MIN}至${CLOUD_PASSWORD_MAX}个字符。`);
        return;
      }
      if (!/^\d{6}$/.test(code)) {
        setError('请输入六位邮箱验证码。');
        return;
      }
    }
    if (mode === 'login') void run({ action: 'login', email, password });
    else if (challenge && challenge.expiresAt > Date.now())
      void run({ action: mode, email, password, code, challengeId: challenge.id });
    else setError('请先获取新的验证码。');
  }
  const blocked = busy || now < blockedUntil || !state.configured;
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const displayError =
    error || (loaded && !state.configured ? '无法连接账号服务，请检查配置后重新打开应用。' : '');
  const retryHint =
    now < blockedUntil ? `请在${Math.ceil((blockedUntil - now) / 1000)}秒后重试。` : '';
  const feedback = (
    <>
      {displayError && (
        <p className="danger-text" role="alert">
          {t(displayError)}
          {retryHint && ` ${t(retryHint)}`}
        </p>
      )}
      {message && (
        <p className="settings-hint" role="status">
          {t(message)}
        </p>
      )}
      {!displayError && retryHint && (
        <p className="settings-hint" role="status">
          {t(retryHint)}
        </p>
      )}
    </>
  );
  return (
    <section className="cloud-account-panel" aria-label={t('VoxCue 账号')} aria-busy={busy}>
      {showTitle && <h3>{t('VoxCue 账号')}</h3>}
      {!loaded ? (
        <p role="status" className="settings-hint">
          {t('正在读取账号状态…')}
        </p>
      ) : !state.configured && !entry && !state.localMode ? (
        <p className="settings-hint">{t('无法连接账号服务，请检查配置后重新打开应用。')}</p>
      ) : state.user ? (
        <>
          <div className="settings-entry">
            <div>
              <strong>{state.user.email}</strong>
              <p className="settings-hint">
                {state.verified ? t('已登录') : t('暂未验证连接状态')}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={blocked}
              onClick={() => void run({ action: 'logout' })}
            >
              <LogOut size={16} />
              {t('退出账号')}
            </Button>
          </div>
        </>
      ) : !entry ? (
        <div className="settings-entry">
          <div>
            <strong>{t('本地账户')}</strong>
            <p className="settings-hint">
              {t('尚未登录 VoxCue，资料保存在当前电脑。登录后可启用云备份。')}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void changeLocalMode(false)}
          >
            {t('登录')}
          </Button>
        </div>
      ) : (
        <>
          <form className="cloud-account-form" noValidate={entry} onSubmit={submit}>
            <label>
              {t('邮箱')}
              <input
                name="email"
                type="email"
                autoComplete="username"
                placeholder="name@example.com"
                maxLength={254}
                required
                value={email}
                disabled={busy}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setChallenge(undefined);
                  setCode('');
                  setError('');
                  setMessage('');
                }}
              />
            </label>
            <label>
              {mode === 'reset' ? t('新密码') : t('密码')}
              <input
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder={
                  mode === 'login' ? t('输入密码') : t('不少于{0}个字符', [CLOUD_PASSWORD_MIN])
                }
                minLength={mode === 'login' ? 1 : CLOUD_PASSWORD_MIN}
                maxLength={1024}
                required
                value={password}
                disabled={busy}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError('');
                }}
              />
            </label>
            {mode !== 'login' && (
              <>
                <div className="cloud-verification">
                  <label htmlFor={codeId}>{t('邮箱验证码')}</label>
                  <span className="cloud-code-row">
                    <input
                      id={codeId}
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      value={code}
                      disabled={busy}
                      onChange={(event) => {
                        setCode(event.target.value.replace(/\D/g, ''));
                        setError('');
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={blocked || resendSeconds > 0 || !validCloudEmail(email)}
                      onClick={() =>
                        void run({
                          action: 'code',
                          email,
                          purpose: mode === 'register' ? 'register' : 'reset',
                        })
                      }
                    >
                      {resendSeconds > 0 ? t('{0}秒后重发', [resendSeconds]) : t('获取验证码')}
                    </Button>
                  </span>
                </div>
              </>
            )}
            {entry && (displayError || message || now < blockedUntil) && (
              <div className="cloud-account-feedback">{feedback}</div>
            )}
            <Button type="submit" disabled={blocked || (mode !== 'login' && !challenge)}>
              {busy
                ? t('处理中…')
                : mode === 'login'
                  ? t('登录')
                  : mode === 'register'
                    ? t('创建账号')
                    : t('重置密码')}
            </Button>
            {entry && mode === 'login' && (
              <Button
                type="button"
                variant="outline"
                className="login-skip-button"
                disabled={busy}
                onClick={() => void changeLocalMode(true)}
              >
                {t('跳过登录')}
              </Button>
            )}
          </form>
          {entry && (
            <div className="login-form-links">
              {mode === 'login' ? (
                <>
                  <span>
                    {t('还没有账号？')}
                    <Button
                      type="button"
                      variant="ghost"
                      className="auth-text-link"
                      disabled={busy}
                      onClick={() => changeMode('register')}
                    >
                      {t('注册')}
                    </Button>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="auth-text-link"
                    disabled={busy}
                    onClick={() => changeMode('reset')}
                  >
                    {t('找回密码')}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="auth-text-link"
                  disabled={busy}
                  onClick={() => changeMode('login')}
                >
                  {t('返回登录')}
                </Button>
              )}
            </div>
          )}
        </>
      )}
      {(!entry || state.user) && feedback}
    </section>
  );
}
