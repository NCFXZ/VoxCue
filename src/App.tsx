import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun, X, AudioLines } from './components/icons';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { PreparationPage } from './components/PreparationPage';
import { HistoryPage } from './components/HistoryPage';
import { KnowledgePage } from './components/KnowledgePage';
import { Button } from './components/ui/button';
import { usePreparation } from './stores/preparation';
import { mockAuth } from './services/mock';
type Theme = 'light' | 'dark' | 'system';
function initialTheme(): Theme {
  const value = localStorage.getItem('copilot-theme');
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [collapsed, setCollapsed] = useState(false);
  const [settings, setSettings] = useState(false);
  const [loggedOut, setLoggedOut] = useState(false);
  const [page, setPage] = useState<'preparation' | 'history' | 'knowledge'>('preparation');
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
    <div className="app-shell">
      <TitleBar />
      <div className="app-body">
        <Sidebar
          page={page}
          onNavigate={setPage}
          collapsed={collapsed}
          onCollapse={() => setCollapsed(!collapsed)}
          onNew={() => {
            usePreparation.getState().reset();
            setPage('preparation');
          }}
          onSettings={() => setSettings(true)}
          onLogout={() => {
            usePreparation.getState().reset();
            void mockAuth.signOut();
            setLoggedOut(true);
          }}
        />
        {loggedOut ? (
          <main className="workspace signed-out">
            <AudioLines size={42} />
            <h1>已退出模拟会话</h1>
            <p>当前为本地演示，未连接认证服务。</p>
            <Button
              onClick={async () => {
                await mockAuth.signIn();
                setLoggedOut(false);
              }}
            >
              返回本地演示
            </Button>
          </main>
        ) : page === 'history' ? (
          <HistoryPage />
        ) : page === 'knowledge' ? (
          <KnowledgePage />
        ) : (
          <PreparationPage />
        )}
      </div>
      {settings && (
        <div className="modal-backdrop" onClick={() => setSettings(false)}>
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p className="eyebrow">PREFERENCES</p>
                <h2 id="settings-title">设置</h2>
              </div>
              <Button
                autoFocus
                variant="ghost"
                size="icon"
                aria-label="关闭设置"
                onClick={() => setSettings(false)}
              >
                <X size={18} />
              </Button>
            </header>
            <div className="setting-row">
              <div>
                <strong>外观主题</strong>
                <p>选择适合你的工作空间</p>
              </div>
              <div className="theme-options">
                {(
                  [
                    { value: 'light', Icon: Sun, label: '浅色' },
                    { value: 'dark', Icon: Moon, label: '深色' },
                    { value: 'system', Icon: Monitor, label: '系统' },
                  ] as const
                ).map(({ value, Icon, label }) => (
                  <button
                    key={value}
                    aria-pressed={theme === value}
                    onClick={() => setTheme(value)}
                  >
                    <Icon size={17} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-note">
              <span className="mock-badge">
                <span />
                前端演示
              </span>
              <p>模型与音频设置将在后续模块开发。</p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
