import { useEffect, useState } from 'react';
import { StartupScreen } from './components/StartupScreen';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { PreparationPage } from './components/PreparationPage';
import { HistoryPage } from './components/HistoryPage';
import { KnowledgePage } from './components/KnowledgePage';
import { usePreparation } from './stores/preparation';
import { useCloudSync } from './stores/cloudSync';
import { useKnowledge } from './stores/knowledge';
import { useCloudAccount } from './stores/cloudAccount';
import { useAuth } from './stores/auth';
import { useComponents } from './stores/components';
import { useUpdates } from './stores/updates';
import { LoginPage } from './components/LoginPage';
import { useChatConnection } from './stores/chatConnection';
import { useHistory } from './stores/history';
import { useCloudUsage } from './stores/cloudUsage';
import { Button } from './components/ui/button';
import { X } from './components/icons';
import { SettingsDialog, type Theme, type SettingsCategory } from './components/SettingsDialog';
function initialTheme(): Theme {
  const value = localStorage.getItem('copilot-theme');
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function App() {
  useEffect(() => useComponents.getState().connect(), []);
  const isLoginWindow = location.hash === '#login';
  useEffect(() => {
    if (!isLoginWindow) return useUpdates.getState().connect();
  }, [isLoginWindow]);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [collapsed, setCollapsed] = useState(false);
  const [settings, setSettings] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('account');
  const openComponentSettings = () => {
    setSettingsCategory('components');
    setSettings(true);
  };
  const [personalDraft, setPersonalDraft] = useState(false);
  const [sessionStateError, setSessionStateError] = useState<string | null>(null);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const [interviewNotice, setInterviewNotice] = useState<string | null>(null);
  useEffect(() => {
    if (isLoginWindow) return;
    return window.desktop?.onCloudUsageExpired?.((message) => {
      useHistory.getState().load();
      setInterviewNotice(message);
      void useCloudUsage.getState().run({ action: 'status' });
    });
  }, [isLoginWindow]);
  const auth = useAuth();
  const account = useCloudAccount();
  const signedIn = !!account.state.user || auth.session?.mode === 'demo';
  const showLogin = isLoginWindow || (account.loaded && !signedIn);
  useEffect(() => {
    if (account.loaded && !signedIn) setSettings(false);
  }, [account.loaded, signedIn]);
  useEffect(() => {
    const expired = () => {
      void useCloudAccount.getState().load();
    };
    window.addEventListener('voxcue-cloud-expired', expired);
    return () => window.removeEventListener('voxcue-cloud-expired', expired);
  }, []);
  useEffect(() => {
    if (isLoginWindow || !account.state.user) return;
    return useCloudSync.getState().connect(account.state.user.id);
  }, [isLoginWindow, account.state.user?.id, account.revision]);
  useEffect(() => {
    if (isLoginWindow) return;
    const applied = (event: Event) => {
      const type = (event as CustomEvent).detail;
      if (type === 'profile' || type === 'resume') void usePreparation.getState().load();
      if (type === 'record' || type === 'image') useHistory.getState().load();
      if (type === 'base' || type === 'file')
        void useKnowledge
          .getState()
          .load()
          .then(() => {
            const state = useKnowledge.getState();
            if (state.selectedId) return state.open(state.selectedId);
          });
    };
    window.addEventListener('voxcue-sync-applied', applied);
    return () => window.removeEventListener('voxcue-sync-applied', applied);
  }, [isLoginWindow]);
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
    if (isLoginWindow || !signedIn) return;
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
            !!signedIn &&
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
    void auth.load();
    void useCloudAccount.getState().load();
  }, []);
  useEffect(() => {
    if (!isLoginWindow && signedIn)
      void useChatConnection
        .getState()
        .load(!!auth.session && auth.session.mode !== 'demo', false, auth.session?.mode === 'demo');
  }, [auth.session?.mode, auth.session?.user.id, signedIn, isLoginWindow]);
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
      className={`app-shell ${showLogin ? 'login-shell' : ''} ${window.desktop?.platform === 'macos' ? 'native-window-controls' : 'custom-window-controls'}`}
    >
      <div className="app-body">
        {!account.loaded ? (
          <StartupScreen />
        ) : isLoginWindow || !signedIn ? (
          <LoginPage />
        ) : (
          <>
            <Sidebar
              userName={account.state.user?.email.split('@')[0] || '本地用户'}
              accountLabel={account.state.user?.email || '隔离测试'}
              page={page}
              onNavigate={setPage}
              collapsed={collapsed}
              onCollapse={() => setCollapsed(!collapsed)}
              onNew={() => {
                usePreparation.getState().reset(true);
                setPage('preparation');
              }}
              onSettings={() => {
                setSettingsCategory('account');
                setSettings(true);
              }}
              onLogout={async () => {
                usePreparation.getState().stop();
                if (!(await usePreparation.getState().flushChats())) return;
                try {
                  const result = await useCloudAccount.getState().call({ action: 'logout' });
                  if (result.ok) {
                    setSettings(false);
                    setPage('preparation');
                  } else setSessionStateError(result.error);
                } catch {
                  setSessionStateError('退出账号失败，窗口和本地资料已保留，请重试。');
                }
              }}
            />
            <div className="preparation-route" hidden={page !== 'preparation'}>
              <PreparationPage
                onDraftChange={setPersonalDraft}
                onComponentSettings={openComponentSettings}
                onSpeechSettings={() => {
                  setSettingsCategory('interview');
                  setSettings(true);
                }}
              />
            </div>
            {page === 'history' && <HistoryPage />}
            {page === 'knowledge' && <KnowledgePage onComponentSettings={openComponentSettings} />}
          </>
        )}
      </div>
      {!showLogin && <TitleBar />}
      {!showLogin && interviewNotice && (
        <div className="interview-end-notice" role="status">
          <span>{interviewNotice}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="关闭面试结束提示"
            onClick={() => setInterviewNotice(null)}
          >
            <X size={16} />
          </Button>
        </div>
      )}
      {(appearanceError || (signedIn && (sessionStateError || (!settings && auth.error)))) && (
        <div className="auth-error" role="alert">
          {appearanceError || sessionStateError || auth.error}
        </div>
      )}
      {settings && signedIn && (
        <SettingsDialog
          initialCategory={settingsCategory}
          theme={theme}
          onThemeChange={setTheme}
          onClose={() => {
            setSettings(false);
          }}
        />
      )}
    </div>
  );
}
