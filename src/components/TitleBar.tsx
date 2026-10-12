import { Minus, Square, X } from './icons';
import { AppLogo } from './AppLogo';
export function TitleBar() {
  return (
    <header className="titlebar">
      <div className="title-brand">
        <AppLogo size={16} />
        <span>VoxCue</span>
        <span className="title-version">PREVIEW</span>
      </div>
      <div className="window-controls">
        {(
          [
            { action: 'minimize', label: '最小化', Icon: Minus },
            { action: 'maximize', label: '最大化或还原', Icon: Square },
            { action: 'close', label: '关闭窗口', Icon: X },
          ] as const
        ).map(({ action, label, Icon }) => (
          <button
            key={action}
            aria-label={label}
            onClick={() => window.desktop?.windowAction(action)}
          >
            <Icon size={14} />
          </button>
        ))}
      </div>
    </header>
  );
}
