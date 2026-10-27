import {
  hasInterviewUsageNotice,
  type InterviewUsageState,
} from '../../electron/contracts/cloudUsage';
import { Warning } from './icons';

export function InterviewUsageNotice({
  usage,
  saved,
}: {
  usage?: InterviewUsageState | null;
  saved: boolean;
}) {
  if (!usage || !hasInterviewUsageNotice(usage)) return null;
  const seconds = usage.remainingSeconds!;
  return (
    <div className="floating-warning floating-usage-notice" role="status" aria-live="off">
      <Warning size={16} />
      <span>
        {usage.state === 'expired' ? (
          saved ? (
            '本次面试已停止。'
          ) : (
            '正在保存本次面试记录…'
          )
        ) : (
          <>
            面试额度剩余{' '}
            <span className="interview-remaining-time">
              {seconds < 60 ? `${seconds} 秒` : `${Math.ceil(seconds / 60)} 分钟`}
            </span>
            ，用尽后将自动结束并保存记录。
          </>
        )}
      </span>
    </div>
  );
}
