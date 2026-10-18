import { useState, type CSSProperties } from 'react';
import { FontIncrease, FontDecrease, Reset } from './icons';
import { Button } from './ui/button';
import { MarkdownContent } from './MarkdownContent';
import {
  interviewFontSize,
  saveInterviewFontSize,
  useInterviewFontSize,
} from '../interviewTypography';

export function InterviewFontSettings() {
  const size = useInterviewFontSize();
  const [error, setError] = useState<string | null>(null);
  const change = (value: number) => {
    try {
      saveInterviewFontSize(value);
      setError(null);
    } catch {
      setError('面试字号保存失败，请检查本地存储空间后重试。');
    }
  };
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
        <output aria-label="当前面试字号" aria-live="polite">
          {size} px
        </output>
      </header>
      <div className="interview-font-actions">
        <Button
          variant="outline"
          disabled={size === interviewFontSize.maximum}
          onClick={() => change(size + 1)}
        >
          <FontIncrease size={16} />
          字体变大
        </Button>
        <Button
          variant="outline"
          disabled={size === interviewFontSize.minimum}
          onClick={() => change(size - 1)}
        >
          <FontDecrease size={16} />
          字体变小
        </Button>
        <Button
          variant="ghost"
          disabled={size === interviewFontSize.default}
          onClick={() => change(interviewFontSize.default)}
        >
          <Reset size={16} />
          重置字体大小
        </Button>
      </div>
      <div className="interview-font-preview" role="region" aria-label="面试字号预览">
        <div>
          <span className="interview-font-preview-label">转写</span>
          <p className="interview-font-sample">请介绍一个你最有代表性的项目。</p>
        </div>
        <div>
          <span className="interview-font-preview-label">回答</span>
          <div className="interview-font-sample">
            <MarkdownContent content="先说明**目标**，再介绍你的工作和结果。" />
          </div>
        </div>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
