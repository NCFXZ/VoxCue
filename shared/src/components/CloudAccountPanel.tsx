import { t, uiLocale } from '../i18n';
import { InterviewReveal } from './InterviewReveal';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { CloudAccountCall } from '../../electron/contracts/cloudAccount';
import { Button } from './ui/button';
import { useCloudAccount } from '../stores/cloudAccount';
import { LogIn } from './icons';
import { LogOut } from './LogoutIcon';
import { VerificationCodeInput } from './VerificationCodeInput';
import { PasswordInput } from './ui/password-input';
import './cloudAccountPanel.css';
import {
  validCloudEmail,
  normalizeCloudPassword,
  userAgreementUrl,
  CLOUD_PASSWORD_MIN,
  CLOUD_PASSWORD_MAX,
} from '../../electron/contracts/cloudAccount';

type Mode = 'login' | 'register' | 'reset';
type Field = 'email' | 'password' | 'code';
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
  const consentId = useId();
  const language = uiLocale();
  const emailId = useId(),
    passwordId = useId();
  const { state, loaded } = useCloudAccount();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('login');
  const [acceptedAgreement, setAcceptedAgreement] = useState(false);
  const [agreementLinkFailed, setAgreementLinkFailed] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; expiresAt: number }>();
  const [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [feedbackField, setFeedbackField] = useState<Field>('email');
  const emailInput = useRef<HTMLInputElement>(null),
    passwordInput = useRef<HTMLInputElement>(null);
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
    if (call.action === 'login' || call.action === 'register' || call.action === 'reset')
      setPasswordVisible(false);
    setBusy(true);
    setError('');
    setMessage('');
    setFeedbackField(call.action === 'code' ? 'code' : 'password');
    try {
      const result = await useCloudAccount.getState().call(call);
      if (!alive.current) return;
      const receivedAt = Date.now();
      setNow(receivedAt);
      if (!result.ok) {
        if (result.error === '邮箱或密码不正确。') {
          setFeedbackField('password');
          setError('密码不正确。');
        } else if (result.error === '验证码无效或已过期。') {
          setFeedbackField('code');
          setError('验证码不正确。');
        } else {
          if (/密码/.test(result.error)) setFeedbackField('password');
          setError(result.error);
        }
        if (result.retryAfterSeconds) setBlockedUntil(receivedAt + result.retryAfterSeconds * 1000);
        return;
      }
      if (result.challenge) {
        setChallenge({
          id: result.challenge.id,
          expiresAt: receivedAt + result.challenge.expiresInSeconds * 1000,
        });
        setResendAt(receivedAt + result.challenge.retryAfterSeconds * 1000);
      }
      if (result.message) setMessage(result.message);
      if (call.action === 'login' || call.action === 'register' || call.action === 'reset') {
        setAcceptedAgreement(false);
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
    setFeedbackField('email');
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
    setAcceptedAgreement(false);
    setAgreementLinkFailed(false);
    setPasswordVisible(false);
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
    if (busy || state.signInUnavailable || locked.current || Date.now() < blockedUntil) return;
    if (mode === 'register' && !acceptedAgreement) return;
    setMessage('');
    setError('');
    if (!validCloudEmail(email)) {
      setFeedbackField('email');
      setError('邮箱格式不正确。');
      emailInput.current?.focus();
      return;
    }
    if (!password) {
      setFeedbackField('password');
      if (mode === 'login') setError('密码不正确。');
      passwordInput.current?.focus();
      return;
    }
    if (normalizeCloudPassword(password) === undefined) {
      setFeedbackField('password');
      setError('密码不正确。');
      passwordInput.current?.focus();
      return;
    }
    if (mode !== 'login') {
      const normalized = normalizeCloudPassword(password),
        size = normalized ? Array.from(normalized).length : 0;
      if (size < CLOUD_PASSWORD_MIN || size > CLOUD_PASSWORD_MAX) {
        setFeedbackField('password');
        if (size > CLOUD_PASSWORD_MAX) setError('密码不正确。');
        passwordInput.current?.focus();
        return;
      }
      if (!/^\d{6}$/.test(code)) {
        setFeedbackField('code');
        setError('验证码不正确。');
        return;
      }
    }
    if (mode === 'login') void run({ action: 'login', email, password });
    else if (challenge && challenge.expiresAt > Date.now())
      void run({ action: mode, email, password, code, challengeId: challenge.id });
    else {
      setFeedbackField('code');
      setError('验证码不正确。');
    }
  }
  const fieldsDisabled = busy || !!state.signInUnavailable;
  const blocked = fieldsDisabled || now < blockedUntil || !state.configured;
  const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const displayError =
    error || state.signInUnavailable || (loaded && !state.configured ? '无法连接账号服务，请检查配置后重新打开应用。' : '');
  const retryHint =
    now < blockedUntil ? `请在${Math.ceil((blockedUntil - now) / 1000)}秒后重试。` : '';
  const feedback = (
    <>
      <InterviewReveal resizeKey={`${displayError}:${!!retryHint}`}>
        {displayError ? (
          <p className="danger-text" role="alert">
            {t(displayError)}
            {retryHint && ` ${t(retryHint)}`}
          </p>
        ) : null}
      </InterviewReveal>
      <InterviewReveal>
        {message ? <p className="settings-hint" role="status">{t(message)}</p> : null}
      </InterviewReveal>
      <InterviewReveal>
        {!displayError && retryHint ? <p className="settings-hint" role="status">{t(retryHint)}</p> : null}
      </InterviewReveal>
    </>
  );
  function fieldFeedback(field: Field) {
    const fieldError = feedbackField === field ? error : '';
    const configurationError = field === 'email' && !error ? displayError : '';
    const fieldMessage = feedbackField === field ? message : '';
    const hint =
      field === 'password' && mode !== 'login' ? t('不少于{0}个字符', [CLOUD_PASSWORD_MIN]) : '';
    const retry = feedbackField === field ? retryHint : '';
    if (!fieldError && !configurationError && !fieldMessage && !hint && !retry) return null;
    const text = t(fieldError || configurationError || fieldMessage) || hint;
    return (
      <p
        key={`${text}:${!!retry}`}
        id={`${field === 'email' ? emailId : field === 'password' ? passwordId : codeId}-feedback`}
        className={`cloud-field-feedback ${fieldError || configurationError ? 'danger-text' : 'settings-hint'}`}
        role={
          fieldError || configurationError ? 'alert' : fieldMessage || retry ? 'status' : undefined
        }
      >
        {text}
        {retry && ` ${t(retry)}`}
      </p>
    );
  }
  const emailFeedback = fieldFeedback('email'),
    passwordFeedback = fieldFeedback('password'),
    codeFeedback = fieldFeedback('code');
  return (
    <section className="cloud-account-panel" aria-label={t('VoxCue 账号')} aria-busy={busy}>
      {showTitle && <h3>{t('VoxCue 账号')}</h3>}
      {!loaded ? (
        <p role="status" className="settings-hint">
          {t('正在读取账号状态…')}
        </p>
      ) : !state.configured && !entry && !state.localMode ? null : state.user ? (
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
              {t('资料保存在本机，登录后可迁移至 VoxCue 账号。')}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void changeLocalMode(false)}
          >
            <LogIn size={16} />
            {t('登录')}
          </Button>
        </div>
      ) : (
        <>
          <form className="cloud-account-form" noValidate={entry} onSubmit={submit}>
            <div className="cloud-account-field">
              <label htmlFor={emailId}>{t('邮箱')}</label>
              <input
                ref={emailInput}
                id={emailId}
                name="email"
                type="email"
                autoComplete="username"
                placeholder="name@example.com"
                maxLength={254}
                required
                value={email}
                disabled={fieldsDisabled}
                aria-invalid={(feedbackField === 'email' && !!error) || undefined}
                aria-describedby={emailFeedback ? `${emailId}-feedback` : undefined}
                onBlur={(event) => {
                  // Leaving the form must not insert validation and move the
                  // navigation button between the pointer press and release.
                  const next = event.relatedTarget;
                  const form = event.currentTarget.form;
                  if (
                    form &&
                    next instanceof Element &&
                    form.parentElement?.contains(next) &&
                    (next.closest('.login-skip-button') ||
                      (!form.contains(next) && next.closest('.login-form-links')))
                  )
                    return;
                  if (email && !validCloudEmail(email)) {
                    setFeedbackField('email');
                    setError('邮箱格式不正确。');
                  }
                }}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setChallenge(undefined);
                  setCode('');
                  setError('');
                  setMessage('');
                }}
              />
              <InterviewReveal resizeKey={emailFeedback?.key ?? ''}>{emailFeedback}</InterviewReveal>
            </div>
            <div className="cloud-account-field">
              <label htmlFor={passwordId}>{mode === 'reset' ? t('新密码') : t('密码')}</label>
              <PasswordInput
                id={passwordId}
                inputRef={passwordInput}
                name="password"
                visible={passwordVisible}
                onVisibilityChange={setPasswordVisible}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder={t('输入密码')}
                minLength={mode === 'login' ? 1 : CLOUD_PASSWORD_MIN}
                maxLength={1024}
                required
                value={password}
                disabled={fieldsDisabled}
                aria-invalid={(feedbackField === 'password' && !!error) || undefined}
                aria-describedby={passwordFeedback ? `${passwordId}-feedback` : undefined}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError('');
                }}
              />
              <InterviewReveal resizeKey={passwordFeedback?.key ?? ''}>{passwordFeedback}</InterviewReveal>
            </div>
            {mode !== 'login' && (
              <>
                <div className="cloud-verification">
                  <label htmlFor={codeId}>{t('邮箱验证码')}</label>
                  <div className="cloud-code-row">
                    <VerificationCodeInput
                      id={codeId}
                      value={code}
                      disabled={fieldsDisabled}
                      invalid={feedbackField === 'code' && !!error}
                      describedBy={codeFeedback ? `${codeId}-feedback` : undefined}
                      onChange={(value) => {
                        setCode(value);
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
                  </div>
                  <InterviewReveal resizeKey={codeFeedback?.key ?? ''}>{codeFeedback}</InterviewReveal>
                </div>
              </>
            )}
            {mode === 'register' && (
              <div className="registration-consent selection-option">
                <input
                  id={consentId}
                  type="checkbox"
                  required
                  checked={acceptedAgreement}
                  disabled={busy}
                  aria-labelledby={`${consentId}-text`}
                  onChange={(event) => setAcceptedAgreement(event.currentTarget.checked)}
                />
                <span id={`${consentId}-text`}>
                  <label htmlFor={consentId}>{t('我已阅读并同意')}</label>
                  {' '}
                  <a
                    href={userAgreementUrl[language]}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => {
                      if (!window.desktop) return;
                      event.preventDefault();
                      setAgreementLinkFailed(false);
                      void window.desktop.openUserAgreement(language).catch(() => {
                        if (alive.current) setAgreementLinkFailed(true);
                      });
                    }}
                  >
                    {t('VoxCue 用户服务协议')}
                  </a>{language === 'en' ? '.' : '。'}
                </span>
                <InterviewReveal>
                  {agreementLinkFailed ? <p role="alert" className="danger-text">{t('无法打开链接。')}</p> : null}
                </InterviewReveal>
              </div>
            )}
            <Button
              type="submit"
              disabled={blocked || (mode !== 'login' && !challenge) || (mode === 'register' && !acceptedAgreement)}
            >
              {!entry && mode === 'login' && <LogIn size={16} />}
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
