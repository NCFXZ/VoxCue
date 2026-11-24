import { t } from '../i18n';
import { InterviewPreview } from './InterviewPreview';
import { AppLogo } from './AppLogo';
import { CloudAccountPanel } from './CloudAccountPanel';
import { useState } from 'react';
export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  return (
    <main className="login-page">
      <div className="login-drag-region" aria-hidden="true" />
      <div className="login-card">
        <section className="login-form">
          <div className="login-brand">
            <AppLogo size={28} />
            <span>VoxCue</span>
          </div>
          <div className="login-auth-content" data-mode={mode}>
            <div className="login-copy">
              <h1>
                {mode === 'login'
                  ? t('登录 VoxCue')
                  : mode === 'register'
                    ? t('创建账号')
                    : t('重置密码')}
              </h1>
            </div>
            <CloudAccountPanel showTitle={false} entry onModeChange={setMode} />
          </div>
          <div className="login-footer">
            <small>{t('登录凭据由本机系统加密保护。')}</small>
          </div>
        </section>
        <aside className="login-preview" aria-label={t('应用界面预览')}>
          <div className="login-preview-content" aria-hidden="true" inert>
            <InterviewPreview compact label={t('面试界面预览')} />
          </div>
        </aside>
      </div>
    </main>
  );
}
