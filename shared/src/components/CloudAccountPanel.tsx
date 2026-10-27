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
      if (!result.ok) {
        setError(result.error);
        if (result.retryAfterSeconds) setBlockedUntil(Date.now() + result.retryAfterSeconds * 1000);
        return;
      }
      if (result.challenge) {
        setChallenge({
          id: result.challenge.id,
          expiresAt: Date.now() + result.challenge.expiresInSeconds * 1000,
        });
        setResendAt(Date.now() + result.challenge.retryAfterSeconds * 1000);
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
          {displayError}
          {retryHint && ` ${retryHint}`}
        </p>
      )}
      {message && (
        <p className="settings-hint" role="status">
          {message}
        </p>
      )}
      {!displayError && retryHint && (
        <p className="settings-hint" role="status">
          {retryHint}
        </p>
      )}
    </>
  );
  return (
    <section className="cloud-account-panel" aria-label="VoxCue 账号" aria-busy={busy}>
      {showTitle && <h3>VoxCue 账号</h3>}
      {!loaded ? (
        <p role="status" className="settings-hint">
          正在读取账号状态…
        </p>
      ) : !state.configured && !entry ? (
        <p className="settings-hint">无法连接账号服务，请检查配置后重新打开应用。</p>
      ) : state.user ? (
        <>
          <div className="settings-entry">
            <div>
              <strong>{state.user.email}</strong>
              <p className="settings-hint">{state.verified ? '已登录' : '暂未验证连接状态'}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={blocked}
              onClick={() => void run({ action: 'logout' })}
            >
              <LogOut size={16} />
              退出账号
            </Button>
          </div>
        </>
      ) : (
        <>
          {!entry && (
            <div className="cloud-account-modes" aria-label="账号操作">
              {(
                [
                  ['login', '登录'],
                  ['register', '注册'],
                  ['reset', '找回密码'],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant={mode === value ? 'outline' : 'ghost'}
                  aria-pressed={mode === value}
                  disabled={busy}
                  onClick={() => changeMode(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          )}
          <form className="cloud-account-form" noValidate={entry} onSubmit={submit}>
            <label>
              邮箱
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
              {mode === 'reset' ? '新密码' : '密码'}
              <input
                name="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder={
                  mode === 'login'
                    ? '输入密码'
                    : `${CLOUD_PASSWORD_MIN}–${CLOUD_PASSWORD_MAX} 个字符`
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
                  <label htmlFor={codeId}>邮箱验证码</label>
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
                      {resendSeconds > 0 ? resendSeconds + '秒后重发' : '获取验证码'}
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
                ? '处理中…'
                : mode === 'login'
                  ? '登录'
                  : mode === 'register'
                    ? '创建账号'
                    : '重置密码'}
            </Button>
          </form>
          {entry && (
            <div className="login-form-links">
              {mode === 'login' ? (
                <>
                  <span>
                    还没有账号？
                    <Button
                      type="button"
                      variant="ghost"
                      className="auth-text-link"
                      disabled={busy}
                      onClick={() => changeMode('register')}
                    >
                      注册
                    </Button>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="auth-text-link"
                    disabled={busy}
                    onClick={() => changeMode('reset')}
                  >
                    找回密码
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
                  返回登录
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
