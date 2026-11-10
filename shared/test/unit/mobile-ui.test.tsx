import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MobileApp, scrollMobileReading } from '../../src/mobile/App';
import { mobileError, readMobilePreferences, saveMobilePreferences } from '../../src/mobile/copy';
import type { MobileConnection, MobileConnectionState } from '../../src/mobile/connection';
import type { RemoteInterviewSnapshot } from '../../electron/contracts/remoteConnection';

const snapshot = (patch: Partial<RemoteInterviewSnapshot> = {}): RemoteInterviewSnapshot => ({
  sessionId: 'synthetic-session', sessionEpoch: 1, revision: 1, status: 'running', inputMode: 'remote',
  transcripts: [{ id: 't1', text: 'Synthetic transcript', time: '12:00', final: true, source: 'system' }],
  answers: [{ id: 'a1', question: 'Synthetic question', content: 'Synthetic answer', status: 'completed' }],
  pendingQuestion: '', pendingQuestionRevision: 1, omitted: { transcripts: 0, answers: 0 },
  inputDraft: { text: '', revision: 1, manual: false },
  generating: false, aiEnabled: true, microphoneMuted: false, microphoneToggling: false,
  micRevision: 1, autoAnswer: false, autoAnswerRevision: 1,
  capabilities: { sendQuestion: true, setMicrophone: true, setAutoAnswer: true, stopAnswer: false },
  ...patch,
});
const setup = (patch: Partial<MobileConnectionState> = {}) => {
  const state: MobileConnectionState = {
    status: 'idle', snapshot: null, pairingCode: null, deviceName: null,
    draft: '', error: null, errorCode: null, draftSyncing: false, draftDirty: false,
    pending: false, pendingAction: null, connected: false, hasPairingLink: true, canResume: false,
    ...patch,
  };
  const connection = {
    getState: () => state, subscribe: vi.fn(() => () => {}), start: vi.fn(), dispose: vi.fn(),
    retry: vi.fn(), disconnect: vi.fn(), setDraft: vi.fn(), sendQuestion: vi.fn(),
    setMicrophoneMuted: vi.fn(), setAutoAnswer: vi.fn(), stopAnswer: vi.fn(),
    subscribeScroll: vi.fn(() => () => {}),
    setComposing: vi.fn(),
  } as unknown as MobileConnection;
  return { connection, html: () => renderToStaticMarkup(<MobileApp connection={connection} />) };
};
beforeEach(() => {
  vi.stubGlobal('navigator', { language: 'zh-CN' });
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

it('requires an explicit connection action and displays the desktop approval code', () => {
  const { connection, html } = setup();
  expect(html()).toContain('连接电脑');
  expect(connection.start).not.toHaveBeenCalled();
  const approval = setup({ status: 'approval', pairingCode: '123456' }).html();
  expect(approval).toContain('123456');
  expect(approval).toContain('等待电脑允许');
  expect(approval).not.toContain('<textarea');
});

it('keeps offline text and drafts readable while disabling every remote control', () => {
  const html = setup({ status: 'disconnected', snapshot: snapshot(), draft: 'Offline draft', canResume: true }).html();
  expect(html).toContain('Synthetic transcript');
  expect(html).toContain('Synthetic answer');
  expect(html).toContain('Offline draft</textarea>');
  expect(html.match(/<textarea[^>]*>/)?.[0]).toContain('disabled=""');
  expect(html).toContain('重新连接');
  const controls = [...html.matchAll(/<button[^>]*role="switch"[^>]*>/g)];
  expect(controls).toHaveLength(2);
  expect(controls.every(([button]) => button.includes('disabled=""'))).toBe(true);
  expect(html.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).toContain('disabled=""');
});

it('keeps confirmed microphone state while pending and places accessible controls below the full input', () => {
  const html = setup({ status: 'ready', connected: true, snapshot: snapshot(), pending: true, pendingAction: 'microphone', draft: 'Current draft' }).html();
  expect(html).toMatch(/role="switch" aria-checked="true" aria-busy="true" disabled=""/);
  expect(html).toContain('aria-label="关闭麦克风"');
  expect(html).toContain('mobile-spinner');
  expect(html.indexOf('</textarea>')).toBeLessThan(html.indexOf('class="mobile-composer-toolbar"'));
  expect(html).toContain('aria-label="发送"');
  expect(html.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).toContain('disabled=""');
});

it('renders safe formatted answers without active HTML, remote images, or javascript links', () => {
  const html = setup({
    status: 'ready', connected: true,
    snapshot: snapshot({ answers: [{ id: 'safe', question: '<img src=x onerror=alert(1)>', content: '**Readable**\n\n- Item\n\n| Left | Right |\n| :--- | ---: |\n| A | B |\n\n<script>alert(1)</script>\n\n![tracking](https://third-party.invalid/image.png)\n\n[bad](javascript:alert(1))', status: 'completed' }] }),
  }).html();
  expect(html).toContain('<strong>Readable</strong>');
  expect(html).toContain('<li>Item</li>');
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(html).not.toContain('<script');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('third-party.invalid');
  expect(html).toContain('<th>Left</th>');
  expect(html).not.toMatch(/\sstyle=/);
});

it('uses browser language, handles expired pairing clearly, and persists only display preferences', () => {
  vi.stubGlobal('navigator', { language: 'en-GB' });
  expect(setup({ status: 'error', hasPairingLink: false, errorCode: 'pairing-expired' }).html()).toContain('The QR code has expired.');
  expect(mobileError('pairing-rejected', null, 'en')).toContain('declined');
  expect(mobileError('command-failed', '麦克风状态已变化，请同步后重试。', 'en')).toContain('microphone state has changed');
  const preferences = readMobilePreferences();
  expect(preferences.language).toBe('en');
  saveMobilePreferences({ ...preferences, draft: 'secret text', transcripts: ['secret transcript'] } as typeof preferences);
  expect(localStorage.setItem).toHaveBeenCalledExactlyOnceWith('voxcue.mobile.preferences.v1', JSON.stringify(preferences));
});

it('shows paused, ended, waiting and shortened history states explicitly', () => {
  const paused = setup({ status: 'ready', connected: true, snapshot: snapshot({ status: 'paused' }) }).html();
  expect(paused).toContain('电脑已暂停转录');
  expect(paused.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).toContain('disabled=""');
  const ended = setup({ status: 'ready', connected: true, snapshot: snapshot({ status: 'ended', omitted: { transcripts: 50, answers: 10 } }) }).html();
  expect(ended).toContain('面试已结束');
  expect(ended).toContain('较早的内容请在电脑端查看');
  expect(setup({ status: 'waiting', connected: true }).html()).toContain('等待电脑开始面试');
});

it('uses the computer-controlled input without version choices or redundant sync messages', () => {
  const html = setup({
    status: 'ready', connected: true, draft: '<img src=x>Computer input',
    snapshot: snapshot({ inputDraft: { text: '<img src=x>Computer input', revision: 3, manual: true } }),
  }).html();
  expect(html).toContain('&lt;img src=x&gt;Computer input</textarea>');
  expect(html).not.toContain('使用电脑内容');
  expect(html).not.toContain('保留我的内容');
  expect(html).not.toContain('用于当前面试');
  expect(html).not.toContain('输入已同步');
  expect(html).not.toContain('<img');
  expect(html.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).not.toContain('disabled=""');
});

it('keeps the draft sync safety gate without adding repetitive status labels', () => {
  const syncing = setup({ status: 'ready', connected: true, draft: 'Syncing input', draftSyncing: true, snapshot: snapshot() }).html();
  expect(syncing).not.toContain('正在同步输入…');
  expect(syncing.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).toContain('disabled=""');
  expect([...syncing.matchAll(/<button[^>]*role="switch"[^>]*>/g)].every(([button]) => !button.includes('disabled=""'))).toBe(true);
  const dirty = setup({ status: 'ready', connected: true, draft: 'Pending edits', draftDirty: true, snapshot: snapshot() }).html();
  expect(dirty).not.toContain('输入待同步');
  expect(dirty.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).not.toContain('disabled=""');
  vi.stubGlobal('navigator', { language: 'en-GB' });
  expect(setup({ status: 'ready', connected: true, snapshot: snapshot() }).html()).not.toContain('Input synced');
});

it('renders inline and block LaTeX through shared normalization as CSP-safe MathML', () => {
  const content = [
    'Inline $x^2$ and \\(\\frac{a}{b}\\).',
    '\\[\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\\]',
    '$$\n\\frac{1}{\\sqrt{x}}\n$$',
    '$\\frac{$',
    '$\\href{javascript:alert(1)}{x}$',
  ].join('\n\n');
  const html = setup({ status: 'ready', connected: true, snapshot: snapshot({ answers: [{ id: 'math', question: 'Math', content, status: 'streaming' }] }) }).html();
  expect(html).toContain('<math');
  expect(html).toContain('<mfrac>');
  expect(html).toContain('<msup>');
  expect(html).toContain('<mtable');
  expect(html).toContain('katex-error');
  expect(html).not.toMatch(/\sstyle=/);
  expect(html).not.toContain('title=');
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('katex-html');
  expect(setup({ status: 'ready', connected: true, snapshot: snapshot({ answers: [{ id: 'partial', question: 'Math', content: '$$\n\\frac{', status: 'streaming' }] }) }).html()).not.toContain('title=');
});

it('keeps an explicitly cleared manual input empty instead of sending an older transcript', () => {
  const html = setup({ status: 'ready', connected: true, snapshot: snapshot({ inputDraft: { text: '', revision: 2, manual: true }, pendingQuestion: 'Old transcript question' }) }).html();
  expect(html).not.toContain('aria-label="发送最新转录"');
  expect(html.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).toContain('disabled=""');
});

it('renders question and microphone transcript bubbles on their own side', () => {
  const html = setup({ status: 'ready', connected: true, snapshot: snapshot({ transcripts: [
    { id: 'system', source: 'system', text: 'Other person', time: '', final: true },
    { id: 'mic', source: 'microphone', text: 'My words', time: '', final: true },
  ] }) }).html();
  expect(html).toContain('class="mobile-question-bubble"');
  expect(html).toContain('class="mobile-answer-bubble"');
  expect(html).toMatch(/class="mobile-transcript-row is-me"[^>]*>[\s\S]*?My words/);
});

it('scrolls the actual answer pane after pausing following and falls back to a visible transcript pane', () => {
  const answer = { node: { clientHeight: 300, scrollBy: vi.fn() } as unknown as HTMLElement, pause: vi.fn() };
  const transcript = { node: { clientHeight: 200, scrollBy: vi.fn() } as unknown as HTMLElement, pause: vi.fn() };
  scrollMobileReading('up', answer, transcript);
  expect(answer.pause).toHaveBeenCalledOnce();
  expect(answer.node.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: -210, behavior: 'auto' });
  expect(transcript.node.scrollBy).not.toHaveBeenCalled();
  scrollMobileReading('down', { ...answer, node: null }, transcript);
  expect(transcript.pause).toHaveBeenCalledOnce();
  expect(transcript.node.scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 140, behavior: 'auto' });
});

it('requires explicit editing before sending a shortened computer draft', () => {
  const inputDraft = { text: 'x'.repeat(6000), revision: 3, manual: false, truncated: true as const };
  const untouched = setup({ status: 'ready', connected: true, draft: inputDraft.text, snapshot: snapshot({ inputDraft }) }).html();
  expect(untouched).toContain('电脑输入超过 6000 字符，请编辑后再发送。');
  expect(untouched.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).toContain('disabled=""');
  const edited = setup({ status: 'ready', connected: true, draft: 'Edited question', draftDirty: true, snapshot: snapshot({ inputDraft }) }).html();
  expect(edited).not.toContain('电脑输入超过 6000 字符，请编辑后再发送。');
  expect(edited.match(/<button[^>]*type="submit"[^>]*>/)?.[0]).not.toContain('disabled=""');
});
