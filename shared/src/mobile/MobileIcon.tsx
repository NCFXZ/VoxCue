export type MobileIconName = 'more' | 'close' | 'microphone' | 'muted' | 'send' | 'stop' | 'loading' | 'down' | 'radio' | 'radio-on';

export function MobileIcon({ name }: { name: MobileIconName }) {
  if (name === 'loading') return <span className="mobile-spinner" aria-hidden="true" />;
  if (name === 'down') return <span aria-hidden="true"> ↓</span>;
  if (name === 'radio' || name === 'radio-on') return <span className="mobile-toggle-dot" aria-hidden="true" />;
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {name === 'more' ? <><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></> :
        name === 'close' ? <path d="m6 6 12 12M18 6 6 18" /> :
          name === 'send' ? <path d="M12 19V5m-6 6 6-6 6 6" /> :
            name === 'stop' ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" /> :
              <><path d="M8.5 10.5V6a3.5 3.5 0 0 1 7 0v4.5a3.5 3.5 0 0 1-7 0ZM5 10.5a7 7 0 0 0 14 0M12 17.5V21M8.5 21h7" />{name === 'muted' && <path d="m3 3 18 18" />}</>}
    </svg>
  );
}
