import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { openChatLink } from '../services/chat';
import './googleSearchSuggestions.css';

export function GoogleSearchSuggestions({ html }: { html: string }) {
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const [error, setError] = useState(false);
  useEffect(() => () => cleanup.current?.(), []);
  const document = '<!doctype html><html><head>' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data: https://www.gstatic.com; base-uri \'none\'; form-action \'none\'">' +
    '<meta name="referrer" content="no-referrer">' +
    '<style>html{color-scheme:light dark}html,body{margin:0;background:transparent}body{display:flow-root}' +
    'body>.container{padding:0 12px 0 0!important;background:transparent!important;box-shadow:none!important}' +
    'body>.container .headline{flex:0 0 28px;width:28px;height:28px;align-self:flex-start;margin-top:2px;justify-content:center;align-items:center}' +
    'body>.container .logo-dark{width:28px;height:28px;transform:translateY(.64px)}' +
    'body>.container .gradient{background:none!important;display:none}</style>' +
    '</head><body>' + html + '</body></html>';
  return (
    <div className="google-search-suggestions">
      <iframe
        title={t('Google 搜索建议')}
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        srcDoc={document}
        onLoad={(event) => {
          cleanup.current?.();
          const frame = event.currentTarget;
          const content = frame.contentDocument;
          if (!content?.body) return;
          const resize = () => {
            frame.style.height = `${Math.max(1, Math.ceil(content.body.getBoundingClientRect().height), content.body.scrollHeight)}px`;
          };
          const open = (click: Event) => {
            const link = (click.target as Element | null)?.closest?.('a[href]');
            if (!link) return;
            click.preventDefault();
            if (click.type === 'auxclick' && (click as MouseEvent).button !== 1) return;
            setError(false);
            void openChatLink(link.getAttribute('href') ?? '').catch(() => setError(true));
          };
          content.addEventListener('click', open, true);
          content.addEventListener('auxclick', open, true);
          const observer = new ResizeObserver(resize);
          observer.observe(content.body);
          resize();
          cleanup.current = () => {
            observer.disconnect();
            content.removeEventListener('click', open, true);
            content.removeEventListener('auxclick', open, true);
          };
        }}
      />
      {error && <small className="inline-error" role="alert">{t('无法打开来源链接。')}</small>}
    </div>
  );
}
