import { ContentReveal as InterviewReveal } from '../components/ui/content-reveal';
import {
  memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type ChangeEvent, type ComponentProps,
} from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeMath, mathPresentation } from '../services/math';
import type { MobileConnection } from './connection';
import { useFollowScroll } from '../components/useFollowScroll';
import { useStreamingMarkdown } from '../lib/useStreamingMarkdown';
import { playSentMessageEnter } from '../lib/messageMotion';
import { mobileError, mobileText, readMobilePreferences, saveMobilePreferences, type MobilePreferences } from './copy';

const statusLabels = {
  idle: '未连接', pairing: '连接中…', approval: '等待电脑允许', connecting: '连接中…',
  reconnecting: '重连中…', syncing: '同步中…', ready: '已连接', waiting: '等待面试',
  disconnected: '已断开', error: '连接失败',
} as const;

export function scrollMobileReading(
  direction: 'up' | 'down',
  answer: { node: HTMLElement | null; pause(): void },
  transcript: { node: HTMLElement | null; pause(): void },
) {
  const target = answer.node?.clientHeight ? answer : transcript;
  if (!target.node?.clientHeight) return;
  target.pause();
  target.node.scrollBy({
    top: (direction === 'up' ? -1 : 1) * Math.max(120, target.node.clientHeight * 0.7),
    behavior: 'auto',
  });
}

export function useMobileViewport() {
  useEffect(() => {
    let frame = 0;
    let rule: CSSStyleRule | undefined;
    for (const sheet of document.styleSheets) {
      try {
        rule = [...sheet.cssRules].find(
          (entry): entry is CSSStyleRule => entry instanceof CSSStyleRule && entry.selectorText === ':root',
        );
      } catch { /* A browser extension may expose an inaccessible stylesheet. */ }
      if (rule) break;
    }
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const viewport = window.visualViewport;
        const height = viewport?.height ?? window.innerHeight;
        if (height <= 0) return;
        rule?.style.setProperty('--mobile-viewport', `${Math.round(height)}px`);
        rule?.style.setProperty('--mobile-viewport-top', `${Math.max(0, viewport?.offsetTop ?? 0)}px`);
      });
    };
    update();
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      rule?.style.removeProperty('--mobile-viewport');
      rule?.style.removeProperty('--mobile-viewport-top');
      cancelAnimationFrame(frame);
    };
  }, []);
}

function MobileIcon({ name }: { name: 'more' | 'close' | 'microphone' | 'muted' | 'send' | 'stop' }) {
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

const markdownPlugins = [remarkGfm, remarkMath];
function removeMathInlineStyles() {
  type Node = { properties?: Record<string, unknown>; children?: Node[] };
  return function visit(node: Node) {
    if (node.properties) delete node.properties.style;
    node.children?.forEach(visit);
  };
}
const mathPlugins: ComponentProps<typeof Markdown>['rehypePlugins'] = [
  [rehypeKatex, { output: 'mathml', trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 }],
  mathPresentation,
  removeMathInlineStyles,
];
const markdownComponents: Components = {
  a: ({ href, children }) => href && /^https?:\/\//i.test(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    : <span>{children}</span>,
  img: ({ alt }) => <span>{alt || ''}</span>,
  table: ({ children }) => <div className="mobile-table"><table>{children}</table></div>,
  th: ({ children }) => <th>{children}</th>,
  td: ({ children }) => <td>{children}</td>,
};
const AnswerContent = memo(function AnswerContent({ content, streaming }: { content: string; streaming: boolean }) {
  const visible = useStreamingMarkdown(content, streaming);
  return <MobileMarkdown content={visible} />;
});
const MobileMarkdown = memo(function MobileMarkdown({ content }: { content: string }) {
  return (
    <div className="mobile-markdown">
      <Markdown
        remarkPlugins={markdownPlugins}
        rehypePlugins={mathPlugins}
        skipHtml
        components={markdownComponents}
      >
        {normalizeMath(content)}
      </Markdown>
    </div>
  );
});

function Settings({
  preferences, update, onClose, disconnect, connected,
}: {
  preferences: MobilePreferences;
  update(patch: Partial<MobilePreferences>): void;
  onClose(): void;
  disconnect(): void;
  connected: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [armed, setArmed] = useState(false);
  const text = (source: string) => mobileText(source, preferences.language);
  useEffect(() => {
    const element = dialog.current!;
    const focus = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      element.close();
      if (focus?.isConnected) focus.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [armed]);
  const row = (label: string, value: string, options: [string, string][], change: (value: string) => void) => (
    <label className="mobile-setting-row">
      <span>{text(label)}</span>
      <select value={value} onChange={(event) => change(event.target.value)}>
        {options.map(([id, optionLabel]) => <option key={id} value={id}>{text(optionLabel)}</option>)}
      </select>
    </label>
  );
  return (
    <dialog ref={dialog} className="mobile-settings" aria-label={text('设置')} onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header><h2>{text('设置')}</h2><button className="mobile-icon-button" aria-label={text('关闭')} onClick={onClose}><MobileIcon name="close" /></button></header>
      {row('语言', preferences.language, [['zh', '简体中文'], ['en', 'English']], (value) => update({ language: value as MobilePreferences['language'] }))}
      {row('主题', preferences.theme, [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']], (value) => update({ theme: value as MobilePreferences['theme'] }))}
      {row('字号', preferences.font, [['normal', '标准'], ['large', '大'], ['larger', '更大']], (value) => update({ font: value as MobilePreferences['font'] }))}
      {row('转录', preferences.transcript, [['preview', '预览'], ['expanded', '展开'], ['hidden', '隐藏']], (value) => update({ transcript: value as MobilePreferences['transcript'] }))}
      {connected && (
        <div className="mobile-disconnect">
          <p>{text('断开后，电脑继续转录和回答。')}</p>
          <button className="mobile-danger" onClick={() => {
            if (!armed) setArmed(true);
            else { disconnect(); onClose(); }
          }}>{text(armed ? '确认断开连接' : '断开连接')}</button>
        </div>
      )}
    </dialog>
  );
}

export function MobileApp({ connection }: { connection: MobileConnection }) {
  const state = useSyncExternalStore(connection.subscribe, connection.getState, connection.getState);
  const [preferences, setPreferences] = useState(readMobilePreferences);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const text = (source: string) => mobileText(source, preferences.language);
  const snapshot = state.snapshot;
  const identity = `${snapshot?.sessionId ?? 'waiting'}:${snapshot?.sessionEpoch ?? 0}`;
  const answers = useFollowScroll(snapshot?.answers, identity);
  const previousQuestions = useRef(snapshot);
  useLayoutEffect(() => {
    const before = previousQuestions.current;
    previousQuestions.current = snapshot;
    if (before === snapshot || !state.connected || document.hidden || !snapshot?.sessionId ||
        state.restoredAnswerCount === undefined) return;
    const previousCount = before && snapshot.sessionId === before.sessionId && snapshot.sessionEpoch === before.sessionEpoch
      ? before.omitted.answers + before.answers.length : 0;
    // Reappearing rows from a resized, bounded history have the same absolute index.
    const first = Math.max(0, Math.max(previousCount, state.restoredAnswerCount) - snapshot.omitted.answers);
    for (let i = first; i < snapshot.answers.length; i++) {
      const id = snapshot.answers[i].id;
      playSentMessageEnter(answers.scrollProps.ref.current?.querySelector<HTMLElement>(`[data-question-id="${CSS.escape(id)}"]`));
    }
  }, [snapshot, state.connected, state.restoredAnswerCount, answers.scrollProps.ref]);
  const transcripts = useFollowScroll(snapshot?.transcripts, identity);
  const ready = state.connected && state.status === 'ready';
  const canConnect = state.hasPairingLink || state.canResume;
  const showConnectPrompt = ['idle', 'disconnected', 'error'].includes(state.status);
  const workspace = !!(state.connected || snapshot || state.draft);
  const pending = state.pending || !!state.pendingAction;
  const fromTranscript = !state.draft.trim() && !state.draftDirty && !snapshot?.inputDraft.manual && !!snapshot?.pendingQuestion.trim();
  const draftTruncated = !!snapshot?.inputDraft.truncated && !state.draftDirty && !state.draftSyncing;
  const error = state.error || state.errorCode
    ? mobileError(state.errorCode, state.error, preferences.language)
    : null;
  useMobileViewport();
  useEffect(() => () => connection.dispose(), [connection]);
  useEffect(() => {
    document.documentElement.lang = preferences.language === 'zh' ? 'zh-CN' : 'en';
    saveMobilePreferences(preferences);
  }, [preferences]);
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    const fit = () => {
      node.rows = 1;
      while (node.rows < 4 && node.scrollHeight > node.clientHeight + 1) node.rows++;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [state.draft, workspace]);
  useLayoutEffect(() => {
    answers.syncLayout();
    transcripts.syncLayout();
  }, [preferences.transcript, preferences.font]);
  useEffect(() => {
    if (!workspace || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { answers.syncLayout(); transcripts.syncLayout(); });
    for (const node of [answers.scrollProps.ref.current, transcripts.scrollProps.ref.current])
      if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [workspace, preferences.transcript]);
  useEffect(() => connection.subscribeScroll((direction) => {
    scrollMobileReading(direction,
      { node: answers.scrollProps.ref.current, pause: answers.pauseFollowing },
      { node: transcripts.scrollProps.ref.current, pause: transcripts.pauseFollowing },
    );
  }), [connection]);
  const updatePreferences = (patch: Partial<MobilePreferences>) => setPreferences((previous) => ({ ...previous, ...patch }));
  const shellClass = `mobile-app theme-${preferences.theme} font-${preferences.font}`;
  const followButton = (scroll: typeof answers) => !scroll.following && (
    <button className="mobile-follow" onClick={scroll.scrollToLatest}>
      {text(scroll.hasNew ? '有新内容' : '回到最新')}<span aria-hidden="true"> ↓</span>
    </button>
  );
  let sessionNotice: string | null = null;
  if (snapshot?.status === 'ended') sessionNotice = text('面试已结束。内容仍可阅读。');
  else if (!snapshot?.sessionId && state.connected) sessionNotice = text('等待电脑开始面试。');
  else if (!ready && state.status !== 'syncing') sessionNotice = text('离线时可阅读内容。恢复连接后，输入以电脑端为准。');
  else if (ready && snapshot?.status === 'paused') sessionNotice = text('电脑已暂停转录。');
  const canRetry = !ready && canConnect && !['connecting', 'reconnecting', 'syncing', 'approval', 'pairing'].includes(state.status);
  return (
    <div className={shellClass}>
      <header className="mobile-topbar">
        <div className="mobile-brand"><strong>VoxCue</strong><span>{state.deviceName || text('电脑端')}</span></div>
        <span className={`mobile-connection-state ${state.connected ? 'is-connected' : ''}`} role="status">
          <i aria-hidden="true" />{text(statusLabels[state.status])}
        </span>
        <button className="mobile-icon-button mobile-more" aria-label={text('更多')} aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)}><MobileIcon name="more" /></button>
      </header>
      {!workspace ? (
        <main className="mobile-welcome">
          <div className="mobile-welcome-card">
            <span className="mobile-eyebrow">VoxCue</span>
            <h1>{text(state.status === 'approval' ? '等待电脑允许' : '将设备连接到 VoxCue')}</h1>
            {state.pairingCode ? (
              <>
                <p>{text('核对电脑与设备上的配对码，然后在电脑上允许连接。')}</p>
                <strong className="mobile-pairing-code" aria-label={text('配对码')}>{state.pairingCode}</strong>
              </>
            ) : <p>{text('让设备与电脑连接同一 Wi-Fi。')}</p>}
            <InterviewReveal resizeKey={error ?? ''}>{error ? <p className="mobile-error" role="alert">{error}</p> : null}</InterviewReveal>
            {showConnectPrompt && canConnect && (
              <button className="mobile-primary mobile-connect" onClick={() => void connection.start()}>{text(state.canResume && !state.hasPairingLink ? '恢复连接' : '连接电脑')}</button>
            )}
            <InterviewReveal>{showConnectPrompt && !canConnect ? (
              <p className="mobile-hint">{text('无法连接时，请回到电脑刷新二维码并重新扫码。')}</p>
            ) : null}</InterviewReveal>
            {!showConnectPrompt && (
              <p className="mobile-waiting" role="status"><span className="mobile-spinner" aria-hidden="true" />{text(statusLabels[state.status])}</p>
            )}
            <p className="mobile-hint">{text('仅在可信的私人网络中使用。')}</p>
            <p className="mobile-hint">{text('连接网址只用于本次配对，刷新此页可能需要重新扫码。')}</p>
          </div>
        </main>
      ) : (
        <>
          <InterviewReveal className="mobile-session-reveal" resizeKey={`${sessionNotice ?? ''}:${canRetry}`}>{sessionNotice || canRetry ? (
            <div className="mobile-session-notice">
              {sessionNotice && <p role="status">{sessionNotice}</p>}
              {canRetry && <button onClick={() => void connection.retry()}>{text('重新连接')}</button>}
            </div>
          ) : null}</InterviewReveal>
          <section className={`mobile-transcripts is-${preferences.transcript}`} aria-label={text('转录')}>
            <header>
              <h2>{text('转录')}</h2>
              <div>
                {preferences.transcript !== 'hidden' && <button onClick={() => updatePreferences({ transcript: preferences.transcript === 'expanded' ? 'preview' : 'expanded' })}>{text(preferences.transcript === 'expanded' ? '收起' : '展开')}</button>}
                <button onClick={() => updatePreferences({ transcript: preferences.transcript === 'hidden' ? 'preview' : 'hidden' })}>{text(preferences.transcript === 'hidden' ? '显示转录' : '隐藏')}</button>
              </div>
            </header>
            {preferences.transcript !== 'hidden' && (
              <>
                <div className="mobile-transcript-scroll" {...transcripts.scrollProps} tabIndex={0}>
                  <InterviewReveal>{snapshot?.omitted.transcripts && preferences.transcript === 'expanded'
                    ? <p className="mobile-hint mobile-omitted-transcripts">{text('较早的内容请在电脑端查看。')}</p> : null}</InterviewReveal>
                  {!snapshot?.transcripts.length && <p className="mobile-hint">{text('等待语音输入…')}</p>}
                  {(preferences.transcript === 'preview' ? snapshot?.transcripts.slice(-3) : snapshot?.transcripts)?.map((row) => (
                    <article className={`mobile-transcript-row${row.source === 'microphone' ? ' is-me' : ''}`} key={row.id}>
                      <div className="mobile-transcript-meta"><strong>{text(row.source === 'microphone' ? snapshot?.inputMode === 'transcription' ? '麦克风' : '我' : '对方')}</strong>
                        {preferences.transcript === 'expanded' && <time>{row.time}</time>}</div>
                      <p>{row.text}{!row.final && <span className="mobile-interim" aria-label={text('正在转录…')}>…</span>}</p>
                      <InterviewReveal>{row.textTruncated && preferences.transcript === 'expanded'
                        ? <small className="mobile-truncated-transcript">{text('本段内容已截短，完整内容请在电脑端查看。')}</small> : null}</InterviewReveal>
                    </article>
                  ))}
                </div>
                {preferences.transcript === 'expanded' && followButton(transcripts)}
              </>
            )}
          </section>
          <section className="mobile-answers" aria-label={text('问题与回答')}>
            <div className="mobile-answer-scroll" {...answers.scrollProps} tabIndex={0}>
              <InterviewReveal>{snapshot?.omitted.answers ? <p className="mobile-hint">{text('较早的内容请在电脑端查看。')}</p> : null}</InterviewReveal>
              {!snapshot?.answers.length && (
                <div className="mobile-empty"><h2>{text('尚无问题与回答。')}</h2><p>{text('转录会显示在上方，也可以输入问题。')}</p></div>
              )}
              {snapshot?.answers.map((answer) => (
                <article className="mobile-answer-turn" key={`${identity}:${answer.id}`}>
                  <div className="mobile-question-bubble" data-question-id={answer.id}><h2>{answer.question}</h2></div>
                  <div className="mobile-answer-bubble"><AnswerContent content={answer.content} streaming={answer.status === 'streaming'} />
                  <InterviewReveal>{answer.contentTruncated ? <p className="mobile-hint">{text('本段内容已截短，完整内容请在电脑端查看。')}</p> : null}</InterviewReveal>
                  {answer.status === 'streaming' && <p className="mobile-answer-status" role="status">{text('正在生成…')}</p>}
                  {answer.status === 'stopped' && <p className="mobile-answer-status">{text('已停止')}</p>}
                  <InterviewReveal resizeKey={`${preferences.language}:${answer.error ?? ''}`}>{answer.status === 'failed' ? <p className="mobile-error" role="alert">{text('回答失败')}{answer.error ? ` · ${mobileError(null, answer.error, preferences.language)}` : ''}</p> : null}</InterviewReveal>
                  </div>
                </article>
              ))}
            </div>
            {followButton(answers)}
          </section>
          <footer className="mobile-composer">
            <InterviewReveal resizeKey={error ?? ''}>{error ? <p className="mobile-error" role="alert">{error}</p> : null}</InterviewReveal>
            <InterviewReveal>{draftTruncated ? <p className="mobile-error" role="alert">{text('电脑输入超过 6000 字符，请编辑后再发送。')}</p> : null}</InterviewReveal>
            {fromTranscript && snapshot && <p className="mobile-pending-question"><span>{text('最新待提问转录')}</span>{snapshot.pendingQuestion}</p>}
            <form onSubmit={(event) => { event.preventDefault(); if (ready && !pending && !state.draftSyncing && !draftTruncated && snapshot?.status === 'running' && snapshot.capabilities.sendQuestion) void connection.sendQuestion(fromTranscript); }}>
              <textarea
                ref={input} rows={1} value={state.draft} maxLength={6000} disabled={!ready}
                aria-label={text('输入问题…')} placeholder={text('输入问题…')}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { if (ready) connection.setDraft(event.target.value); }}
                onCompositionStart={() => connection.setComposing(true)}
                onCompositionEnd={(event) => {
                  if (ready) connection.setDraft(event.currentTarget.value);
                  connection.setComposing(false);
                }}
                onBlur={(event) => {
                  if (ready) connection.setDraft(event.currentTarget.value);
                  connection.setComposing(false);
                }}
              />
              <div className="mobile-composer-toolbar">
                <button type="button" className="mobile-auto-answer" role="switch" aria-checked={!!snapshot?.autoAnswer} aria-busy={state.pendingAction === 'autoAnswer'} disabled={!ready || pending || !snapshot?.capabilities.setAutoAnswer} onClick={() => void connection.setAutoAnswer(!snapshot!.autoAnswer)}>
                  <span className="mobile-toggle-dot" aria-hidden="true" />{text('自动回答')}<span>{text(state.pendingAction === 'autoAnswer' ? '确认中…' : snapshot?.autoAnswer ? '开' : '关')}</span>
                </button>
                <div className="mobile-composer-actions">
                  <button type="button" className="mobile-icon-button mobile-microphone" aria-label={text(snapshot?.microphoneMuted ? '打开麦克风' : '关闭麦克风')} role="switch" aria-checked={!!snapshot && !snapshot.microphoneMuted} aria-busy={state.pendingAction === 'microphone'} disabled={!ready || pending || !snapshot?.capabilities.setMicrophone} onClick={() => void connection.setMicrophoneMuted(!snapshot!.microphoneMuted)}>
                    {state.pendingAction === 'microphone' ? <span className="mobile-spinner" aria-hidden="true" /> : <MobileIcon name={snapshot?.microphoneMuted ? 'muted' : 'microphone'} />}
                  </button>
                  {snapshot?.generating ? (
                    <button type="button" className="mobile-icon-button mobile-primary" aria-label={text(state.pendingAction === 'stopAnswer' ? '停止中…' : '停止生成')} aria-busy={state.pendingAction === 'stopAnswer'} disabled={!ready || pending || !snapshot.capabilities.stopAnswer} onClick={() => void connection.stopAnswer()}>{state.pendingAction === 'stopAnswer' ? <span className="mobile-spinner" aria-hidden="true" /> : <MobileIcon name="stop" />}</button>
                  ) : (
                    <button type="submit" className="mobile-icon-button mobile-primary" aria-label={text(state.pendingAction === 'sendQuestion' ? '发送中…' : fromTranscript ? '发送最新转录' : '发送')} aria-busy={state.pendingAction === 'sendQuestion'} disabled={!ready || pending || state.draftSyncing || draftTruncated || snapshot?.status !== 'running' || !snapshot.capabilities.sendQuestion || (!state.draft.trim() && !fromTranscript)}>{state.pendingAction === 'sendQuestion' ? <span className="mobile-spinner" aria-hidden="true" /> : <MobileIcon name="send" />}</button>
                  )}
                </div>
              </div>
            </form>
          </footer>
        </>
      )}
      {settingsOpen && <Settings preferences={preferences} update={updatePreferences} onClose={() => setSettingsOpen(false)} connected={state.connected || state.canResume} disconnect={() => void connection.disconnect()} />}
    </div>
  );
}
