import { t } from '../i18n';
import { Minus, Square, X } from './icons';
export function TitleBar() {
  if (window.desktop?.platform === 'macos') return null;
  return (
    <header className="titlebar">
      <div className="window-controls">
        {(
          [
            { action: 'minimize', label: t('最小化'), Icon: Minus },
            { action: 'maximize', label: t('最大化或还原'), Icon: Square },
            { action: 'close', label: t('关闭窗口'), Icon: X },
          ] as const
        ).map(({ action, label, Icon }) => (
          <button
            key={action}
            aria-label={t(label)}
            onClick={() => window.desktop?.windowAction(action)}
          >
            <Icon size={14} />
          </button>
        ))}
      </div>
    </header>
  );
}
