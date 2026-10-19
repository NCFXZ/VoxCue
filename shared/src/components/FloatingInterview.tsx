import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowUp,
  ChevronUp,
  ChevronDown,
  ShieldCheck,
  ShieldOff,
  Square,
  Expand,
  MessageSquare,
  Volume2,
  DragGrip,
  Copy,
  Check,
  Screenshot,
  Loader,
  X,
  Refresh,
  AudioLines,
  Sparkles,
  Settings,
} from './icons';
import { Button } from './ui/button';
import { useInterview } from '../stores/interview';
import { useHistory } from '../stores/history';
import { AppLogo } from './AppLogo';
import { useFollowScroll } from './useFollowScroll';
import { MarkdownContent } from './MarkdownContent';
import { ResponseProgress } from './ResponseProgress';
import { InterviewAudioRecovery } from './InterviewAudioRecovery';
import { InterviewSettingsPanel } from './InterviewSettingsPanel';
import { InterviewSubmissionStatus } from './InterviewSubmissionStatus';
import { InterviewReadiness } from './InterviewReadiness';
import { interviewLayout } from '../../electron/contracts/interviewLayout';
import { ProviderIdentity } from './ProviderIdentity';
import { providerInfo } from '../services/providers';
import { useInterviewWindowDrag } from './useInterviewWindowDrag';
import { useInterviewFontSize } from '../interviewTypography';
export function FloatingInterview() {
  const fontSize = useInterviewFontSize();
  const state = useInterview();
  const provider = providerInfo(state.answers.at(-1)?.provider);
  const saveError = useHistory((s) => s.error);
  const [input, setInput] = useState<string | null>(null);
  const editedDraft = useRef('');
  const [protectedWindow, setProtected] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const windowDrag = useInterviewWindowDrag(() => setError('无法移动面试窗口。'));
  const [showTranscript, setShowTranscript] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [resizing, setResizing] = useState(false);
  const transcriptScroll = useFollowScroll(state.transcripts);
  const answerScroll = useFollowScroll(state.answers);
  const resizeReady = useRef<Promise<void>>(Promise.resolve());
  const resizeFrame = useRef(0);
  const resizeMove = useRef<Promise<void>>(Promise.resolve());
  const resizeInFlight = useRef(false);
  const resizeDirty = useRef(false);
  const dragging = useRef(false);
  const resizePointer = useRef<{ target: HTMLButtonElement; id: number } | null>(null);
  const currentInput = input ?? state.draftQuestion;
  useEffect(() => {
    const desktop = window.desktop;
    if (!desktop?.presentation?.interviewMousePassthrough) return;
    const surfaces =
      '.floating-toolbar, .floating-panel, .floating-resize, .floating-notices > div, dialog[open]';
    let disposed = false;
    let ignored: boolean | undefined;
    let pointer: { x: number; y: number; buttons: number } | undefined;
    const apply = (ignore: boolean) => {
      if (ignore === ignored) return;
      ignored = ignore;
      desktop.setInterviewMousePassthrough(ignore);
    };
    const refresh = () => {
      // A modal's backdrop is a dismiss target across the whole canvas. Native
      // click-through must stay off even when elementFromPoint reports no panel.
      if (!disposed && document.querySelector('dialog[open]')) {
        apply(false);
        return;
      }
      if (disposed || !pointer || pointer.buttons || dragging.current || windowDrag.active.current)
        return;
      const target = document.elementFromPoint(
        pointer.x - window.screenX,
        pointer.y - window.screenY,
      );
      apply(!target?.closest(surfaces));
    };
    const move = (event: MouseEvent) => {
      // Forwarded events can report screen coordinates relative to the view.
      // Reconstruct the screen point from the current window and viewport point.
      pointer = {
        x: window.screenX + event.clientX,
        y: window.screenY + event.clientY,
        buttons: event.buttons,
      };
      refresh();
    };
    const release = (event: MouseEvent) => {
      move(event);
      // Resize's mouseup listener releases its drag lock later in this event.
      queueMicrotask(refresh);
    };
    const leave = (event: MouseEvent) => {
      if (event.relatedTarget || event.buttons || dragging.current || windowDrag.active.current)
        return;
      // Disabling native forwarding can queue a leave with older coordinates.
      // Keep the latest move/release point; a leave must not overwrite it and
      // make a control click-through again. Outside this window, Windows/macOS
      // already route input to the window under the cursor.
      refresh();
    };
    // Forwarded mouse moves keep the visible controls reachable while blank
    // canvas areas pass clicks through. Never switch in the middle of a drag.
    apply(true);
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mousedown', move, true);
    window.addEventListener('mouseup', release, true);
    window.addEventListener('mouseout', leave, true);
    window.addEventListener('resize', refresh);
    window.addEventListener('interview-window-drag-end', refresh);
    const observer = new ResizeObserver(refresh);
    const dialogs = new MutationObserver(refresh);
    dialogs.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    document
      .querySelectorAll('.floating-toolbar, .floating-panels, .floating-notices')
      .forEach((element) => observer.observe(element));
    return () => {
      disposed = true;
      observer.disconnect();
      dialogs.disconnect();
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mousedown', move, true);
      window.removeEventListener('mouseup', release, true);
      window.removeEventListener('mouseout', leave, true);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('interview-window-drag-end', refresh);
      desktop.setInterviewMousePassthrough(true);
    };
  }, []);
  useEffect(() => {
    // Clearing an edit pauses autofill for that transcript only. Newly received
    // interviewer speech resumes autofill; a non-empty manual edit is preserved.
    if (input === '' && editedDraft.current !== state.draftQuestion) setInput(null);
  }, [state.draftQuestion, input]);
  const latestQuestion =
    state.draftQuestion ||
    [...state.transcripts]
      .reverse()
      .find(
        (t) =>
          t.reason !== 'discontinuity' &&
          (t.source === 'system' || (!t.source && state.mode === 'mock')),
      )?.text ||
    '';
  useEffect(() => {
    if (!confirmEnd || ending) return;
    const timer = setTimeout(() => setConfirmEnd(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmEnd, ending]);
  useEffect(() => {
    // Native window resizing can release pointer capture before pointerup.
    const move = (event: PointerEvent) => {
      if (!dragging.current) return;
      if (!(event.buttons & 1)) {
        finishResize();
        return;
      }
      queueResize();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', finishResize, true);
    window.addEventListener('mouseup', finishResize, true);
    window.addEventListener('pointercancel', finishResize, true);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', finishResize, true);
      window.removeEventListener('mouseup', finishResize, true);
      window.removeEventListener('pointercancel', finishResize, true);
    };
  }, []);
  useEffect(
    () => () => {
      cancelAnimationFrame(resizeFrame.current);
      if (dragging.current) void window.desktop?.resizeInterview({ phase: 'end' }).catch(() => {});
    },
    [],
  );
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
        setShowTranscript(value.transcriptVisible);
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
    if (
      state.generating ||
      state.updatingModel ||
      state.capturingScreenshot ||
      (!currentInput.trim() && !latestQuestion.trim() && !state.screenshots.length)
    )
      return;
    const text = currentInput.trim() || (state.screenshots.length ? '' : latestQuestion);
    setInput(null);
    if (state.mode === 'local') void state.submitTranscript(text, true);
    else void state.ask(text);
  };
  // Keep only the latest pointer intent and one native resize in flight.
  function queueResize() {
    resizeDirty.current = true;
    if (resizeFrame.current || resizeInFlight.current || !dragging.current) return;
    resizeFrame.current = requestAnimationFrame(() => {
      resizeFrame.current = 0;
      resizeDirty.current = false;
      resizeInFlight.current = true;
      resizeMove.current = resizeReady.current
        .then(() => window.desktop!.resizeInterview({ phase: 'move' }))
        .catch(() => setError('无法调整窗口尺寸。'))
        .finally(() => {
          resizeInFlight.current = false;
          const pointer = resizePointer.current;
          if (dragging.current && pointer && !pointer.target.hasPointerCapture(pointer.id)) {
            try {
              pointer.target.setPointerCapture(pointer.id);
            } catch {
              /* The pointer may already be up. */
            }
          }
          if (resizeDirty.current && dragging.current) queueResize();
        });
    });
  }
  function finishResize() {
    if (!dragging.current) return;
    dragging.current = false;
    resizePointer.current = null;
    cancelAnimationFrame(resizeFrame.current);
    resizeFrame.current = 0;
    resizeDirty.current = false;
    void resizeReady.current
      .then(() => resizeMove.current)
      .then(async () => {
        await window.desktop!.resizeInterview({ phase: 'move' });
        await window.desktop!.resizeInterview({ phase: 'end' });
      })
      .catch(() => setError('无法调整窗口尺寸。'))
      .finally(() => setResizing(false));
  }
  const resizeHandle = (edge: 'left' | 'right') => (
    <button
      type="button"
      className={`floating-resize resize-${edge}`}
      aria-label={edge === 'left' ? '拖动左下角调整尺寸' : '拖动右下角调整尺寸'}
      aria-describedby="resize-keyboard-hint"
      onKeyDown={(event) => {
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '+', '-'].includes(event.key))
          return;
        event.preventDefault();
        void window
          .desktop!.resizeInterview(['ArrowUp', 'ArrowRight', '+'].includes(event.key) ? 1 : -1)
          .catch(() => setError('无法调整窗口尺寸。'));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        resizePointer.current = { target: event.currentTarget, id: event.pointerId };
        dragging.current = true;
        setResizing(true);
        resizeReady.current = window
          .desktop!.resizeInterview({ phase: 'start', edge })
          .catch(() => setError('无法调整窗口尺寸。'));
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        finishResize();
      }}
      onPointerCancel={() => {
        finishResize();
      }}
    >
      <Expand size={17} />
    </button>
  );
  return (
    <div className="floating-viewport">
      <div
        style={
          {
            '--panel-height': `max(0px, calc(100dvh - ${interviewLayout.chromeHeight}px))`,
            '--interview-font-size': `${fontSize}px`,
            '--transcript-width': `calc(var(--panel-height) * ${interviewLayout.transcriptWidth / interviewLayout.panelHeight})`,
            '--answer-width': `calc(var(--panel-height) * ${interviewLayout.answerWidth / interviewLayout.panelHeight})`,
          } as CSSProperties
        }
        className={`floating-shell ${collapsed ? 'is-collapsed' : ''} ${resizing ? 'is-resizing' : ''}`}
      >
        <header className="floating-toolbar">
          <button
            type="button"
            className="floating-brand floating-collapse"
            aria-label={collapsed ? '展开面试窗口' : '收起面试窗口'}
            aria-expanded={!collapsed}
            title={collapsed ? '展开面试窗口' : '收起面试窗口'}
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
          </button>
          <div className="floating-controls">
            <Button
              variant="ghost"
              size="icon"
              aria-label="面试设置"
              title="面试设置"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={19} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              aria-pressed={protectedWindow}
              aria-label={protectedWindow ? '关闭截图保护' : '开启截图保护'}
              title={protectedWindow ? '截图保护已开启，点击关闭' : '截图保护已关闭，点击开启'}
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
              title={confirmEnd ? '再次点击结束并保存本场面试' : '结束面试'}
              onClick={confirmEnd ? close : () => setConfirmEnd(true)}
            >
              <Square size={16} />
              <span>{confirmEnd ? '确认结束' : ''}</span>
            </Button>
            <div
              className="floating-drag-handle"
              aria-label="拖动面试窗口"
              title="拖动面试窗口"
              onPointerDown={windowDrag.onPointerDown}
            >
              <DragGrip size={20} />
            </div>
          </div>
        </header>
        <div
          hidden={collapsed}
          className={`floating-panels ${showTranscript ? '' : 'answer-only'}`}
        >
          {showTranscript && (
            <section className="floating-panel">
              <header>
                <h2>
                  <Volume2 size={16} />
                  转写
                </h2>
                <InterviewReadiness />
              </header>
              <InterviewAudioRecovery onSettings={() => setSettingsOpen(true)} />
              <div
                className="floating-scroll"
                {...transcriptScroll.scrollProps}
                tabIndex={0}
                aria-label="面试转写"
              >
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
                        {t.source ? (t.source === 'system' ? '面试官' : '面试者') : '面试官'}
                      </strong>
                      <time>{t.time}</time>
                    </div>
                    <p>
                      {t.text}
                      {!t.final && state.status === 'running' && <span className="typing-caret" />}
                    </p>
                    {t.reason === 'discontinuity' && (
                      <small className="transcript-gap">音频间断，片段可能不完整</small>
                    )}
                  </article>
                ))}
              </div>
              {!transcriptScroll.following && (
                <Button
                  className="follow-latest"
                  variant="outline"
                  onClick={transcriptScroll.scrollToLatest}
                >
                  <ChevronDown size={14} />
                  {transcriptScroll.hasNew ? '有新转写 · 返回最新' : '返回最新转写'}
                </Button>
              )}
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
                onClick={async () => {
                  try {
                    setShowTranscript(
                      await window.desktop!.setInterviewTranscriptVisible(!showTranscript),
                    );
                  } catch {
                    setError('无法切换转写面板。');
                  }
                }}
              >
                <span className="toggle-dot" />
                <AudioLines size={14} />
                转写
              </Button>
            </header>
            {!showTranscript && <InterviewAudioRecovery onSettings={() => setSettingsOpen(true)} />}
            <div
              className="floating-scroll"
              {...answerScroll.scrollProps}
              tabIndex={0}
              aria-label="面试回答"
            >
              {!state.answers.length && (
                <div className="floating-empty answer-empty">
                  <p>{state.aiEnabled ? `${provider.name}回答已启用。` : '请先连接模型服务。'}</p>
                  <span>
                    直接发送下方实时转写，或输入新的问题。
                    <br />
                    {state.aiEnabled
                      ? '回答会结合本场问题、追问和你的实际回答。仅发送必要文字与相关资料片段。'
                      : '请连接模型服务并选择回答模型。'}
                  </span>
                </div>
              )}
              {state.answers.map((a) => (
                <article
                  key={a.id}
                  className="floating-answer-item"
                  aria-label={`回答：${a.question}`}
                >
                  <div className="floating-question" aria-label="面试问题">
                    {a.question}
                    {a.screenshot && (
                      <span className="floating-screenshot-label">
                        <Screenshot size={14} />
                        {a.screenshot === 'only' ? '截图提问' : '附截图'}
                      </span>
                    )}
                  </div>
                  <div className="floating-answer-meta">
                    <span className="provider-identity">
                      <ProviderIdentity
                        provider={a.provider ?? 'unknown'}
                        detail={
                          a.status === 'stopped'
                            ? '已停止'
                            : a.status === 'failed'
                              ? '回答未完成'
                              : undefined
                        }
                      />
                    </span>
                    {a.content && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="复制面试回答"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(a.content);
                            setCopied(a.id);
                            setCopyError(null);
                          } catch {
                            setCopyError(a.id);
                          }
                        }}
                      >
                        {copied === a.id ? <Check size={14} /> : <Copy size={14} />}
                      </Button>
                    )}
                  </div>
                  <ResponseProgress
                    message={{
                      content: a.content,
                      status: a.status ?? 'completed',
                      mode: a.provider === 'mock' ? 'mock' : 'live',
                      activity: a.activity,
                      reasoningSummary: a.reasoningSummary,
                      startedAt: a.createdAt,
                    }}
                  />
                  <div className="answer-text answer-bubble">
                    {a.content ? (
                      <MarkdownContent content={a.content} />
                    ) : state.generating && a.id === state.answers.at(-1)?.id ? (
                      '正在生成回答…'
                    ) : a.status === 'stopped' ? (
                      '已停止回复。'
                    ) : (
                      a.error || '未收到回答。'
                    )}
                    {state.generating && a.id === state.answers.at(-1)?.id && (
                      <span className="typing-caret" />
                    )}
                    {a.error && a.content && (
                      <p className="message-error" role="alert">
                        {a.error}
                      </p>
                    )}
                    {(a.status === 'failed' || a.status === 'stopped') && (
                      <div className="floating-answer-actions">
                        <Button
                          variant="outline"
                          disabled={state.generating}
                          onClick={() => void state.retryAnswer(a.id)}
                        >
                          <Refresh size={16} />
                          重试面试回答
                        </Button>
                      </div>
                    )}
                  </div>
                  {(copied === a.id || copyError === a.id) && (
                    <small role="status">
                      {copyError === a.id ? '复制失败，请选择文字后复制。' : '已复制回答'}
                    </small>
                  )}
                </article>
              ))}
            </div>
            {!answerScroll.following && (
              <Button
                className="follow-latest"
                variant="outline"
                onClick={answerScroll.scrollToLatest}
              >
                <ChevronDown size={14} />
                {answerScroll.hasNew ? '有新回答 · 返回最新' : '返回最新回答'}
              </Button>
            )}
            <form
              className="floating-composer"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              {state.screenshots.length > 0 && (
                <div className="floating-screenshot-previews" role="group" aria-label="待发送截图">
                  {state.screenshots.map((shot, index) => (
                    <div className="floating-screenshot-preview" key={shot.id}>
                      <img src={shot.preview} alt={`截图 ${index + 1}`} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`移除截图 ${index + 1}`}
                        disabled={state.generating}
                        onClick={() => void state.removeScreenshot(shot.id)}
                      >
                        <X size={12} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                aria-label="面试提问"
                placeholder="输入问题，或按 Enter 发送最新面试官问题…"
                title="Enter 发送，Shift+Enter 换行"
                rows={2}
                value={currentInput}
                onChange={(event) => {
                  editedDraft.current = state.draftQuestion;
                  setInput(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <div className="floating-composer-toolbar">
                <div className="floating-composer-options">
                  <Button
                    type="button"
                    variant="ghost"
                    className="floating-toggle"
                    aria-label="静音后自动提交完整问题"
                    aria-pressed={state.autoAnswer}
                    onClick={() => state.setAutoAnswer(!state.autoAnswer)}
                  >
                    <span className="toggle-dot" />
                    <Sparkles size={14} />
                    自动回答：{state.autoAnswer ? '开' : '关'}
                  </Button>
                  <InterviewSubmissionStatus />
                </div>
                <div className="floating-composer-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="floating-screenshot-button"
                    aria-label="截取图像"
                    title="截取图像，加入待发送截图，最多5张"
                    aria-busy={state.capturingScreenshot}
                    data-expanded={state.capturingScreenshot || state.screenshots.length > 0}
                    disabled={
                      state.generating ||
                      state.capturingScreenshot ||
                      !state.aiEnabled ||
                      state.screenshots.length >= 5
                    }
                    onClick={() => void state.captureScreenshot()}
                  >
                    {state.capturingScreenshot ? (
                      <span className="update-spinner">
                        <Loader size={18} />
                      </span>
                    ) : (
                      <Screenshot size={18} />
                    )}
                    <span className="floating-screenshot-count" aria-live="polite">
                      {state.screenshots.length}/5
                    </span>
                  </Button>
                  {state.generating ? (
                    <Button
                      type="button"
                      size="icon"
                      aria-label="停止当前回答"
                      title="停止当前回答"
                      onClick={(event) => {
                        // Stopping immediately replaces this control with Submit.
                        // Cancel the click's default action before React updates it.
                        event.preventDefault();
                        state.stopAnswer();
                      }}
                    >
                      <Square size={15} />
                    </Button>
                  ) : (
                    <Button
                      className="send-button"
                      type="submit"
                      size="icon"
                      disabled={
                        state.generating ||
                        state.updatingModel ||
                        state.capturingScreenshot ||
                        (!currentInput.trim() &&
                          !latestQuestion.trim() &&
                          !state.screenshots.length)
                      }
                      aria-label="发送面试问题"
                      title="发送问题（Enter）；换行（Shift+Enter）"
                    >
                      <ArrowUp size={20} />
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </section>
        </div>
        {!collapsed && (
          <>
            <span id="resize-keyboard-hint" className="sr-only">
              方向键或加减键调整窗口大小；向上或向右放大，向下或向左缩小。
            </span>
            {resizeHandle('left')}
            {resizeHandle('right')}
          </>
        )}
        {!collapsed && (
          <footer className="floating-notices" aria-label="面试状态提示">
            {!protectedWindow && (
              <div className="floating-warning floating-capture-notice" role="status">
                此窗口未隐藏
              </div>
            )}
            {(error || saveError || state.error) && (
              <div className="floating-error" role="alert">
                {error || saveError || state.error}
              </div>
            )}
            {Object.entries(state.speechWarnings).map(([source, message]) => (
              <div key={source} className="floating-warning" role="status">
                {message}
              </div>
            ))}
          </footer>
        )}
      </div>
      {settingsOpen && <InterviewSettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
