import { t } from '../i18n';
import { X } from './icons';
import { Button } from './ui/button';
import {
  defaultShortcuts,
  displayShortcut,
  shortcutActions,
  shortcutLabels,
  interviewShortcutLabel,
  interviewToggleLabels,
  type ShortcutBindings,
  type ShortcutConflict,
  type InterviewShortcutStatus,
} from '../../electron/contracts/shortcuts';

export function InterviewShortcutHelp({
  onClose,
  bindings = defaultShortcuts(),
  conflicts = [],
  deviceConnected = false,
  status,
}: {
  onClose(): void;
  bindings?: ShortcutBindings;
  conflicts?: ShortcutConflict[];
  deviceConnected?: boolean;
  status?: InterviewShortcutStatus;
}) {
  const mac = typeof window !== 'undefined' && window.desktop?.platform === 'macos';
  const row = (action: (typeof shortcutActions)[number]) => (
    <div key={action} data-shortcut-action={action}>
      <dt>
        <span className="floating-shortcut-action-label">
          {t(status ? interviewShortcutLabel(action, status) : shortcutLabels[action])}
        </span>
        {status &&
          interviewToggleLabels[action]?.map((label) => (
            <span className="floating-shortcut-label-width" aria-hidden="true" key={label}>
              {t(label)}
            </span>
          ))}
      </dt>
      <dd>
        {conflicts.some((item) => item.action === action) ? (
          <span className="danger-text">{t('不可用')}</span>
        ) : (
          <kbd>{t(displayShortcut(bindings[action], mac))}</kbd>
        )}
      </dd>
    </div>
  );
  return (
    <section
      id="interview-shortcut-help"
      aria-labelledby="interview-shortcut-heading"
      className="floating-panel floating-shortcut-help"
      data-shortcut-platform={mac ? 'macos' : undefined}
    >
      <header>
        <h2 id="interview-shortcut-heading">{t('快捷键')}</h2>
        <Button variant="ghost" size="icon" aria-label={t('关闭快捷键帮助')} onClick={onClose}>
          <X size={16} />
        </Button>
      </header>
      <div className="floating-scroll">
        <dl>
          {shortcutActions
            .filter((action) => action !== 'scroll-device-up' && action !== 'scroll-device-down')
            .map(row)}
        </dl>
        <div
          className="floating-shortcut-remote"
          data-connected={deviceConnected}
          aria-hidden={!deviceConnected}
        >
          <div>
            <dl>
              {row('scroll-device-up')}
              {row('scroll-device-down')}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
