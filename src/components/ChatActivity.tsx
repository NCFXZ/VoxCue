import type { ChatActivity as Activity } from '../../electron/contracts/chat';
const labels: Record<Activity['phase'], string> = {
  waiting: '正在等待服务响应',
  thinking: '正在思考',
  searching: '正在联网搜索',
  reading: '正在查询网页',
  writing: '正在生成回答',
  processing: '正在处理请求',
};
export function ChatActivity({ activity, mock }: { activity?: Activity; mock: boolean }) {
  return (
    <div className="chat-activity" role="status" aria-live="polite">
      <span className="activity-dot" aria-hidden="true" />
      <span>
        {mock ? '正在生成模拟回复' : labels[activity?.phase ?? 'waiting']}
        {!mock && activity?.detail && <span className="activity-detail"> · {activity.detail}</span>}
      </span>
    </div>
  );
}
