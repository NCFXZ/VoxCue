import { translateUI, type UILanguage } from '../../contracts/uiLanguage';
import { createHash } from 'node:crypto';

type CallbackPageState = 'received' | 'invalid' | 'used' | 'not-found';
const messages = {
  received: {
    title: '授权已收到',
    description: '离完成登录只差一步。请返回 VoxCue，应用将继续验证你的授权。',
    next: '返回 VoxCue 查看登录结果',
    detail: '此页面无需继续操作。',
  },
  invalid: {
    title: '未能确认授权',
    description: '这次授权链接无效或已过期，请返回 VoxCue 重新发起登录。',
    next: '返回 VoxCue 重新登录',
    detail: '在应用中再次选择“使用 ChatGPT 继续”。',
  },
  used: {
    title: '授权链接已使用',
    description: '这次授权已交给 VoxCue 处理，请返回应用查看登录结果。',
    next: '返回 VoxCue 查看登录结果',
    detail: '如果仍未登录，请在应用中重新发起授权。',
  },
  'not-found': {
    title: '页面不存在',
    description: '请从 VoxCue 发起 ChatGPT 登录，并使用浏览器自动打开的授权页面。',
    next: '返回 VoxCue 继续',
    detail: '此页面无需继续操作。',
  },
} satisfies Record<
  CallbackPageState,
  { title: string; description: string; next: string; detail: string }
>;

const styles = `
:root {
  color-scheme: light dark;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #20252c;
  background: #f5f7fa;
  font-synthesis: none;
  -webkit-font-smoothing: antialiased;
  --card: rgba(255, 255, 255, .94);
  --border: rgba(34, 47, 66, .09);
  --muted: #697482;
  --subtle: #8a939e;
  --inset: #f6f8fb;
  --success: #16805b;
  --success-bg: #eaf8f1;
  --warning: #a57220;
  --warning-bg: #fcf3e3;
}
* { box-sizing: border-box; }
/* Match desktop surfaces; unsupported external browsers retain their radius. */
*, *::before, *::after { corner-shape: superellipse(2); cursor: default !important; }
body {
  min-width: 280px;
  min-height: 100vh;
  min-height: 100svh;
  margin: 0;
  display: grid;
  place-items: center;
  padding: 48px 20px;
  background: radial-gradient(ellipse at 50% 0%, rgba(192, 214, 244, .34), transparent 65%);
}
.page { width: min(100%, 520px); }
.card {
  padding: 38px 40px 30px;
  border: 1px solid var(--border);
  border-radius: 40px;
  background: var(--card);
  box-shadow: 0 24px 80px -32px rgba(38, 56, 86, .19), 0 2px 8px rgba(38, 56, 86, .025);
  text-align: center;
}
.brand { display: flex; align-items: center; justify-content: center; gap: 11px; }
.brand img { display: block; width: 40px; height: 40px; }
.brand-name { font-size: 23px; font-weight: 650; letter-spacing: -.7px; }
.connection { margin: 9px 0 0; color: var(--muted); font-size: 13px; line-height: 1.6; }
.status-mark {
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  margin: 36px auto 23px;
  border-radius: 50%;
  corner-shape: round;
  background: var(--success-bg);
  color: var(--success);
  box-shadow: 0 0 0 8px color-mix(in srgb, var(--success-bg) 36%, transparent);
}
.status-mark svg { width: 34px; height: 34px; }
.notice .status-mark { color: var(--warning); background: var(--warning-bg); box-shadow: none; }
h1 { margin: 0; font-size: 30px; font-weight: 650; line-height: 1.4; letter-spacing: -.6px; }
.description { max-width: 340px; margin: 13px auto 28px; color: var(--muted); font-size: 15px; line-height: 1.85; }
.next-step { display: flex; align-items: center; gap: 13px; padding: 18px; border-radius: 28px; background: var(--inset); text-align: left; }
.next-step svg { flex: 0 0 auto; width: 23px; height: 23px; color: var(--muted); }
.next-step strong { display: block; font-size: 14px; font-weight: 600; line-height: 1.65; }
.next-step p { margin: 3px 0 0; color: var(--muted); font-size: 12px; line-height: 1.7; }
.close-hint { margin: 25px 0 0; color: var(--subtle); font-size: 12px; line-height: 1.7; }
.page-footer { margin: 23px 0 0; color: var(--subtle); text-align: center; font-size: 12px; line-height: 1.8; }
@media (prefers-color-scheme: dark) {
  :root {
    color: #eef1f6;
    background: #101319;
    --card: rgba(25, 30, 39, .96);
    --border: rgba(213, 225, 245, .09);
    --muted: #a3adbc;
    --subtle: #8a96a8;
    --inset: #222936;
    --success: #70d6ac;
    --success-bg: #203d34;
    --warning: #e8bf76;
    --warning-bg: #403622;
  }
  body { background: radial-gradient(ellipse at 50% 0%, rgba(48, 73, 110, .25), transparent 65%); }
  .card { box-shadow: 0 24px 80px -32px rgba(0, 0, 0, .55); }
}
@media (max-width: 420px) {
  body { padding: 24px 16px; }
  .card { padding: 30px 22px 25px; border-radius: 36px; }
  h1 { font-size: 27px; }
  .next-step { padding: 15px; }
}
`;

const svg = (content: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;

// These pages contain only fixed copy and a local PNG. OAuth codes, state,
// account details and error messages are never interpolated into the document.
export function createAuthCallbackPage(logo?: Buffer, language: UILanguage = 'zh-CN') {
  const image = logo ? `data:image/png;base64,${logo.toString('base64')}` : undefined;
  return {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': `default-src 'none'; style-src 'sha256-${createHash('sha256').update(styles).digest('base64')}'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
    render(state: CallbackPageState) {
      const t = (source: string) => translateUI(source, language);
      const message = messages[state];
      const received = state === 'received';
      return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${t(message.title)} · VoxCue</title>
  <link rel="icon" href="${image ?? 'data:,'}">
  <style>${styles}</style>
</head>
<body>
  <main class="page">
    <article class="card${received ? '' : ' notice'}" aria-labelledby="page-title">
      <header>
        <div class="brand">${image ? `<img src="${image}" width="40" height="40" alt="" aria-hidden="true">` : ''}<span class="brand-name">VoxCue</span></div>
        <p class="connection">${t('ChatGPT 账户授权')}</p>
      </header>
      <div class="status-mark">${svg(received ? '<path d="m6.5 12 3.5 3.5 7.5-7.5"/>' : '<path d="M12 7v6m0 4h.01"/>')}</div>
      <h1 id="page-title">${t(message.title)}</h1>
      <p class="description">${t(message.description)}</p>
      <div class="next-step">
        ${svg('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>')}
        <div><strong>${t(message.next)}</strong><p>${t(message.detail)}</p></div>
      </div>
      <p class="close-hint">${t('你现在可以关闭此页面')}</p>
    </article>
    <p class="page-footer">${t('从准备到表达，保持从容。')}</p>
  </main>
</body>
</html>`;
    },
  };
}
