import { create } from 'zustand';
import {
  mockPreparation,
  extractProfileChanges,
  type ChatMessage,
  type PersonalInfo,
} from '../services/preparation';
import { localKnowledge, type LocalDocument } from '../services/knowledge';
import { stageAttachments, type ChatAttachment } from '../services/chatOptions';
const emptyInfo: PersonalInfo = { name: '', role: '', jobDescription: '', background: '' };
let controller: AbortController | undefined;
interface PreparationState {
  info: PersonalInfo;
  messages: ChatMessage[];
  resume: LocalDocument | null;
  streaming: boolean;
  uploading: boolean;
  error: string | null;
  attachments: ChatAttachment[];
  modelId: string;
  webSearch: boolean;
  addAttachments(files: File[]): void;
  removeAttachment(id: string): void;
  setModel(id: string): void;
  setWebSearch(enabled: boolean): void;
  load(): Promise<void>;
  send(prompt: string): Promise<void>;
  reset(): void;
  stop(): void;
  updateInfo(info: Partial<PersonalInfo>, messageId?: string): boolean;
  uploadResume(file: File): Promise<void>;
  removeResume(): Promise<void>;
}
export const usePreparation = create<PreparationState>((set, get) => ({
  info: emptyInfo,
  messages: [],
  resume: null,
  streaming: false,
  uploading: false,
  error: null,
  attachments: [],
  modelId: 'mock-general',
  webSearch: false,
  addAttachments(files) {
    try {
      set({ attachments: stageAttachments(get().attachments, files), error: null });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '添加文件失败。' });
    }
  },
  removeAttachment(id) {
    set((state) => ({ attachments: state.attachments.filter((item) => item.id !== id) }));
  },
  setModel(id) {
    if (['mock-general', 'mock-reasoning'].includes(id)) set({ modelId: id });
  },
  setWebSearch(enabled) {
    set({ webSearch: enabled });
  },
  async load() {
    try {
      const raw = localStorage.getItem('copilot-personal-info-v1');
      if (raw) {
        const info = JSON.parse(raw);
        if (
          !info ||
          !['name', 'role', 'jobDescription', 'background'].every(
            (key) => typeof info[key] === 'string',
          )
        )
          throw new Error();
        set({ info });
      }
      const docs = await localKnowledge.listDocuments('personal-resume');
      set({ resume: docs[0] ?? null });
    } catch {
      set({ error: '本地资料读取失败，请重试。现有数据已保留。' });
    }
  },
  updateInfo(info, messageId) {
    try {
      const merged = { ...get().info, ...info };
      localStorage.setItem('copilot-personal-info-v1', JSON.stringify(merged));
      set((state) => ({
        info: merged,
        error: null,
        messages: state.messages.map((message) =>
          message.id === messageId ? { ...message, applied: true } : message,
        ),
      }));
      return true;
    } catch {
      set({ error: '资料保存失败，请检查本地存储空间。' });
      return false;
    }
  },
  async send(prompt) {
    if ((!prompt.trim() && !get().attachments.length) || get().streaming) return;
    const options = {
      modelId: get().modelId,
      webSearch: get().webSearch,
      attachments: [...get().attachments],
    };
    const text = prompt.trim() || '请帮我整理这些附件。';
    const current = new AbortController();
    controller = current;
    const id = crypto.randomUUID();
    set((state) => ({
      messages: [
        ...state.messages,
        { id: crypto.randomUUID(), role: 'user', content: text, options },
        { id, role: 'assistant', content: '', changes: extractProfileChanges(prompt) },
      ],
      streaming: true,
      error: null,
      attachments: [],
    }));
    try {
      await mockPreparation.streamReply(
        text,
        get().info,
        (chunk) => {
          if (!current.signal.aborted)
            set((state) => ({
              messages: state.messages.map((message) =>
                message.id === id ? { ...message, content: message.content + chunk } : message,
              ),
            }));
        },
        current.signal,
        options,
      );
    } catch (error) {
      if ((error as Error).name !== 'AbortError') set({ error: '模拟回复失败，请重试。' });
    } finally {
      if (controller === current) set({ streaming: false });
    }
  },
  stop() {
    controller?.abort();
    set({ streaming: false });
  },
  reset() {
    get().stop();
    set({ messages: [], attachments: [], error: null });
  },
  async uploadResume(file) {
    set({ uploading: true, error: null });
    try {
      await localKnowledge.importDocuments('personal-resume', [file]);
      const docs = await localKnowledge.listDocuments('personal-resume');
      const current = docs.find((doc) => doc.name === file.name)!;
      set({ resume: current });
      for (const doc of docs)
        if (doc.id !== current.id) await localKnowledge.deleteDocument(doc.id);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '简历保存失败，请重试。' });
    } finally {
      set({ uploading: false });
    }
  },
  async removeResume() {
    const doc = get().resume;
    if (!doc) return;
    try {
      await localKnowledge.deleteDocument(doc.id);
      set({ resume: null, error: null });
    } catch {
      set({ error: '移除简历失败，请重试。' });
    }
  },
}));
