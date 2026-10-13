import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ChevronUp,
  ChevronDown,
  ShieldCheck,
  ShieldOff,
  Square,
  Expand,
  Shrink,
  MessageSquare,
  Volume2,
  DragGrip,
} from './icons';
import { Button } from './ui/button';
import { useInterview } from '../stores/interview';
import { useHistory } from '../stores/history';
import { AppLogo } from './AppLogo';
import { useFollowScroll } from './useFollowScroll';
import { MarkdownContent } from './MarkdownContent';
import { ChatActivity, describeActivity } from './ChatActivity';
export function FloatingInterview() {
  const state = useInterview();
  const saveError = useHistory((s) => s.error);
  const [input, setInput] = useState<string | null>(null);
  const [protectedWindow, setProtected] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const transcriptScroll = useFollowScroll(state.transcripts);
  const answerScroll = useFollowScroll(state.answers);
  const resizeReady = useRef<Promise<void>>(Promise.resolve());
  const resizeFrame = useRef(0);
  const currentInput = input ?? state.draftQuestion;
  const latestQuestion =
    state.draftQuestion ||
    [...state.transcripts]
      .reverse()
      .find((t) => t.source === 'system' || (!t.source && state.mode === 'mock'))?.text ||
    '';
  useEffect(() => {
    if (!confirmEnd || ending) return;
    const timer = setTimeout(() => setConfirmEnd(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmEnd, ending]);
  useEffect(() => () => cancelAnimationFrame(resizeFrame.current), []);
  useEffect(
    () => window.desktop?.onInterviewTitle((event) => useHistory.getState().applyTitle(event)),
    [],
  );
  useEffect(() => {
    void window.desktop
      ?.interviewState()
      .then((value) => {
        setProtected(value.protected);
        setCollapsed(value.collapsed);
        useInterview.getState().initialize(value.configuration);
      })
      .catch(() => setError('无法读取已确认的面试设置，请结束面试后重试。'));
    const media = matchMedia('(prefers-color-scheme: dark)');
    const theme = () => {
      const value = localStorage.getItem('copilot-theme');
      document.documentElement.classList.toggle(
        'dark',
        value === 'dark' || (value !== 'light' && media.matches),
      );
    };
    theme();
    media.addEventListener('change', theme);
    window.addEventListener('storage', theme);
    const archive = () => {
      const current = useInterview.getState();
      if (current.sessionId) {
        // beforeunload cannot await IPC. Save the received text synchronously;
        // explicit End still awaits the native tail flush before saving.
        if (current.mode === 'local' && current.status !== 'ended') current.archive('interrupted');
        void current.end();
      }
    };
    window.addEventListener('beforeunload', archive);
    const unsubscribeEnd = window.desktop?.onInterviewEndRequested(() => setConfirmEnd(true));
    return () => {
      media.removeEventListener('change', theme);
      window.removeEventListener('storage', theme);
      window.removeEventListener('beforeunload', archive);
      unsubscribeEnd?.();
    };
  }, []);
  async function toggleCapture() {
    setBusy(true);
    setError(null);
    try {
      setProtected(await window.desktop!.allowCapture(protectedWindow));
    } catch {
      setError('截图权限切换失败，状态未更改。');
    } finally {
      setBusy(false);
    }
  }
  const close = async () => {
    if (ending) return;
    setEnding(true);
    try {
      await state.end();
      if (!useHistory.getState().error) window.desktop?.confirmInterviewEnd();
    } finally {
      setEnding(false);
    }
  };
  const submit = () => {
    if (state.generating || (!currentInput.trim() && !latestQuestion.trim())) return;
    const text = currentInput.trim() || latestQuestion;
    setInput(null);
    if (state.mode === 'local') void state.submitTranscript(text);
    else void state.ask(text);
  };
  const resizeHandle = (edge: 'left' | 'right') => (
    <button
      type="button"
      className={`floating-resize resize-${edge}`}
      aria-label={edge === 'left' ? '拖动左下角调整尺寸' : '拖动右下角调整尺寸'}
      title="拖动调整尺寸"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        resizeReady.current = window
          .desktop!.resizeInterview({ phase: 'start', edge })
          .catch(() => setError('无法调整窗口尺寸。'));
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId) || resizeFrame.current) return;
        resizeFrame.current = requestAnimationFrame(() => {
          resizeFrame.current = 0;
          void resizeReady.current
            .then(() => window.desktop!.resizeInterview({ phase: 'move' }))
            .catch(() => setError('无法调整窗口尺寸。'));
        });
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        cancelAnimationFrame(resizeFrame.current);
        resizeFrame.current = 0;
        event.currentTarget.releasePointerCapture(event.pointerId);
        void resizeReady.current
          .then(async () => {
            await window.desktop!.resizeInterview({ phase: 'move' });
            await window.desktop!.resizeInterview({ phase: 'end' });
          })
          .catch(() => setError('无法调整窗口尺寸。'));
      }}
      onPointerCancel={() => {
        cancelAnimationFrame(resizeFrame.current);
        resizeFrame.current = 0;
        void window.desktop?.resizeInterview({ phase: 'end' });
      }}
    >
      {edge === 'left' ? <Shrink size={17} /> : <Expand size={17} />}
    </button>
  );
  return (
    <div className={`floating-shell ${collapsed ? 'is-collapsed' : ''}`}>
      <header className="floating-toolbar">
        <button
          type="button"
          className="floating-brand floating-collapse"
          aria-label={collapsed ? '展开面试窗口' : '收起面试窗口'}
          title={collapsed ? '展开面试窗口' : '收起面试窗口'}
          aria-expanded={!collapsed}
          onClick={async () => {
            try {
              setCollapsed(await window.desktop!.toggleInterviewCollapse());
            } catch {
              setError('窗口收起或展开失败，请重试。');
            }
          }}
        >
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          <AppLogo size={17} />
          <strong>VoxCue</strong>
          <span className="floating-mock">本地语音</span>
        </button>
        <div className="floating-controls">
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-pressed={protectedWindow}
            aria-label={protectedWindow ? '关闭截图保护' : '开启截图保护'}
            title={protectedWindow ? '关闭截图保护' : '开启截图保护'}
            onClick={() => {
              void toggleCapture();
            }}
          >
            {protectedWindow ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}
          </Button>
          <Button
            className={`floating-end ${confirmEnd ? 'is-confirming' : ''}`}
            disabled={ending}
            variant={confirmEnd ? 'destructive' : 'dangerGhost'}
            size="icon"
            aria-label={confirmEnd ? '确认结束面试' : '结束面试'}
            title={confirmEnd ? '确认结束面试并保存记录' : '结束面试'}
            onClick={confirmEnd ? close : () => setConfirmEnd(true)}
          >
            <Square size={16} />
            <span>{confirmEnd ? '确认结束' : ''}</span>
          </Button>
          <div className="floating-drag-handle" title="拖动面试窗口" aria-label="拖动面试窗口">
            <DragGrip size={20} />
          </div>
        </div>
      </header>
      <div hidden={collapsed} className={`floating-panels ${showTranscript ? '' : 'answer-only'}`}>
        {showTranscript && (
          <section className="floating-panel">
            <header>
              <h2>
                <Volume2 size={16} />
                转写
              </h2>
              <span className="neutral-badge">
                {state.speech.state === 'loading'
                  ? '正在加载本地语音…'
                  : state.status === 'running'
                    ? '本地实时转写'
                    : '转写已停止'}
              </span>
            </header>
            <div className="floating-scroll" {...transcriptScroll} tabIndex={0}>
              {!state.transcripts.length && (
                <div className="floating-empty">
                  <Volume2 size={26} />
                  <p>等待面试官或面试者讲话…</p>
                  <span>面试官在左侧，面试者在右侧</span>
                </div>
              )}
              {state.transcripts.map((t) => (
                <article
                  className={`transcript-item ${t.source === 'microphone' ? 'interviewee' : 'interviewer'}`}
                  key={t.id}
                >
                  <div className="transcript-meta">
                    <strong>
                      {t.source
                        ? t.source === 'system'
                          ? '面试官 · 系统音频'
                          : '面试者 · 麦克风'
                        : '面试官'}
                    </strong>
                    <time>{t.time}</time>
                  </div>
                  <p>
                    {t.text}
                    {!t.final && state.status === 'running' && <span className="typing-caret" />}
                  </p>
                </article>
              ))}
            </div>
          </section>
        )}
        <section className="floating-panel floating-answer">
          <header>
            <h2>
              <MessageSquare size={17} />
              回答
            </h2>
            <Button
              variant="ghost"
              className="floating-toggle"
              aria-label="转写面板"
              aria-pressed={showTranscript}
              onClick={() => setShowTranscript(!showTranscript)}
            >
              <span className="toggle-dot" />
              转写
            </Button>
          </header>
          <div className="floating-scroll" {...answerScroll} tabIndex={0}>
            {!state.answers.length && (
              <div className="floating-empty answer-empty">
                <p>{state.aiEnabled ? 'ChatGPT 回答已启用。' : '请先连接 ChatGPT。'}</p>
                <span>
                  直接发送下方实时转写，或输入新的问题。
                  <br />
                  {state.aiEnabled
                    ? '仅提交必要的问题文字和已开启的知识库片段。'
                    : '请连接 ChatGPT 并选择回答模型。'}
                </span>
              </div>
            )}
            {state.answers.map((a) => (
              <article
                key={a.id}
                className="floating-answer-item"
                aria-label={`回答：${a.question}`}
              >
                {a.reasoningSummary ? (
                  <details className="answer-reasoning">
                    <summary>
                      <span>推理摘要</span>
                      {state.generating && a.id === state.answers.at(-1)?.id && (
                        <span className="reasoning-phase">{describeActivity(a.activity)}</span>
                      )}
                      <ChevronDown size={15} />
                    </summary>
                    <MarkdownContent content={a.reasoningSummary} />
                  </details>
                ) : state.generating && a.id === state.answers.at(-1)?.id ? (
                  <ChatActivity activity={a.activity} mock={a.provider !== 'chatgpt'} />
                ) : null}
                <div className="answer-text answer-bubble" title={a.question}>
                  {a.content ? (
                    <MarkdownContent content={a.content} />
                  ) : state.generating && a.id === state.answers.at(-1)?.id ? (
                    '正在生成回答…'
                  ) : (
                    '未收到回答。'
                  )}
                  {state.generating && a.id === state.answers.at(-1)?.id && (
                    <span className="typing-caret" />
                  )}
                </div>
              </article>
            ))}
          </div>
          <form
            className="floating-composer"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <textarea
              aria-label="面试提问"
              placeholder="输入问题，或空发最新面试官问题…"
              rows={2}
              value={currentInput}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <div>
              <Button
                type="button"
                variant="ghost"
                className="floating-toggle"
                aria-label="静音后自动提交完整问题"
                aria-pressed={state.autoAnswer}
                title="静音后自动提交完整问题"
                onClick={() => state.setAutoAnswer(!state.autoAnswer)}
              >
                <span className="toggle-dot" />
                自动回答
              </Button>
              <Button
                type="submit"
                size="icon"
                disabled={state.generating || (!currentInput.trim() && !latestQuestion.trim())}
                aria-label="发送面试问题"
              >
                <ArrowUp size={17} />
              </Button>
            </div>
          </form>
        </section>
      </div>
      {!collapsed && (
        <>
          {resizeHandle('left')}
          {resizeHandle('right')}
        </>
      )}
      {(error || saveError || state.error) && (
        <div className="floating-error" role="alert">
          {error || saveError || state.error}
        </div>
      )}
    </div>
  );
}
