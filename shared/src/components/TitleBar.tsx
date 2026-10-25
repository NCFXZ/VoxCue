import { Minus, Square, X } from './icons';
export function TitleBar() {
  if (window.desktop?.platform === 'macos') return null;
  return (
    <header className="titlebar">
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
