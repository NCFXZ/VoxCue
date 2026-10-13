import type { AIChatService } from '../backend/chat/ports';
import { HistoryTitleJobs, validateTitleRequest } from '../application/historyTitle';
import type { HistoryExportRequest, InterviewTitleEvent } from '../contracts/history';
import { handleDesktop } from './handle';
export function registerHistoryIpc(d: {
  chat: AIChatService;
  authorizeTitle(event: Electron.IpcMainInvokeEvent): string | undefined;
  requireMain(event: Electron.IpcMainInvokeEvent): void;
  emit(event: InterviewTitleEvent): void;
  exportFile(event: Electron.IpcMainInvokeEvent, request: HistoryExportRequest): Promise<boolean>;
}) {
  const jobs = new HistoryTitleJobs(d.chat, d.emit);
  handleDesktop('history:generate-title', (event, value) => {
    const lockedModel = d.authorizeTitle(event);
    const request = validateTitleRequest(value);
    if (lockedModel && lockedModel !== request.modelId) throw Error('本场面试模型已锁定。');
    jobs.enqueue(request);
  });
  handleDesktop('history:export', (event, value) => {
    d.requireMain(event);
    if (
      event.senderFrame !== event.sender.mainFrame ||
      !value ||
      typeof value.title !== 'string' ||
      value.title.length > 200 ||
      typeof value.text !== 'string' ||
      value.text.length > 3000000
    )
      throw Error('无效的导出内容。');
    return d.exportFile(event, value);
  });
  return jobs;
}
