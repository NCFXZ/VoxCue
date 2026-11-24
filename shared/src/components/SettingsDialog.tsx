import { t } from '../i18n';
import { useLayoutEffect, useRef, useState } from 'react';
import { CloudAccountPanel } from './CloudAccountPanel';
import { useCloudAccount } from '../stores/cloudAccount';
import { AccountDeletionPanel } from './AccountDeletionPanel';
import { AccountExportPanel } from './AccountExportPanel';
import { SyncSettingsPanel } from './SyncSettingsPanel';
import { AIServicePanel } from './AIServicePanel';
import * as DropdownMenu from './ui/dropdown-menu';
import {
  Appearance,
  Settings,
  CircleHelp,
  Sparkles,
  SystemTheme,
  Moon,
  Sun,
  X,
  Check,
  Person,
  Download,
  Keyboard,
} from './icons';
import { Modal } from './ui/modal';
import { Button } from './ui/button';
import { switchView } from './ui/switchView';
import { useHeightTransition } from './ui/useHeightTransition';
import { SelectionLabel } from './SelectionLabel';
import { UpdatesPanel } from './UpdatesPanel';
import { ComponentsPanel } from './ComponentsPanel';
import { SpeechControls } from './SpeechControls';
import { InterviewInputModeControl } from './InterviewInputModeControl';
import { InterviewFontSettings } from './InterviewFontSettings';
import { InterviewReveal } from './InterviewReveal';
import { useInterviewSettings } from '../stores/interviewSettings';
import { useGeneralSettings } from '../stores/generalSettings';
import { useChatConnection } from '../stores/chatConnection';
import { pendingPresentation } from '../../electron/contracts/presentation';
import { ShortcutSettings } from './ShortcutSettings';
import { useSettingsTarget, type SettingsTarget } from './ui/useSettingsTarget';
import { useComponents } from '../stores/components';
import { componentSettingsTargets, type ComponentSettingsRequest } from '../services/componentSettingsTargets';

export type Theme = 'light' | 'dark' | 'system';
const categories = [
  { id: 'account', label: 'VoxCue 账号', Icon: Person },
  { id: 'ai', label: 'AI 服务', Icon: Sparkles },
  { id: 'components', label: '本地组件', Icon: Download },
  { id: 'interview', label: '面试设置', Icon: Settings },
  { id: 'general', label: '通用', Icon: Appearance },
  { id: 'shortcuts', label: '快捷键', Icon: Keyboard },
  { id: 'about', label: '关于与更新', Icon: CircleHelp },
] as const;
export type SettingsCategory = (typeof categories)[number]['id'] | 'updates';
export type SettingsDestination = SettingsTarget[] | ComponentSettingsRequest;
const themes = [
  { value: 'light', label: '浅色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon },
  { value: 'system', label: '跟随系统', Icon: SystemTheme },
] as const;
const languages = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
] as const;

export function SettingsDialog({
  theme,
  onThemeChange,
  onClose,
  initialCategory = 'account',
  initialTargets,
}: {
  theme: Theme;
  onThemeChange(theme: Theme): void;
  onClose(): void;
  initialCategory?: SettingsCategory;
  initialTargets?: SettingsDestination;
}) {
  const [category, setCategory] = useState<Exclude<SettingsCategory, 'updates'>>(
    initialCategory === 'updates' ? 'about' : initialCategory,
  );
  const presentation = window.desktop?.presentation ?? pendingPresentation;
  const interview = useInterviewSettings();
  const general = useGeneralSettings();
  const connection = useChatConnection();
  const cloudUser = useCloudAccount((state) => state.state.user);
  const selectedTheme = themes.find((item) => item.value === theme)!;
  const content = useRef<HTMLElement>(null);
  const [targets, setTargets] = useState(initialTargets);
  const componentRequest = Array.isArray(targets) ? undefined : targets;
  const catalog = useComponents((store) => componentRequest ? store.state : null);
  useLayoutEffect(() => {
    if (!componentRequest) return;
    const rows = componentSettingsTargets(catalog, componentRequest);
    if (rows) setTargets(rows);
  }, [catalog, componentRequest]);
  useSettingsTarget(content, Array.isArray(targets) ? targets : undefined);
  const interviewContent = useRef<HTMLDivElement>(null);
  useHeightTransition(`${category}:${interview.inputMode}`, () => [
    interviewContent.current?.querySelector<HTMLElement>(
      '.speech-controls > .speech-settings-section',
    ),
  ]);
  return (
    <Modal
      title={t('设置')}
      className="settings-dialog"
      hideHeader
      fixedHeader={false}
      onClose={onClose}
    >
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <Button
            variant="ghost"
            size="icon"
            className="dialog-close-button"
            aria-label={t('关闭设置')}
            onClick={onClose}
          >
            <X size={18} />
          </Button>
          <nav aria-label={t('设置分类')}>
            {categories.map(({ id, label, Icon }) => (
              <button
                key={id}
                aria-current={category === id ? 'page' : undefined}
                aria-controls="settings-content"
                onClick={() => {
                  if (category !== id) {
                    setTargets(undefined);
                    switchView(content.current, () => setCategory(id));
                  }
                }}
              >
                <Icon size={18} />
                <SelectionLabel>{t(label)}</SelectionLabel>
              </button>
            ))}
          </nav>
        </aside>
        <section
          ref={content}
          className="settings-content"
          id="settings-content"
          aria-labelledby="settings-category-title"
        >
          <header key={`${category}-heading`} className="settings-content-heading">
            <h2 id="settings-category-title">
              {t(categories.find((item) => item.id === category)!.label)}
            </h2>
          </header>
          <div key={category} className="settings-content-body">
            {category === 'components' && <ComponentsPanel />}
            {category === 'shortcuts' && <ShortcutSettings />}
            {category === 'general' && (
              <>
                <div className="settings-entry">
                  <strong>{t('主题')}</strong>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button
                        className="settings-choice settings-appearance-choice"
                        aria-label={t('外观主题')}
                      >
                        <selectedTheme.Icon size={18} />
                        <span className="settings-choice-label">{t(selectedTheme.label)}</span>
                        <DropdownMenu.TriggerChevron />
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
                            <span>{t(label)}</span>
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
                  <p className="settings-hint">{t('原生外观待适配，界面主题正常生效。')}</p>
                )}
                <div className="settings-entry">
                  <strong>{t('语言')}</strong>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button
                        className="settings-choice settings-appearance-choice"
                        aria-label={t('语言')}
                      >
                        <span className="settings-choice-label">
                          {languages.find((item) => item.value === general.language)!.label}
                        </span>
                        <DropdownMenu.TriggerChevron />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content
                      className="dropdown-content settings-theme-menu"
                      align="end"
                      sideOffset={6}
                    >
                      <DropdownMenu.RadioGroup
                        value={general.language}
                        onValueChange={(value) => {
                          const language = languages.find((item) => item.value === value);
                          if (language) general.setLanguage(language.value);
                        }}
                      >
                        {languages.map(({ value, label }) => (
                          <DropdownMenu.RadioItem
                            className="dropdown-item"
                            key={value}
                            value={value}
                          >
                            <span>{t(label)}</span>
                            <DropdownMenu.ItemIndicator className="settings-theme-check dropdown-check">
                              <Check size={15} />
                            </DropdownMenu.ItemIndicator>
                          </DropdownMenu.RadioItem>
                        ))}
                      </DropdownMenu.RadioGroup>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </div>
                <InterviewReveal>{general.error && (
                  <p role="alert" className="danger-text">
                    {t(general.error)}
                  </p>
                )}</InterviewReveal>
              </>
            )}
            {category === 'account' && (
              <>
                <CloudAccountPanel showTitle={false} />
                {cloudUser && (
                  <section aria-label={t('云同步')}>
                    <SyncSettingsPanel key={cloudUser.id} />
                  </section>
                )}
                <AccountExportPanel />
                <AccountDeletionPanel />
              </>
            )}
            {category === 'ai' && <AIServicePanel />}
            {category === 'interview' && (
              <>
                <InterviewInputModeControl
                  value={interview.inputMode}
                  onChange={interview.setInputMode}
                />
                <div ref={interviewContent}>
                  <SpeechControls
                    inputMode={interview.inputMode}
                    value={interview.configuration}
                    onChange={interview.update}
                    busy={false}
                    models={connection.models}
                    live={connection.live}
                    modelLoading={connection.loading}
                    modelError={connection.error}
                    refreshModels={() => void connection.load(true, true)}
                  />
                </div>
                <InterviewReveal>{interview.error && (
                  <p role="alert" className="danger-text">
                    {t(interview.error)}
                  </p>
                )}</InterviewReveal>
                <InterviewFontSettings />
              </>
            )}
            {category === 'about' && (
              <section className="settings-about-updates" aria-label={t('软件更新')}>
                <UpdatesPanel />
              </section>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}
