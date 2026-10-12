import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  ArrowUp,
  Pause,
  Play,
  X,
  Minus,
  Sparkles,
  Volume2,
  Monitor,
  Check,
} from './icons';
import { Button } from './ui/button';
import { useInterview } from '../stores/interview';
import { useHistory } from '../stores/history';
export function FloatingInterview() {
  const state = useInterview();
  const saveError = useHistory((s) => s.error);
  const [input, setInput] = useState('');
  const [protectedWindow, setProtected] = useState(true);
  const [supported, setSupported] = useState(true);
  const [pinned, setPinned] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(true);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const answerEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void window.desktop
      ?.interviewState()
      .then((value) => {
        setProtected(value.protected);
        setPinned(value.pinned);
        setSupported(value.supported);
      })
      .catch(() => setError('无法读取窗口隐私状态，请返回主窗口重试。'));
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
      if (current.sessionId) current.end();
    };
    window.addEventListener('beforeunload', archive);
    return () => {
      media.removeEventListener('change', theme);
      window.removeEventListener('storage', theme);
      window.removeEventListener('beforeunload', archive);
    };
  }, []);
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [state.transcripts]);
  useEffect(() => {
    answerEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [state.answers]);
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
  const close = () => {
    state.end();
    if (!useHistory.getState().error) window.desktop?.windowAction('close');
  };
  const submit = () => {
    const text = input.trim() || [...state.transcripts].reverse().find((t) => t.final)?.text;
    if (!text || state.generating) return;
    setInput('');
    void state.ask(text);
  };
  return (
    <div className="floating-shell">
      <header className="floating-toolbar">
        <div className="floating-brand">
          <AudioLines size={17} />
          <strong>Copilot</strong>
          <span className="floating-mock">Mock 面试</span>
        </div>
        <div className="floating-controls">
          <Button
            variant="ghost"
            aria-pressed={showTranscript}
            onClick={() => setShowTranscript(!showTranscript)}
          >
            转写面板
          </Button>
          <Button
            variant="ghost"
            aria-pressed={pinned}
            onClick={async () => {
              try {
                setPinned(await window.desktop!.togglePin());
              } catch {
                setError('置顶切换失败。');
              }
            }}
          >
            {pinned ? <Check size={13} /> : <Monitor size={13} />}
            {pinned ? '已置顶' : '置顶'}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            aria-pressed={!protectedWindow}
            onClick={() => {
              void toggleCapture();
            }}
          >
            {protectedWindow ? '截图保护已开启' : '允许截图/共享'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="最小化面试窗口"
            onClick={() => window.desktop?.windowAction('minimize')}
          >
            <Minus size={15} />
          </Button>
          <Button variant="ghost" size="icon" aria-label="结束面试并返回" onClick={close}>
            <X size={16} />
          </Button>
        </div>
      </header>
      <div className={`floating-panels ${showTranscript ? '' : 'answer-only'}`}>
        {showTranscript && (
          <section className="floating-panel">
            <header>
              <h2>
                <Volume2 size={16} />
                转写
              </h2>
              <span className="neutral-badge">模拟文本 · 无音频采集</span>
            </header>
            <div className="floating-scroll">
              {!state.transcripts.length && (
                <div className="floating-empty">
                  <Volume2 size={26} />
                  <p>模拟转写会显示在这里</p>
                  <span>点击下方按钮开始练习</span>
                </div>
              )}
              {state.transcripts.map((t) => (
                <article className="transcript-item" key={t.id}>
                  <div className="transcript-meta">
                    <strong>模拟面试官</strong>
                    <time>{t.time}</time>
                  </div>
                  <p>
                    {t.text}
                    {!t.final && state.status === 'running' && <span className="typing-caret" />}
                  </p>
                </article>
              ))}
              <div ref={transcriptEnd} />
            </div>
            <footer>
              <Button
                variant="outline"
                onClick={state.status === 'running' ? state.pause : state.start}
              >
                {state.status === 'running' ? <Pause size={13} /> : <Play size={13} />}
                {state.status === 'running'
                  ? '暂停模拟'
                  : state.status === 'paused'
                    ? '继续模拟'
                    : '开始模拟转写'}
              </Button>
              <span>
                {state.status === 'running'
                  ? '模拟转写中'
                  : state.status === 'paused'
                    ? '已暂停'
                    : state.status === 'ended'
                      ? '已结束'
                      : '准备就绪'}
              </span>
            </footer>
          </section>
        )}
        <section className="floating-panel floating-answer">
          <header>
            <h2>
              <Sparkles size={16} />
              回答
            </h2>
            <span className="neutral-badge">GPT · Mock</span>
          </header>
          <div className="floating-scroll">
            {!state.answers.length && (
              <div className="floating-empty answer-empty">
                <p>模拟回答已就绪。</p>
                <span>
                  输入问题，或留空发送最新的模拟转写问题。
                  <br />
                  所有回答均为预设示例，未连接真实 AI。
                </span>
              </div>
            )}
            {state.answers.map((a) => (
              <article key={a.id} className="floating-answer-item">
                <div className="answer-question">{a.question}</div>
                <div className="answer-text">
                  {a.content || '正在生成模拟建议…'}
                  {state.generating && a.id === state.answers.at(-1)?.id && (
                    <span className="typing-caret" />
                  )}
                </div>
              </article>
            ))}
            <div ref={answerEnd} />
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
              placeholder="输入问题，或留空发送最新模拟问题…"
              rows={2}
              value={input}
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
                aria-pressed={state.autoAnswer}
                onClick={() => state.setAutoAnswer(!state.autoAnswer)}
              >
                {state.autoAnswer ? '◉ 自动回答' : '○ 手动回答'}
              </Button>
              <Button variant="ghost" type="button" onClick={close}>
                结束面试
              </Button>
              <Button
                type="submit"
                size="icon"
                disabled={
                  state.generating || (!input.trim() && !state.transcripts.some((t) => t.final))
                }
                aria-label="发送面试问题"
              >
                <ArrowUp size={17} />
              </Button>
            </div>
          </form>
        </section>
      </div>
      <div className="floating-notice" role={error || saveError ? 'alert' : undefined}>
        {error ||
          saveError ||
          state.error ||
          (!supported
            ? '当前系统不支持 Windows 截图保护。'
            : protectedWindow
              ? 'Windows 截图保护已开启 · 不保证所有捕获工具均遵守 · Mock 模拟'
              : '已允许截图与屏幕共享 · 重新打开窗口后恢复保护 · Mock 模拟')}
      </div>
    </div>
  );
}
