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
import { providerInfo } from './services/providers';
import { SettingsDialog, type Theme, type SettingsCategory } from './components/SettingsDialog';
function initialTheme(): Theme {
  const value = localStorage.getItem('copilot-theme');
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function App() {
  const isLoginWindow = location.hash === '#login';
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [collapsed, setCollapsed] = useState(false);
  const [settings, setSettings] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('general');
  const [returnToInterview, setReturnToInterview] = useState(false);
  const [startRequest, setStartRequest] = useState(0);
  const [personalDraft, setPersonalDraft] = useState(false);
  const [sessionStateError, setSessionStateError] = useState<string | null>(null);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const auth = useAuth();
  const transientChat = usePreparation((state) => state.streaming || !!state.chatStorageError);
  useEffect(() => {
    if (isLoginWindow) return;
    return window.desktop?.onSessionCloseRequested((id) => {
      const state = usePreparation.getState();
      state.stop();
      void state
        .restoreChats()
        .then(() => state.flushChats())
        .then((saved) => window.desktop?.finishSessionClose(id, saved))
        .catch(() => setSessionStateError('聊天尚未保存，窗口已保留，请重试。'));
    });
  }, [isLoginWindow]);
  useEffect(() => {
    if (isLoginWindow || !auth.session) return;
    let active = true;
    void window.desktop
      ?.updateSessionState(personalDraft || transientChat)
      .then(() => {
        if (active) setSessionStateError(null);
      })
      .catch(() => {
        if (active) setSessionStateError('无法更新关闭保护状态，请保留未保存内容后重试。');
      });
    return () => {
      active = false;
    };
  }, [isLoginWindow, auth.session, personalDraft, transientChat]);
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
      void useChatConnection.getState().load(auth.session.mode !== 'demo');
  }, [auth.session?.mode, isLoginWindow]);
  useEffect(() => {
    let active = true;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      document.documentElement.classList.toggle(
        'dark',
        theme === 'dark' || (theme === 'system' && media.matches),
      );
    apply();
    localStorage.setItem('copilot-theme', theme);
    if (window.desktop?.presentation?.nativeTheme) {
      void window.desktop
        .setNativeTheme(theme)
        .then(() => {
          if (active) setAppearanceError(null);
        })
        .catch(() => {
          if (active) setAppearanceError('无法同步应用外观，请退出后重新打开软件。');
        });
    }
    media.addEventListener('change', apply);
    return () => {
      active = false;
      media.removeEventListener('change', apply);
    };
  }, [theme]);
  return (
    <div
      className={`app-shell ${isLoginWindow ? 'login-shell' : ''} ${window.desktop?.nativeWindowControls ? 'native-window-controls' : 'custom-window-controls'}`}
    >
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
                auth.session.mode !== 'demo'
                  ? auth.session.user.email || `${providerInfo(auth.session.mode).name} 已连接`
                  : '未连接模型服务'
              }
              page={page}
              onNavigate={setPage}
              collapsed={collapsed}
              onCollapse={() => setCollapsed(!collapsed)}
              onNew={() => {
                usePreparation.getState().reset(true);
                setPage('preparation');
              }}
              onSettings={() => {
                setSettingsCategory('general');
                setReturnToInterview(false);
                setSettings(true);
              }}
              onLogout={async () => {
                usePreparation.getState().stop();
                if (!(await usePreparation.getState().flushChats())) return;
                if (await auth.signOut()) {
                  setSettings(false);
                  setPage('preparation');
                }
              }}
            />
            <div className="preparation-route" hidden={page !== 'preparation'}>
              <PreparationPage
                onDraftChange={setPersonalDraft}
                startRequest={startRequest}
                onInterviewSettings={() => {
                  setSettingsCategory('interview');
                  setReturnToInterview(true);
                  setSettings(true);
                }}
              />
            </div>
            {page === 'history' && <HistoryPage />}
            {page === 'knowledge' && <KnowledgePage />}
          </>
        )}
      </div>
      {(!isLoginWindow || window.desktop?.nativeWindowControls) && <TitleBar />}
      {(appearanceError || (auth.session && (auth.error || sessionStateError))) && (
        <div className="auth-error" role="alert">
          {appearanceError || auth.error || sessionStateError}
        </div>
      )}
      {settings && (
        <SettingsDialog
          initialCategory={settingsCategory}
          theme={theme}
          onThemeChange={setTheme}
          onClose={() => {
            setSettings(false);
            if (returnToInterview) {
              setReturnToInterview(false);
              setStartRequest((value) => value + 1);
            }
          }}
        />
      )}
    </div>
  );
}
