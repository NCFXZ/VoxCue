import { t } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { StartupScreen } from './components/StartupScreen';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { PreparationPage } from './components/PreparationPage';
import { HistoryPage } from './components/HistoryPage';
import { KnowledgePage } from './components/KnowledgePage';
import { usePreparation } from './stores/preparation';
import { useCloudSync } from './stores/cloudSync';
import { useKnowledge } from './stores/knowledge';
import { useKnowledgeIndex } from './stores/knowledgeIndex';
import { useCloudAccount } from './stores/cloudAccount';
import { useAuth } from './stores/auth';
import { useComponents, useComponentReady } from './stores/components';
import { useUpdates } from './stores/updates';
import { LoginPage } from './components/LoginPage';
import { useChatConnection } from './stores/chatConnection';
import { watchInterviewModel } from './stores/interviewSettings';
import { useHistory } from './stores/history';
import { SettingsDialog, type Theme, type SettingsCategory, type SettingsDestination } from './components/SettingsDialog';
import { signalTelemetry, recordFeature } from './services/telemetry';
import { switchView } from './components/ui/switchView';
import { observeLocalImportRevision, refreshLocalImportRevision } from './services/localImportRevision';
import { ConflictSettingsContext, type SettingsTarget } from './components/ui/useSettingsTarget';
import type { OpenComponentSettings } from './services/componentSettingsTargets';
function initialTheme(): Theme {
  const value = localStorage.getItem('copilot-theme');
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function App() {
  const isLoginWindow = location.hash === '#login';
  useEffect(() => {
    if (!isLoginWindow) return useUpdates.getState().connect();
  }, [isLoginWindow]);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [collapsed, setCollapsed] = useState(false);
  const [settings, setSettings] = useState<{ category: SettingsCategory; targets: SettingsDestination } | null>(null);
  const openSettings = (category: SettingsCategory, ...targets: SettingsTarget[]) => {
    setSettings({ category, targets });
  };
  const openComponentSettings: OpenComponentSettings = (request) =>
    setSettings({ category: 'components', targets: request });
  const [personalDraft, setPersonalDraft] = useState(false);
  const [sessionStateError, setSessionStateError] = useState<string | null>(null);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const auth = useAuth();
  const account = useCloudAccount();
  useEffect(() => {
    if (!isLoginWindow && account.state.localMode)
      return observeLocalImportRevision(() => setSessionStateError('无法检查本地账户中的资料。'));
  }, [isLoginWindow, account.state.localMode]);
  const signedIn =
    !!account.state.user || !!account.state.localMode || auth.session?.mode === 'demo';
  useEffect(() => {
    // Model integrity checks can read several gigabytes. Start them for the first
    // model-consuming UI; the hidden language window and login form need none.
    if (!isLoginWindow && signedIn) return useComponents.getState().connect();
  }, [isLoginWindow, signedIn]);
  useEffect(() => {
    if (!isLoginWindow && signedIn) return watchInterviewModel();
  }, [isLoginWindow, signedIn]);
  useEffect(() => {
    if (isLoginWindow || !signedIn) return;
    const recoverDrafts = () => { void useHistory.getState().recoverDrafts(); };
    recoverDrafts();
    void useHistory.getState().recoverRecordings();
    window.addEventListener('focus', recoverDrafts);
    return () => window.removeEventListener('focus', recoverDrafts);
  }, [isLoginWindow, signedIn]);
  const ragReady = useComponentReady('rag');
  useEffect(() => {
    if (isLoginWindow || !signedIn) return;
    return useKnowledgeIndex.getState().connect();
  }, [isLoginWindow, signedIn]);
  useEffect(() => {
    if (!isLoginWindow && signedIn && ragReady) void useKnowledgeIndex.getState().reconcile();
  }, [isLoginWindow, signedIn, ragReady]);
  const showLogin = isLoginWindow || (account.loaded && !signedIn);
  useEffect(() => {
    if (account.loaded) signalTelemetry({ type: 'ready' });
  }, [account.loaded]);
  useEffect(() => {
    if (account.loaded && !signedIn) setSettings(null);
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
    let refreshingKnowledge = false;
    let knowledgePending = false;
    let closed = false;
    const refreshKnowledge = async () => {
      if (refreshingKnowledge) return;
      refreshingKnowledge = true;
      try {
        do {
          knowledgePending = false;
          await useKnowledge.getState().load();
          if (closed) return;
          const state = useKnowledge.getState();
          if (state.selectedId) await state.open(state.selectedId);
        } while (knowledgePending && !closed);
      } finally {
        refreshingKnowledge = false;
      }
    };
    const applied = (event: Event) => {
      const type = (event as CustomEvent).detail;
      if (type === 'profile' || type === 'resume') void usePreparation.getState().load();
      if (type === 'record' || type === 'image') useHistory.getState().load();
      if (type === 'base' || type === 'file') {
        knowledgePending = true;
        void refreshKnowledge();
      }
    };
    window.addEventListener('voxcue-sync-applied', applied);
    return () => {
      closed = true;
      window.removeEventListener('voxcue-sync-applied', applied);
    };
  }, [isLoginWindow]);
  const transientChat = usePreparation((state) => state.anyStreaming || !!state.chatStorageError);
  useEffect(() => {
    if (isLoginWindow) return;
    return window.desktop?.onSessionCloseRequested((id) => {
      const state = usePreparation.getState();
      state.stopAll();
      void state
        .restoreChats()
        .then(() => state.flushChats())
        .then(async (saved) => {
          if (saved && useCloudAccount.getState().state.localMode)
            await refreshLocalImportRevision().catch(() => setSessionStateError('无法检查本地账户中的资料。'));
          return window.desktop?.finishSessionClose(id, saved);
        })
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
  }, [isLoginWindow, signedIn, personalDraft, transientChat]);
  const [page, setPage] = useState<'preparation' | 'history' | 'knowledge'>('preparation');
  const stage = useRef<HTMLDivElement>(null);
  const requestedPage = useRef(page);
  useEffect(() => {
    requestedPage.current = page;
  }, [page]);
  const navigate = (next: typeof page, prepare?: () => void) => {
    if (next === requestedPage.current) {
      if (!prepare) return;
      if (page === next && !stage.current?.style.viewTransitionName) {
        prepare();
        return;
      }
    }
    requestedPage.current = next;
    switchView(stage.current, () => {
      prepare?.();
      setPage(next);
    });
  };
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
  }, [page, settings, signedIn]);
  useEffect(() => {
    if (!isLoginWindow) void useAuth.getState().restoreOnStartup();
    void useCloudAccount.getState().load();
  }, [isLoginWindow]);
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
          <ConflictSettingsContext.Provider value={() => openSettings('account', 'sync-conflicts')}>
            <Sidebar
              userName={account.state.user?.email.split('@')[0] || t('本地用户')}
              accountLabel={
                account.state.user?.email ||
                (account.state.localMode ? t('本地账户') : t('隔离测试'))
              }
              localMode={account.state.localMode}
              page={page}
              onNavigate={(next, prepare) => {
                if (next === 'history') recordFeature('history_view');
                if (next === 'knowledge') recordFeature('knowledge_view');
                navigate(next, prepare);
              }}
              collapsed={collapsed}
              onCollapse={() => setCollapsed(!collapsed)}
              onNew={() => navigate('preparation', () => usePreparation.getState().reset(true))}
              onSettings={() => openSettings('account')}
              onLogout={async () => {
                usePreparation.getState().stopAll();
                if (!(await usePreparation.getState().flushChats())) return;
                try {
                  const account = useCloudAccount.getState();
                  if (!account.state.user && !account.state.localMode && auth.session?.mode === 'demo') {
                    await auth.signOut();
                    return;
                  }
                  const result = account.state.localMode
                    ? await account.setLocalMode(false)
                    : await account.call({ action: 'logout' });
                  if (result.ok) {
                    setSettings(null);
                    setPage('preparation');
                  } else setSessionStateError(result.error);
                } catch {
                  setSessionStateError('退出账号失败，窗口和本地资料已保留，请重试。');
                }
              }}
            />
            <div className="page-stage" ref={stage}>
              <div className="preparation-route" hidden={page !== 'preparation'}>
                <PreparationPage
                  visible={page === 'preparation'}
                  onDraftChange={setPersonalDraft}
                  onComponentSettings={openComponentSettings}
                  onAISettings={(locateProviders) =>
                    locateProviders ? openSettings('ai', 'chatgpt', 'copilot') : openSettings('ai')}
                  onSpeechSettings={() => openSettings('interview', 'speech-device', 'speech-model')}
                  onImportSettings={() => openSettings('account', 'account-migration')}
                />
              </div>
              {page === 'history' && <HistoryPage />}
              {page === 'knowledge' && (
                <KnowledgePage onComponentSettings={openComponentSettings} />
              )}
            </div>
          </ConflictSettingsContext.Provider>
        )}
      </div>
      {!showLogin && <TitleBar />}
      {(appearanceError || (signedIn && (sessionStateError || (!settings && auth.error)))) && (
        <div className="auth-error" role="alert">
          {t(appearanceError || sessionStateError || auth.error)}
        </div>
      )}
      {settings && signedIn && (
        <SettingsDialog
          initialCategory={settings.category}
          initialTargets={settings.targets}
          theme={theme}
          onThemeChange={setTheme}
          onClose={() => {
            setSettings(null);
          }}
        />
      )}
    </div>
  );
}
