import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Appearance,
  Settings,
  CircleHelp,
  Database,
  Monitor,
  Moon,
  Sun,
  X,
  Check,
  ChevronsUpDown,
  Person,
} from './icons';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import { UsagePanel } from './UsagePanel';
import { SpeechControls } from './SpeechControls';
import { useInterviewSettings } from '../stores/interviewSettings';
import { useChatConnection } from '../stores/chatConnection';
import { useAuth } from '../stores/auth';
import { version } from '../../package.json';

export type Theme = 'light' | 'dark' | 'system';
const categories = [
  { id: 'general', label: '常规', Icon: Appearance },
  { id: 'account', label: '账户与用量', Icon: Person },
  { id: 'interview', label: '面试设置', Icon: Settings },
  { id: 'about', label: '关于', Icon: CircleHelp },
] as const;
const themes = [
  { value: 'light', label: '浅色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon },
  { value: 'system', label: '跟随系统', Icon: Monitor },
] as const;

export function SettingsDialog({
  theme,
  onThemeChange,
  onClose,
}: {
  theme: Theme;
  onThemeChange(theme: Theme): void;
  onClose(): void;
}) {
  const [category, setCategory] = useState<(typeof categories)[number]['id']>('general');
  const session = useAuth((state) => state.session);
  const interview = useInterviewSettings();
  const connection = useChatConnection();
  const selectedTheme = themes.find((item) => item.value === theme)!;
  return (
    <Modal title="设置" className="settings-dialog" hideHeader onClose={onClose}>
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <Button variant="ghost" size="icon" aria-label="关闭设置" onClick={onClose}>
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
            {category === 'general' && (
              <>
                <div className="settings-entry">
                  <strong>主题</strong>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button className="settings-choice" aria-label="外观主题">
                        <selectedTheme.Icon size={18} />
                        {selectedTheme.label}
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
                            <DropdownMenu.ItemIndicator className="settings-theme-check">
                              <Check size={15} />
                            </DropdownMenu.ItemIndicator>
                          </DropdownMenu.RadioItem>
                        ))}
                      </DropdownMenu.RadioGroup>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </div>
                <p className="settings-hint">
                  模型与思考强度在聊天输入框中调整，回答风格在个人信息中设置。
                </p>
              </>
            )}
            {category === 'account' && (
              <>
                <div className="settings-entry settings-account">
                  <div>
                    <strong>{session?.user.name || '本机用户'}</strong>
                    <p>
                      {session?.mode === 'chatgpt'
                        ? session.user.email || 'ChatGPT 已连接'
                        : 'ChatGPT 未连接'}
                    </p>
                  </div>
                  <span className="settings-value">
                    {session?.mode === 'chatgpt' ? 'ChatGPT' : '未连接'}
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
                <p className="settings-hint">设置用于下一场面试。</p>
                {interview.error && (
                  <p role="alert" className="danger-text">
                    {interview.error}
                  </p>
                )}
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
                  <span className="settings-value">Windows</span>
                </div>
                <div className="settings-entry">
                  <strong>知识库</strong>
                  <span className="settings-value">
                    <Database size={16} />
                    本地文件存储
                  </span>
                </div>
                <p className="settings-hint">
                  通过聊天准备面试，整理个人资料、知识库与面试记录。面试使用本地语音转写与 ChatGPT
                  回答。
                </p>
              </>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}
