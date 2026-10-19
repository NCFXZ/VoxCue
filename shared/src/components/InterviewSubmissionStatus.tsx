import { useInterview } from '../stores/interview';

export function InterviewSubmissionStatus() {
  const s = useInterview();
  const label = s.reconnecting
    ? '正在连接音频'
    : s.speech.state === 'error'
      ? '音频已中断'
      : s.speech.state === 'loading'
        ? '正在准备音频'
        : s.generating
          ? '正在回答'
          : s.speech.state === 'running'
            ? '正在收听'
            : '收听已暂停';
  return (
    <span className="interview-submission-status" role="status" aria-live="polite">
      {label}
    </span>
  );
}
