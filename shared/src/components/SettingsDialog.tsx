import { useState } from 'react';
import * as DropdownMenu from './ui/dropdown-menu';
import {
  Appearance,
  Settings,
  CircleHelp,
  Database,
  SystemTheme,
  Moon,
  Sun,
  X,
  Check,
  ChevronsUpDown,
  Person,
  Update,
  Download,
} from './icons';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import { UsagePanel } from './UsagePanel';
import { UpdatesPanel } from './UpdatesPanel';
import { ComponentsPanel } from './ComponentsPanel';
import { providerInfo } from '../services/providers';
import { SpeechControls } from './SpeechControls';
import { InterviewFontSettings } from './InterviewFontSettings';
import { useInterviewSettings } from '../stores/interviewSettings';
import { useChatConnection } from '../stores/chatConnection';
import { useAuth } from '../stores/auth';
import { version } from '../../package.json';
import { pendingPresentation } from '../../electron/contracts/presentation';

export type Theme = 'light' | 'dark' | 'system';
const platformLabels = { macos: 'macOS', windows: 'Windows', unknown: '未知平台' };
const categories = [
  { id: 'general', label: '个性化', Icon: Appearance },
  { id: 'components', label: '本地组件', Icon: Download },
  { id: 'account', label: '账户与用量', Icon: Person },
  { id: 'interview', label: '面试设置', Icon: Settings },
  { id: 'updates', label: '更新', Icon: Update },
  { id: 'about', label: '关于', Icon: CircleHelp },
] as const;
export type SettingsCategory = (typeof categories)[number]['id'];
const themes = [
  { value: 'light', label: '浅色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon },
  { value: 'system', label: '跟随系统', Icon: SystemTheme },
] as const;

export function SettingsDialog({
  theme,
  onThemeChange,
  onClose,
  initialCategory = 'general',
}: {
  theme: Theme;
  onThemeChange(theme: Theme): void;
  onClose(): void;
  initialCategory?: SettingsCategory;
}) {
  const [category, setCategory] = useState<SettingsCategory>(initialCategory);
  const presentation = window.desktop?.presentation ?? pendingPresentation;
  const session = useAuth((state) => state.session);
  const interview = useInterviewSettings();
  const connection = useChatConnection();
  const accountProvider = providerInfo(session?.mode);
  const selectedTheme = themes.find((item) => item.value === theme)!;
  return (
    <Modal title="设置" className="settings-dialog" hideHeader onClose={onClose}>
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <Button
            variant="ghost"
            size="icon"
            className="dialog-close-button"
            aria-label="关闭设置"
            onClick={onClose}
          >
            <X size={18} />
          </Button>
          <nav aria-label="设置分类">
            {categories.map(({ id, label, Icon }) => (
              <button
                key={id}
                aria-current={category === id ? 'page' : undefined}
                aria-controls="settings-content"
                onClick={() => setCategory(id)}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>
        <section
          className="settings-content"
          id="settings-content"
          aria-labelledby="settings-category-title"
          key={category}
        >
          <header className="settings-content-heading">
            <h2 id="settings-category-title">
              {categories.find((item) => item.id === category)!.label}
            </h2>
          </header>
          <div className="settings-content-body">
            {category === 'updates' && <UpdatesPanel />}
            {category === 'components' && <ComponentsPanel />}
            {category === 'general' && (
              <>
                <div className="settings-entry">
                  <strong>主题</strong>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button
                        className="settings-choice settings-appearance-choice"
                        aria-label="外观主题"
                      >
                        <selectedTheme.Icon size={18} />
                        <span className="settings-choice-label">{selectedTheme.label}</span>
                        <ChevronsUpDown size={14} />
                      </button>
                    </DropdownMenu.Trigger>
                    {/* Keep the menu inside the native dialog's top layer. */}
                    <DropdownMenu.Content
                      className="dropdown-content settings-theme-menu"
                      align="end"
                      sideOffset={6}
                    >
                      <DropdownMenu.RadioGroup
                        value={theme}
                        onValueChange={(value) => onThemeChange(value as Theme)}
                      >
                        {themes.map(({ value, label, Icon }) => (
                          <DropdownMenu.RadioItem
                            className="dropdown-item"
                            key={value}
                            value={value}
                          >
                            <Icon size={16} />
                            <span>{label}</span>
                            <DropdownMenu.ItemIndicator className="settings-theme-check dropdown-check">
                              <Check size={15} />
                            </DropdownMenu.ItemIndicator>
                          </DropdownMenu.RadioItem>
                        ))}
                      </DropdownMenu.RadioGroup>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </div>
                {!presentation.nativeTheme && (
                  <p className="settings-hint">原生外观待适配，界面主题正常生效。</p>
                )}
              </>
            )}
            {category === 'account' && (
              <>
                <div className="settings-entry settings-account">
                  <div>
                    <strong>{session?.user.name || '本机用户'}</strong>
                    <p>
                      {session && session.mode !== 'demo'
                        ? session.user.email || `${accountProvider.name} 已连接`
                        : '未连接模型服务'}
                    </p>
                  </div>
                  <span className="settings-value">
                    {session && session.mode !== 'demo' ? accountProvider.name : '未连接'}
                  </span>
                </div>
                <UsagePanel />
              </>
            )}
            {category === 'interview' && (
              <>
                <SpeechControls
                  value={interview.configuration}
                  onChange={interview.update}
                  busy={false}
                  models={connection.models}
                  live={connection.live}
                />
                {interview.error && (
                  <p role="alert" className="danger-text">
                    {interview.error}
                  </p>
                )}
                <InterviewFontSettings />
              </>
            )}
            {category === 'about' && (
              <>
                <div className="settings-entry">
                  <strong>VoxCue</strong>
                  <span className="settings-value">{version}</span>
                </div>
                <div className="settings-entry">
                  <strong>平台</strong>
                  <span className="settings-value">
                    {platformLabels[window.desktop?.platform ?? 'unknown']}
                  </span>
                </div>
                <div className="settings-entry">
                  <strong>知识库</strong>
                  <span className="settings-value">
                    <Database size={16} />
                    本地文件存储
                  </span>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}
