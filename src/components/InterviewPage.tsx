import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Volume2,
} from './icons';
import { Button } from './ui/button';
import { useInterview } from '../stores/interview';
export function InterviewPage() {
  const { status, transcripts, answers, generating, error, start, pause, end, reset, ask } =
    useInterview();
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const answerEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [transcripts]);
  useEffect(() => {
    answerEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [answers]);
  const hasContent = transcripts.length > 0 || answers.length > 0 || status !== 'idle';
  async function submit() {
    if (!input.trim() || generating) return;
    const value = input;
    setInput('');
    await ask(value);
  }
  return (
    <main className="workspace">
      <div className="page-toolbar">
        <div className="breadcrumb">
          工作空间 <span>/</span>
          <strong>面试练习</strong>
        </div>
        <div className="toolbar-actions">
          <span className="mock-badge">
            <span />
            Mock 模拟
          </span>
          {status === 'running' ? (
            <>
              <Button variant="outline" onClick={pause}>
                <Pause size={14} />
                暂停
              </Button>
              <Button onClick={end}>
                <Square size={12} />
                结束练习
              </Button>
            </>
          ) : (
            <Button onClick={start}>
              <Play size={14} />
              {status === 'paused' ? '继续模拟' : status === 'ended' ? '再次模拟' : '开始模拟面试'}
            </Button>
          )}
        </div>
      </div>
      {hasContent ? (
        <div className="session-layout">
          <section className="transcript-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">LIVE TRANSCRIPT</span>
                <h2>
                  <Volume2 size={17} />
                  实时转写
                </h2>
              </div>
              <span className={`session-status ${status === 'running' ? 'listening' : ''}`}>
                <span />
                {status === 'running'
                  ? '模拟转写中'
                  : status === 'paused'
                    ? '已暂停'
                    : status === 'ended'
                      ? '已结束'
                      : '未开始'}
              </span>
            </div>
            <div className="transcript-scroll">
              {transcripts.length === 0 && (
                <div className="panel-empty">
                  <AudioLines size={28} />
                  <p>
                    {status === 'running'
                      ? '正在生成模拟面试问题…'
                      : '开始模拟后，问题将逐字显示在这里'}
                  </p>
                </div>
              )}
              {transcripts.map((t) => (
                <article className="transcript-item" key={t.id}>
                  <div className="transcript-meta">
                    <span className="speaker-avatar">面</span>
                    <strong>模拟面试官</strong>
                    <time>{t.time}</time>
                  </div>
                  <p>
                    {t.text}
                    {!t.final && status === 'running' && <span className="typing-caret" />}
                  </p>
                </article>
              ))}
              <div ref={transcriptEnd} />
            </div>
            <div className="panel-footnote">
              <CircleHelp size={13} />
              仅使用预设文本，不采集麦克风或系统音频
            </div>
          </section>
          <section className="answer-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">YOUR COPILOT</span>
                <h2>
                  <Sparkles size={17} />
                  回答建议
                </h2>
              </div>
              <span className="model-label">GPT · 模拟</span>
            </div>
            <div className="answer-scroll">
              {answers.length === 0 && (
                <div className="panel-empty">
                  <Sparkles size={28} />
                  <p>问题转写完成后，将生成模拟回答建议</p>
                </div>
              )}
              {answers.map((answer, index) => (
                <article className="answer-item" key={answer.id}>
                  <div className="answer-question">
                    <MessageSquare size={15} />
                    <span>{answer.question}</span>
                  </div>
                  <div className="answer-label">
                    <span className="ai-avatar">
                      <Sparkles size={14} />
                    </span>
                    <strong>Copilot</strong>
                    <span>模拟回答</span>
                  </div>
                  <div className="answer-text">
                    {answer.content || '正在组织回答…'}
                    {generating && index === answers.length - 1 && (
                      <span className="typing-caret" />
                    )}
                  </div>
                </article>
              ))}
              <div ref={answerEnd} />
            </div>
            {answers.length > 0 && (
              <div className="answer-actions">
                <Button
                  variant="ghost"
                  disabled={generating}
                  onClick={() => {
                    void ask(answers[answers.length - 1].question);
                  }}
                >
                  <RotateCcw size={14} />
                  重新生成
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(answers[answers.length - 1].content);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? '已复制' : '复制回答'}
                </Button>
                <Button variant="ghost" onClick={reset}>
                  新练习
                </Button>
              </div>
            )}
          </section>
        </div>
      ) : (
        <section className="welcome">
          <div className="welcome-symbol">
            <AudioLines size={39} strokeWidth={1.6} />
          </div>
          <p className="welcome-kicker">准备充分，表达从容</p>
          <h1>
            你的下一场面试，
            <br />
            <span>从这里开始。</span>
          </h1>
          <p className="welcome-description">
            和 Copilot 一起梳理思路，练习表达。
            <br />
            从一个问题开始，让每一次回答更有底气。
          </p>
          <div className="suggestions">
            {['帮我准备自我介绍', '如何讲清项目经历', '练习常见面试问题'].map((label, i) => (
              <button
                key={label}
                onClick={() => {
                  if (i === 2) start();
                  else void ask(label);
                }}
              >
                <span>0{i + 1}</span>
                {label}
                <ArrowUp size={14} />
              </button>
            ))}
          </div>
        </section>
      )}
      <div className={`composer-area ${hasContent ? 'compact' : ''}`}>
        <div className="composer-caption">
          <span>
            <MessageSquare size={14} />
            独立对话
            <ChevronDown size={13} />
          </span>
          <span>中文 · 简体</span>
        </div>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <textarea
            aria-label="面试问题"
            placeholder="输入一个面试问题，或开始模拟面试…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={2}
          />
          <div className="composer-bottom">
            <span>
              <Sparkles size={14} />
              Mock AI
              <span className="composer-divider" />
              仅用于面试练习
            </span>
            <Button
              size="icon"
              type="submit"
              disabled={!input.trim() || generating}
              aria-label="发送问题"
            >
              <ArrowUp size={18} />
            </Button>
          </div>
        </form>
        <p className="simulation-disclaimer">
          {error || '当前为前端演示：转写与 AI 回答均为模拟数据，未连接真实服务。'}
        </p>
      </div>
    </main>
  );
}
