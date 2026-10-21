import type { Answer } from '../services/contracts';
import { Loader, Refresh, Warning } from './icons';
import { Button } from './ui/button';

export function InterviewAnswerStatus({ answer }: { answer: Answer }) {
  const retrying = answer.status === 'streaming' && !!answer.retry;
  if (!retrying && answer.status !== 'failed' && answer.status !== 'stopped') return null;
  return (
    <span
      className={`interview-answer-status ${retrying ? 'is-retrying' : answer.status === 'failed' ? 'is-failed' : 'is-stopped'}`}
      role="status"
    >
      {retrying ? (
        <span className="update-spinner">
          <Loader size={12} />
        </span>
      ) : answer.status === 'failed' ? (
        <Warning size={13} />
      ) : null}
      {retrying
        ? `正在重试 ${answer.retry!.attempt}/${answer.retry!.limit}`
        : answer.status === 'failed'
          ? '生成失败'
          : '已停止'}
    </span>
  );
}

export function InterviewAnswerFailure({
  answer,
  disabled,
  onRetry,
  live = true,
}: {
  answer: Answer;
  disabled: boolean;
  onRetry(): void;
  live?: boolean;
}) {
  return (
    <div
      className="interview-answer-failure"
      role={live ? 'alert' : 'note'}
      aria-label="回答生成失败"
    >
      <div className="interview-answer-failure-heading">
        <span className="interview-answer-failure-icon">
          <Warning size={20} />
        </span>
        <div>
          <strong>回答生成失败</strong>
          <p>
            {answer.retry
              ? `已自动重试 ${answer.retry.attempt} 次，仍未完成。`
              : '本次回答未完成。'}
          </p>
        </div>
      </div>
      <p className="interview-answer-failure-reason">
        {answer.error || '未收到有效回答，请重新生成。'}
      </p>
      <div className="interview-answer-failure-actions">
        <Button disabled={disabled} onClick={onRetry}>
          <Refresh size={15} />
          重试面试回答
        </Button>
      </div>
    </div>
  );
}
