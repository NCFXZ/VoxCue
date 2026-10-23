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
          <p className="section-help">仅调整转写、问题和回答气泡中的文字大小。</p>
        </div>
      </header>
      <InterviewDisplayControls />
      <InterviewPreview />
    </section>
  );
}
