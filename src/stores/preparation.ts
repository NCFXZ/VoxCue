import { create } from 'zustand';
import {
  mockPreparation,
  extractProfileChanges,
  type ChatMessage,
  type PersonalInfo,
} from '../services/preparation';
import { localKnowledge, type LocalDocument } from '../services/knowledge';
import { stageAttachments, type ChatAttachment } from '../services/chatOptions';
import { useChatConnection } from './chatConnection';
import { streamChat } from '../services/chat';
import type { ChatRequest } from '../../electron/contracts/chat';
const emptyInfo: PersonalInfo = { name: '', role: '', jobDescription: '', background: '' };
let controller: AbortController | undefined;
interface PreparationState {
  conversations: Array<{ id: string; title: string; messages: ChatMessage[] }>;
  activeConversation: string | null;
  selectConversation(id: string): void;
  deleteConversation(id: string): void;
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
  conversations: [],
  activeConversation: null,
  selectConversation(id) {
    const conversation = get().conversations.find((item) => item.id === id);
    if (!conversation || get().activeConversation === id) return;
    get().stop();
    set({ activeConversation: id, messages: conversation.messages, attachments: [], error: null });
  },
  deleteConversation(id) {
    if (get().activeConversation === id) get().reset();
    set((state) => ({ conversations: state.conversations.filter((item) => item.id !== id) }));
  },
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
    if (useChatConnection.getState().models.some((model) => model.id === id)) set({ modelId: id });
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
    const connection = useChatConnection.getState();
    const selected =
      connection.models.find((model) => model.id === get().modelId) ?? connection.models[0];
    if (!selected) {
      set({ error: connection.error || '正在加载模型，请稍候。' });
      return;
    }
    const options = {
      modelId: selected.id,
      modelLabel: selected.label,
      live: connection.live,
      webSearch: get().webSearch,
      attachments: [...get().attachments],
    };
    const text = prompt.trim() || '请帮我整理这些附件。';
    if (!get().activeConversation) {
      const conversationId = crypto.randomUUID();
      set((state) => ({
        activeConversation: conversationId,
        conversations: [
          ...state.conversations,
          { id: conversationId, title: text.slice(0, 36), messages: [] },
        ],
      }));
    }
    const current = new AbortController();
    controller = current;
    const id = crypto.randomUUID();
    set((state) => ({
      messages: [
        ...state.messages,
        { id: crypto.randomUUID(), role: 'user', content: text, options },
        {
          id,
          role: 'assistant',
          content: '',
          changes: extractProfileChanges(prompt),
          mode: connection.live ? 'live' : 'mock',
          status: 'streaming',
        },
      ],
      streaming: true,
      error: null,
      attachments: [],
    }));
    try {
      if (connection.live) {
        const info = get().info;
        const turns = await Promise.all(
          get()
            .messages.filter(
              (message) =>
                message.id !== id && (message.role === 'user' || message.status === 'completed'),
            )
            .map(async (message) => ({
              role: message.role,
              content: message.content,
              files:
                message.role === 'user'
                  ? await Promise.all(
                      (message.options?.attachments ?? []).map(async (item) => ({
                        name: item.name,
                        bytes: new Uint8Array(await item.file.arrayBuffer()),
                      })),
                    )
                  : undefined,
            })),
        );
        current.signal.throwIfAborted();
        const request: ChatRequest = {
          id,
          modelId: options.modelId,
          webSearch: options.webSearch,
          turns,
          instructions: `你是 AI Interview Copilot，帮助用户准备面试、改善简历表达和整理项目经历。使用中文回答，避免捏造个人经历或成绩。资料更新需要用户明确确认。引用搜索来源，区分事实与建议。以下是用户主动保存的个人资料，作为参考信息：\n${JSON.stringify(info)}`,
        };
        const result = await streamChat(
          request,
          (event) => {
            if (current.signal.aborted) return;
            if (event.type === 'delta')
              set((state) => ({
                messages: state.messages.map((message) =>
                  message.id === id
                    ? { ...message, content: message.content + event.text }
                    : message,
                ),
              }));
            if (event.type === 'sources')
              set((state) => ({
                messages: state.messages.map((message) =>
                  message.id === id ? { ...message, sources: event.sources } : message,
                ),
              }));
          },
          current.signal,
        );
        set((state) => ({
          error: result.warning ?? null,
          messages: state.messages.map((message) =>
            message.id === id
              ? { ...message, sources: result.sources, usage: result.usage, status: 'completed' }
              : message,
          ),
        }));
      } else {
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
        if (!current.signal.aborted)
          set((state) => ({
            messages: state.messages.map((message) =>
              message.id === id ? { ...message, status: 'completed' } : message,
            ),
          }));
      }
    } catch (error) {
      const stopped = current.signal.aborted;
      if (!stopped) set({ error: error instanceof Error ? error.message : '回复失败，请重试。' });
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === id ? { ...message, status: stopped ? 'stopped' : 'failed' } : message,
        ),
      }));
    } finally {
      if (controller === current) set({ streaming: false });
      if (connection.live) void useChatConnection.getState().refreshUsage();
    }
  },
  stop() {
    controller?.abort();
    set((state) => ({
      streaming: false,
      messages: state.messages.map((message) =>
        message.status === 'streaming' ? { ...message, status: 'stopped' } : message,
      ),
    }));
  },
  reset() {
    get().stop();
    set({ activeConversation: null, messages: [], attachments: [], error: null });
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
// Keep the active conversation snapshot in sync without duplicating File objects.
usePreparation.subscribe((state, previous) => {
  if (state.activeConversation && state.messages !== previous.messages)
    usePreparation.setState({
      conversations: state.conversations.map((item) =>
        item.id === state.activeConversation ? { ...item, messages: state.messages } : item,
      ),
    });
});
