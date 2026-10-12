import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun, Settings, Appearance } from './components/icons';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { PreparationPage } from './components/PreparationPage';
import { HistoryPage } from './components/HistoryPage';
import { KnowledgePage } from './components/KnowledgePage';
import { usePreparation } from './stores/preparation';
import { useAuth } from './stores/auth';
import { LoginPage } from './components/LoginPage';
import { useChatConnection } from './stores/chatConnection';
import { Modal } from './components/ui/modal';
type Theme = 'light' | 'dark' | 'system';
function initialTheme(): Theme {
  const value = localStorage.getItem('copilot-theme');
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function App() {
  const isLoginWindow = location.hash === '#login';
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [collapsed, setCollapsed] = useState(false);
  const [settings, setSettings] = useState(false);
  const auth = useAuth();
  const [page, setPage] = useState<'preparation' | 'history' | 'knowledge'>('preparation');
  useEffect(() => {
    void auth.load();
  }, []);
  useEffect(() => {
    if (!isLoginWindow && auth.session)
      void useChatConnection.getState().load(auth.session.mode === 'chatgpt');
  }, [auth.session?.mode, isLoginWindow]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      document.documentElement.classList.toggle(
        'dark',
        theme === 'dark' || (theme === 'system' && media.matches),
      );
    apply();
    localStorage.setItem('copilot-theme', theme);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettings(false);
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  return (
    <div className={`app-shell ${isLoginWindow ? 'login-shell' : ''}`}>
      {!isLoginWindow && <TitleBar />}
      <div className="app-body">
        {auth.loading ? (
          <main className="login-loading">正在读取登录状态…</main>
        ) : isLoginWindow || !auth.session ? (
          <LoginPage />
        ) : (
          <>
            <Sidebar
              userName={auth.session.user.name}
              accountLabel={
                auth.session.mode === 'chatgpt'
                  ? auth.session.user.email || 'ChatGPT 已连接'
                  : '单用户 · Mock 演示'
              }
              page={page}
              onNavigate={setPage}
              collapsed={collapsed}
              onCollapse={() => setCollapsed(!collapsed)}
              onNew={() => {
                usePreparation.getState().reset();
                setPage('preparation');
              }}
              onSettings={() => setSettings(true)}
              onLogout={async () => {
                if (await auth.signOut()) {
                  usePreparation.getState().reset();
                  usePreparation.setState({ conversations: [] });
                  setSettings(false);
                  setPage('preparation');
                }
              }}
            />
            {page === 'history' ? (
              <HistoryPage />
            ) : page === 'knowledge' ? (
              <KnowledgePage />
            ) : (
              <PreparationPage />
            )}
          </>
        )}
      </div>
      {auth.session && auth.error && (
        <div className="auth-error" role="alert">
          {auth.error}
        </div>
      )}
      {settings && (
        <Modal
          title="设置"
          subtitle="调整应用的外观与显示。"
          icon={<Settings size={20} />}
          className="settings-dialog"
          closeLabel="关闭设置"
          onClose={() => setSettings(false)}
        >
          <div className="setting-row">
            <div>
              <strong className="setting-label">
                <Appearance size={17} />外观主题
              </strong>
              <p>浅色、深色或跟随系统。</p>
            </div>
            <div className="theme-options">
              {(
                [
                  { value: 'light', Icon: Sun, label: '浅色' },
                  { value: 'dark', Icon: Moon, label: '深色' },
                  { value: 'system', Icon: Monitor, label: '系统' },
                ] as const
              ).map(({ value, Icon, label }) => (
                <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)}>
                  <Icon size={17} />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-note">
            <p>模型与思考强度在聊天输入框中调整；回答风格在个人信息中设置。</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
