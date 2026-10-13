import { ArrowUp, Sparkles, Volume2, Check } from './icons';
import { Button } from './ui/button';
import { useAuth } from '../stores/auth';
import chatGPTIcon from '../assets/chatgpt.svg';
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
            <h1>欢迎回来</h1>
            <p>登录以开始使用。</p>
          </div>
          <div className="login-actions">
            <Button
              className="chatgpt-login"
              disabled={auth.waiting || !window.desktop}
              onClick={() => {
                void auth.signIn();
              }}
            >
              <img className="chatgpt-icon" src={chatGPTIcon} alt="" aria-hidden="true" />
              {auth.waiting ? '等待浏览器授权…' : 'Continue with ChatGPT'}
            </Button>
            <p className="login-explanation">使用 ChatGPT 账户，在系统浏览器中安全授权。</p>
            {auth.waiting && (
              <Button
                variant="ghost"
                onClick={() => {
                  void auth.cancel();
                }}
              >
                取消登录
              </Button>
            )}
            {(auth.error || auth.notice) && (
              <p className="login-status" role="alert">
                {auth.error || auth.notice}
              </p>
            )}
            {!window.desktop && <p className="login-status">ChatGPT 登录需要在桌面应用中使用。</p>}
          </div>
          <div className="login-footer">
            <p>登录后使用 ChatGPT 准备聊天与面试回答，语音在本机转写。</p>
            <small>凭据加密保存在本机，密码仅在 OpenAI 页面输入。</small>
          </div>
        </section>
        <aside className="login-preview" aria-label="应用界面预览">
          <div className="preview-landscape" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="login-preview-content" aria-hidden="true">
            <div className="preview-pill">
              <AppLogo size={13} />
              <strong>VoxCue</strong>
              <span>面试助手</span>
              <Check size={12} />
            </div>
            <div className="preview-panels">
              <div className="preview-panel">
                <header>
                  <Volume2 size={12} />
                  转写
                </header>
                <small>面试官</small>
                <p>请介绍一个你最有代表性的项目。</p>
                <span className="preview-caption">本地转写</span>
              </div>
              <div className="preview-panel">
                <header>
                  <Sparkles size={12} />
                  回答
                </header>
                <p>可以从背景、个人贡献和结果展开。</p>
                <div className="preview-lines">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <div className="preview-input">
                  输入问题…
                  <ArrowUp size={13} />
                </div>
              </div>
            </div>
            <p className="login-preview-label">从准备到表达，保持从容。</p>
          </div>
        </aside>
      </div>
    </main>
  );
}
