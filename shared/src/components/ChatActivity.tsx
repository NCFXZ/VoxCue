import type { ChatActivity as Activity } from '../../electron/contracts/chat';
const labels: Record<Activity['phase'], string> = {
  waiting: '正在思考',
  thinking: '正在思考',
  searching: '正在联网搜索',
  reading: '正在查询网页',
  writing: '正在生成回答',
  organizing: '正在整理可保存的资料字段',
  processing: '正在处理请求',
};
export const describeActivity = (activity?: Activity) => {
  const label = labels[activity?.phase ?? 'waiting'];
  return activity?.status === 'completed' ? label.replace(/^正在/, '已') : label;
};
export function ChatActivity({ activity, mock }: { activity?: Activity; mock: boolean }) {
  return (
    <div className="chat-activity" role="status" aria-live="polite">
      <span className="progress-state-label is-active">
        {mock ? '正在思考' : labels[activity?.phase ?? 'thinking']}
        {!mock && activity?.detail && <span className="activity-detail"> · {activity.detail}</span>}
      </span>
    </div>
  );
}
