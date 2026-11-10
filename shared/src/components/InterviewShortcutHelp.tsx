import { t } from '../i18n';
import { X } from './icons';
import { Button } from './ui/button';
import {
  defaultShortcuts,
  displayShortcut,
  shortcutActions,
  shortcutLabels,
  type ShortcutBindings,
  type ShortcutConflict,
} from '../../electron/contracts/shortcuts';

export function InterviewShortcutHelp({
  onClose,
  bindings = defaultShortcuts(),
  conflicts = [],
  deviceConnected = false,
}: {
  onClose(): void;
  bindings?: ShortcutBindings;
  conflicts?: ShortcutConflict[];
  deviceConnected?: boolean;
}) {
  return (
    <section
      id="interview-shortcut-help"
      aria-labelledby="interview-shortcut-heading"
      className="floating-panel floating-shortcut-help"
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
            .filter(
              (action) =>
                deviceConnected ||
                (action !== 'scroll-device-up' && action !== 'scroll-device-down'),
            )
            .map((action) => (
              <div key={action}>
                <dt>{t(shortcutLabels[action])}</dt>
                <dd>
                  {conflicts.some((item) => item.action === action) ? (
                    <span className="danger-text">{t('不可用')}</span>
                  ) : (
                    <kbd>{t(displayShortcut(bindings[action]))}</kbd>
                  )}
                </dd>
              </div>
            ))}
        </dl>
      </div>
    </section>
  );
}
