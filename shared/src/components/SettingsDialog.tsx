import { useEffect } from 'react';
import { useKnowledgeIndex } from '../stores/knowledgeIndex';
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
  RotateCcw,
} from './icons';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import { ChoiceMenu } from './ui/choice-menu';
import { UsagePanel } from './UsagePanel';
import { UpdatesPanel } from './UpdatesPanel';
import { useModelProvider } from './useModelProvider';
import { providerInfo } from '../services/providers';
import { SpeechControls } from './SpeechControls';
import { useInterviewSettings } from '../stores/interviewSettings';
import { useChatConnection } from '../stores/chatConnection';
import { useAuth } from '../stores/auth';
import { version } from '../../../package.json';
import { accentOptions, readAccentPreference, saveAccentPreference } from '../systemAccent';

export type Theme = 'light' | 'dark' | 'system';
const categories = [
  { id: 'general', label: '常规', Icon: Appearance },
  { id: 'account', label: '账户与用量', Icon: Person },
  { id: 'interview', label: '面试设置', Icon: Settings },
  { id: 'knowledge', label: '知识库', Icon: Database },
  { id: 'updates', label: '更新', Icon: RotateCcw },
  { id: 'about', label: '关于', Icon: CircleHelp },
] as const;
export type SettingsCategory = (typeof categories)[number]['id'];
const themes = [
  { value: 'light', label: '浅色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon },
  { value: 'system', label: '跟随系统', Icon: Monitor },
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
  const [accent, setAccent] = useState(readAccentPreference);
  const [accentError, setAccentError] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setAccent(readAccentPreference());
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);
  const knowledge = useKnowledgeIndex();
  useEffect(() => knowledge.connect(), []);
  const session = useAuth((state) => state.session);
  const interview = useInterviewSettings();
  const connection = useChatConnection();
  const provider = useModelProvider();
  const accountProvider = providerInfo(session?.mode);
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
            {category === 'updates' && <UpdatesPanel />}
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
                <div className="settings-entry">
                  <strong>主题色</strong>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button className="settings-choice" aria-label="主题色">
                        {accent === 'system' ? (
                          <Monitor size={18} />
                        ) : (
                          <span className="accent-swatch" style={{ background: accent }} />
                        )}
                        {accentOptions.find((option) => option.value === accent)!.label}
                        <ChevronsUpDown size={14} />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content
                      className="dropdown-content settings-theme-menu"
                      align="end"
                      sideOffset={6}
                    >
                      <DropdownMenu.RadioGroup
                        value={accent}
                        onValueChange={(value) => {
                          const option = accentOptions.find((option) => option.value === value);
                          if (!option) return;
                          try {
                            saveAccentPreference(option.value);
                            setAccent(option.value);
                            setAccentError(null);
                          } catch {
                            setAccentError('主题色保存失败，请检查本地存储后重试。');
                          }
                        }}
                      >
                        {accentOptions.map((option) => (
                          <DropdownMenu.RadioItem
                            className="dropdown-item"
                            key={option.value}
                            value={option.value}
                          >
                            {option.value === 'system' ? (
                              <Monitor size={16} />
                            ) : (
                              <span
                                className="accent-swatch"
                                style={{ background: option.value }}
                              />
                            )}
                            <span>{option.label}</span>
                            <DropdownMenu.ItemIndicator className="settings-theme-check">
                              <Check size={15} />
                            </DropdownMenu.ItemIndicator>
                          </DropdownMenu.RadioItem>
                        ))}
                      </DropdownMenu.RadioGroup>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </div>
                {accentError && (
                  <p className="danger-text" role="alert">
                    {accentError}
                  </p>
                )}
              </>
            )}
            {category === 'knowledge' && (
              <>
                <div className="settings-entry">
                  <strong>资料使用方式</strong>
                  <ChoiceMenu
                    className="settings-choice"
                    label="资料使用方式"
                    value={knowledge.state?.mode ?? 'local'}
                    options={
                      [
                        { value: 'local', label: '自动查找相关资料（默认）' },
                        { value: 'function', label: '由模型按需查找' },
                      ] as const
                    }
                    onChange={(mode) => void knowledge.setMode(mode)}
                  />
                </div>
                <p className="settings-hint">
                  默认在回答前自动查找相关资料；按需方式由当前账户模型决定是否查询。资料原件保存在本机，必要片段会发送至
                  {provider.dataRecipient}。
                </p>
                <div className="settings-entry">
                  <strong>本机资料</strong>
                  <span className="settings-value">
                    {knowledge.state?.documents.filter((doc) => doc.available !== false).length ??
                      0}{' '}
                    个可用文档 · {knowledge.state?.modelReady ? '模型文件就绪' : '模型未安装'}
                  </span>
                </div>
                {knowledge.state && !knowledge.state.modelReady && (
                  <p className="inline-error" role="alert">
                    资料处理组件缺失。请使用包含本地模型的完整安装包修复安装；文档原件已保留。
                  </p>
                )}
                {knowledge.error && (
                  <p role="alert" className="inline-error">
                    {knowledge.error}
                  </p>
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
              </>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}
