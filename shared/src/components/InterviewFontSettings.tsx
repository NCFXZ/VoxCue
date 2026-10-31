import type { CSSProperties } from 'react';
import { InterviewDisplayControls } from './InterviewDisplayControls';
import { useInterviewFontSize } from '../interviewTypography';
import { InterviewPreview } from './InterviewPreview';

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
          <p className="section-help">调整转写与回答的背景透明度，以及对话气泡中的文字大小。</p>
        </div>
      </header>
      <InterviewDisplayControls />
      <p className="interview-preview-help section-help">
        上下滚动预览背景，查看面试窗口在不同背景上的显示效果。
      </p>
      <InterviewPreview />
    </section>
  );
}
