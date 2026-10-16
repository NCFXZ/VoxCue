import type { ChatModel, ReasoningEffort } from '../../electron/contracts/chat';
export const chatModels: ChatModel[] = [
  {
    id: 'mock-general',
    label: 'GPT · 通用',
    description: 'Mock · 日常准备与简历表达',
    reasoningEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'mock-reasoning',
    label: 'GPT · 推理',
    description: 'Mock · 项目梳理与分析',
    reasoningEfforts: ['low', 'medium', 'high'],
  },
];
export const effortLabels: Record<ReasoningEffort | 'auto', string> = {
  auto: '自动',
  none: '无思考',
  minimal: '极低',
  low: '轻度',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
};
export interface ChatAttachment {
  id: string;
  name: string;
  size: number;
  file: File;
}
export interface ChatRequestOptions {
  modelId: string;
  webSearch: boolean;
  attachments: ChatAttachment[];
  modelLabel?: string;
  live?: boolean;
  effort?: ReasoningEffort;
  profileTask?: 'skills';
}
export const chatFileAccept =
  '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.png,.jpg,.jpeg,.webp';
export function stageAttachments(existing: ChatAttachment[], files: File[]): ChatAttachment[] {
  if (!files.length) throw new Error('没有找到可添加的文件。');
  const result = [...existing];
  for (const file of files) {
    if (!chatFileAccept.split(',').includes(`.${file.name.split('.').pop()?.toLowerCase()}`))
      throw new Error(`不支持的文件格式：${file.name}`);
    if (!file.size || file.size > 20 * 1024 * 1024)
      throw new Error(`文件需为 1 字节至 20 MB：${file.name}`);
    const name = file.webkitRelativePath || file.name;
    const index = result.findIndex((item) => item.name === name);
    const attachment = { id: crypto.randomUUID(), name, size: file.size, file };
    if (index >= 0) result[index] = attachment;
    else result.push(attachment);
    if (result.length > 20) throw new Error('每条消息最多添加 20 个文件。');
  }
  return result;
}

interface DropEntry {
  name: string;
  isFile: boolean;
  file(success: (file: File) => void, failure: (error: DOMException) => void): void;
  createReader(): {
    readEntries(
      success: (entries: DropEntry[]) => void,
      failure: (error: DOMException) => void,
    ): void;
  };
}
// Folder entries may arrive in batches; drain every batch and enforce a small bounded import.
export async function readDroppedFiles(data: DataTransfer): Promise<File[]> {
  const entries = Array.from(data.items)
    .map((item) => item.webkitGetAsEntry() as unknown as DropEntry | null)
    .filter((entry): entry is DropEntry => !!entry);
  if (!entries.length) return Array.from(data.files);
  const files: File[] = [];
  let visited = 0;
  async function visit(entry: DropEntry, depth = 0, prefix = ''): Promise<void> {
    if (++visited > 500) throw new Error('文件夹内容过多，请选择具体文件。');
    if (depth > 10) throw new Error('文件夹层级过深，请使用添加文件。');
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
      files.push(
        prefix
          ? new File([file], prefix + file.name, {
              type: file.type,
              lastModified: file.lastModified,
            })
          : file,
      );
      if (files.length > 20) throw new Error('每条消息最多添加 20 个文件。');
    } else {
      const reader = entry.createReader();
      while (true) {
        const batch = await new Promise<DropEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        for (const child of batch) await visit(child, depth + 1, prefix + entry.name + '/');
      }
    }
  }
  for (const entry of entries) await visit(entry);
  return files;
}
