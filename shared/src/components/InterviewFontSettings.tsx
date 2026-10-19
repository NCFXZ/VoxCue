import type { CSSProperties } from 'react';
import { MarkdownContent } from './MarkdownContent';
import { InterviewDisplayControls } from './InterviewDisplayControls';
import { useInterviewFontSize } from '../interviewTypography';
import { AppLogo } from './AppLogo';
import { ProviderIdentity } from './ProviderIdentity';
import {
  ArrowUp,
  AudioLines,
  ChevronUp,
  Copy,
  MessageSquare,
  Settings,
  ShieldCheck,
  Sparkles,
  Screenshot,
  Volume2,
} from './icons';

export function InterviewFontSettings() {
  const size = useInterviewFontSize();
  return (
    <section
      className="interview-font-settings"
      aria-label="面试界面"
      style={{ '--interview-font-size': `${size}px` } as CSSProperties}
    >
      <header className="interview-font-heading">
        <div>
          <h3>面试界面</h3>
          <p className="section-help">调整转写、问题、回答和输入文字的大小。</p>
        </div>
      </header>
      <InterviewDisplayControls />
      <div className="interview-preview-scene" role="region" aria-label="面试字号预览">
        {/* Use the real surface classes, so chrome, panels and bubbles retain
            their distinct opacity and accessibility contrast rules. */}
        <div className="interview-preview-shell">
          <div className="floating-toolbar">
            <span className="floating-brand">
              <ChevronUp size={16} />
              <AppLogo size={17} />
              <strong>VoxCue</strong>
            </span>
            <span className="interview-preview-tools">
              <Settings size={19} />
              <ShieldCheck size={18} />
            </span>
          </div>
          <div className="interview-font-preview">
            <section className="floating-panel">
              <header>
                <h2>
                  <Volume2 size={16} />
                  转写
                </h2>
              </header>
              <div className="floating-scroll">
                <article className="transcript-item interviewer">
                  <div className="transcript-meta">
                    <strong>面试官</strong>
                    <time>14:18</time>
                  </div>
                  <p className="interview-font-sample">请介绍一个你负责过的项目。</p>
                </article>
                <article className="transcript-item interviewee">
                  <div className="transcript-meta">
                    <strong>面试者</strong>
                    <time>14:19</time>
                  </div>
                  <p className="interview-font-sample">我负责了项目的设计与交付。</p>
                </article>
              </div>
            </section>
            <section className="floating-panel floating-answer">
              <header>
                <h2>
                  <MessageSquare size={17} />
                  回答
                </h2>
                <span className="interview-preview-tools">
                  <AudioLines size={14} />
                  转写
                </span>
              </header>
              <div className="floating-scroll">
                <div className="floating-question interview-font-sample">
                  请介绍一个你负责过的项目。
                </div>
                <div className="floating-answer-meta">
                  <span className="provider-identity">
                    <ProviderIdentity provider="chatgpt" />
                  </span>
                  <Copy size={14} />
                </div>
                <div className="answer-text answer-bubble interview-font-sample">
                  <MarkdownContent content="先说明**项目目标**，再介绍你的工作和结果。" />
                </div>
              </div>
              <div className="floating-composer">
                <textarea
                  className="interview-font-sample"
                  aria-label="预览输入框"
                  tabIndex={-1}
                  readOnly
                  rows={2}
                  placeholder="输入问题…"
                />
                <div className="floating-composer-toolbar">
                  <span className="interview-preview-tools">
                    <Sparkles size={14} />
                    自动回答
                  </span>
                  <span className="floating-composer-actions">
                    <Screenshot size={18} />
                    <span className="send-button ui-button button-icon">
                      <ArrowUp size={18} />
                    </span>
                  </span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}
