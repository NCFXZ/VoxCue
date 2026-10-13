import { useEffect, useState } from 'react';
import { StartupScreen } from './components/StartupScreen';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { PreparationPage } from './components/PreparationPage';
import { HistoryPage } from './components/HistoryPage';
import { KnowledgePage } from './components/KnowledgePage';
import { useDictation } from './stores/dictation';
import { usePreparation } from './stores/preparation';
import { useAuth } from './stores/auth';
import { LoginPage } from './components/LoginPage';
import { useChatConnection } from './stores/chatConnection';
import { useHistory } from './stores/history';
import { SettingsDialog, type Theme } from './components/SettingsDialog';
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
    if (isLoginWindow) return;
    return window.desktop?.onInterviewTitle((event) => {
      useHistory.getState().applyTitle(event);
      if (event.title) void useChatConnection.getState().refreshUsage();
    });
  }, []);
  useEffect(() => {
    const update = () =>
      usePreparation
        .getState()
        .setViewing(
          page === 'preparation' &&
            !!auth.session &&
            !settings &&
            document.visibilityState === 'visible' &&
            document.hasFocus(),
        );
    update();
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [page, settings, auth.session?.mode]);
  useEffect(() => {
    if (page !== 'preparation') void useDictation.getState().stop();
  }, [page]);
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
  return (
    <div className={`app-shell ${isLoginWindow ? 'login-shell' : ''}`}>
      {!isLoginWindow && <TitleBar />}
      <div className="app-body">
        {auth.loading ? (
          <StartupScreen />
        ) : isLoginWindow || !auth.session ? (
          <LoginPage />
        ) : (
          <>
            <Sidebar
              userName={auth.session.user.name}
              accountLabel={
                auth.session.mode === 'chatgpt'
                  ? auth.session.user.email || 'ChatGPT 已连接'
                  : 'ChatGPT 未连接'
              }
              page={page}
              onNavigate={setPage}
              collapsed={collapsed}
              onCollapse={() => setCollapsed(!collapsed)}
              onNew={() => {
                usePreparation.getState().reset(true);
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
            <div className="preparation-route" hidden={page !== 'preparation'}>
              <PreparationPage />
            </div>
            {page === 'history' && <HistoryPage />}
            {page === 'knowledge' && <KnowledgePage />}
          </>
        )}
      </div>
      {auth.session && auth.error && (
        <div className="auth-error" role="alert">
          {auth.error}
        </div>
      )}
      {settings && (
        <SettingsDialog theme={theme} onThemeChange={setTheme} onClose={() => setSettings(false)} />
      )}
    </div>
  );
}
