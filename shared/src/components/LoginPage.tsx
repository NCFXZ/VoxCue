import { X } from './icons';
import { InterviewPreview } from './InterviewPreview';
import { Button } from './ui/button';
import { useAuth } from '../stores/auth';
import chatGPTIcon from '../assets/chatgpt.svg?inline';
import { AppLogo } from './AppLogo';
export function LoginPage() {
  const auth = useAuth();
  return (
    <main className="login-page">
      <div className="login-card">
        <section className="login-form">
          <div className="login-copy">
            <div className="login-brand">
              <AppLogo size={42} />
              <span>VoxCue</span>
            </div>
            <h1>欢迎使用 VoxCue</h1>
            <p>登录以开始使用。</p>
          </div>
          <div className="login-actions">
            <Button
              variant="outline"
              className="service-login"
              data-native-control-style="standalone-glass"
              disabled={auth.waiting || !window.desktop}
              onClick={() => {
                void auth.signIn();
              }}
            >
              <img className="service-brand-icon" src={chatGPTIcon} alt="" aria-hidden="true" />
              {auth.signingIn === 'chatgpt' ? '等待浏览器授权…' : '使用 ChatGPT 继续'}
            </Button>
            {auth.waiting && (
              <Button
                variant="ghost"
                onClick={() => {
                  void auth.cancel();
                }}
              >
                <X size={16} />
                取消登录
              </Button>
            )}
            {(auth.error || auth.notice) && (
              <p className="login-status" role="alert">
                {auth.error || auth.notice}
              </p>
            )}
            {!window.desktop && <p className="login-status">账户登录需要在桌面应用中使用。</p>}
          </div>
          <div className="login-footer">
            <p>登录后即可准备聊天与面试回答，语音在本机转写。</p>
            <small>凭据由本机系统加密保护，密码仅在所选服务的官方页面输入。</small>
          </div>
        </section>
        <aside className="login-preview" aria-label="应用界面预览">
          <div className="login-preview-content" aria-hidden="true">
            <InterviewPreview compact label="面试界面预览" />
          </div>
        </aside>
      </div>
    </main>
  );
}
