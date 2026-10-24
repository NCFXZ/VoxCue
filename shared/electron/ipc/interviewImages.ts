import { handleDesktop } from './handle';
import { validImageId } from '../backend/interview/images';
import type { InterviewImageStore } from '../backend/interview/images';

export function registerInterviewImageIpc(d: {
  store: InterviewImageStore;
  requireReader(event: Electron.IpcMainInvokeEvent): void;
  requireMain(event: Electron.IpcMainInvokeEvent): void;
  saveFile(
    event: Electron.IpcMainInvokeEvent,
    image: { bytes: Uint8Array; extension: 'png' | 'jpg' },
  ): Promise<boolean>;
}) {
  handleDesktop('interview:image', async (event, value, ...extra: unknown[]) => {
    d.requireReader(event);
    if (
      extra.length ||
      event.senderFrame !== event.sender.mainFrame ||
      !value ||
      typeof value !== 'object' ||
      !['read', 'preview', 'save', 'remove'].includes(value.op) ||
      Object.keys(value).some(
        (key) => !['op', value.op !== 'remove' ? 'id' : 'ids'].includes(key),
      ) ||
      (value.op !== 'remove' && !validImageId(value.id)) ||
      (value.op === 'remove' &&
        (!Array.isArray(value.ids) ||
          value.ids.length > 100 ||
          value.ids.some((id) => !validImageId(id))))
    )
      throw Error('无效的截图操作。');
    if (value.op === 'remove' || value.op === 'save') d.requireMain(event);
    try {
      if (value.op === 'save') {
        const image = await d.store.original(value.id);
        d.requireMain(event);
        const saved = await d.saveFile(event, image);
        return { ok: true, canceled: !saved };
      }
      if (value.op !== 'remove') {
        const dataUrl = await (value.op === 'preview'
          ? d.store.preview(value.id)
          : d.store.read(value.id));
        d.requireReader(event);
        return { ok: true, dataUrl };
      }
      await d.store.remove(value.ids);
      return { ok: true };
    } catch {
      return {
        ok: false,
        error: {
          message:
            value.op === 'save'
              ? '保存图片失败，请检查目标位置权限和可用空间。'
              : value.op !== 'remove'
                ? '无法读取图片，文件可能已移除。'
                : '截图清理失败，请稍后重试。',
        },
      };
    }
  });
}
