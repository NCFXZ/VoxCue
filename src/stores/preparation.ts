import { create } from 'zustand';
import {
  mockPreparation,
  extractProfileChanges,
  needsProfileReview,
  type ChatMessage,
  type PersonalInfo,
} from '../services/preparation';
import { localKnowledge, type LocalDocument } from '../services/knowledge';
import { stageAttachments, type ChatAttachment } from '../services/chatOptions';
import { useChatConnection } from './chatConnection';
import { streamChat } from '../services/chat';
import type { ChatRequest, ReasoningEffort } from '../../electron/contracts/chat';
import { validProfile, validateChanges } from '../../electron/contracts/profile';
import {
  defaultAnswerStyle,
  validateAnswerStyle,
  answerStyleInstructions,
  type AnswerStyle,
} from '../services/answerStyle';
const emptyInfo: PersonalInfo = { name: '', role: '', jobDescription: '', background: '' };
let controller: AbortController | undefined;
interface PreparationState {
  conversations: Array<{ id: string; title: string; messages: ChatMessage[] }>;
  activeConversation: string | null;
  selectConversation(id: string): void;
  deleteConversation(id: string): void;
  info: PersonalInfo;
  answerStyle: AnswerStyle;
  updateAnswerStyle(style: AnswerStyle): boolean;
  messages: ChatMessage[];
  resume: LocalDocument | null;
  streaming: boolean;
  uploading: boolean;
  error: string | null;
  attachments: ChatAttachment[];
  modelId: string;
  effort: ReasoningEffort | 'auto';
  setEffort(effort: ReasoningEffort | 'auto'): void;
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
  dismissProfile(messageId: string): void;
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
  answerStyle: { ...defaultAnswerStyle },
  updateAnswerStyle(value) {
    try {
      const answerStyle = validateAnswerStyle(value);
      localStorage.setItem('copilot-answer-style-v1', JSON.stringify(answerStyle));
      set({ answerStyle, error: null });
      return true;
    } catch (error) {
      set({
        error:
          error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)
            ? error.message
            : '回答风格保存失败，请重试。',
      });
      return false;
    }
  },
  messages: [],
  resume: null,
  streaming: false,
  uploading: false,
  error: null,
  attachments: [],
  modelId: 'mock-general',
  effort: 'low',
  setEffort(effort) {
    set({ effort });
  },
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
      const savedStyle = localStorage.getItem('copilot-answer-style-v1');
      set({
        answerStyle: savedStyle
          ? validateAnswerStyle(JSON.parse(savedStyle))
          : { ...defaultAnswerStyle },
      });
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
      if (messageId) {
        const proposal = get().messages.find((message) => message.id === messageId);
        if (
          !proposal ||
          proposal.status !== 'completed' ||
          proposal.applied ||
          proposal.dismissed ||
          !proposal.profileBase
        )
          throw new Error('这份资料提案已失效，请重新整理。');
        info = validateChanges(proposal.changes);
        if (
          Object.keys(info).some(
            (key) =>
              get().info[key as keyof PersonalInfo] !==
              proposal.profileBase![key as keyof PersonalInfo],
          )
        )
          throw new Error('个人信息已变化，为避免覆盖较新的修改，请重新生成提案。');
      }
      const merged = { ...get().info, ...info };
      if (!validProfile(merged)) throw new Error('个人信息格式无效或内容过长。');
      localStorage.setItem('copilot-personal-info-v1', JSON.stringify(merged));
      set((state) => ({
        info: merged,
        error: null,
        messages: state.messages.map((message) =>
          message.id === messageId ? { ...message, applied: true } : message,
        ),
      }));
      return true;
    } catch (error) {
      set({
        error:
          error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)
            ? error.message
            : '资料保存失败，请检查本地存储空间。',
      });
      return false;
    }
  },
  dismissProfile(messageId) {
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === messageId && !message.applied ? { ...message, dismissed: true } : message,
      ),
    }));
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
      effort: selected.reasoningEfforts?.includes(get().effort as ReasoningEffort)
        ? (get().effort as ReasoningEffort)
        : undefined,
      webSearch: get().webSearch,
      attachments: [...get().attachments],
    };
    const text = prompt.trim() || '请帮我整理这些附件。';
    const profileBase = { ...get().info };
    const answerStyle = { ...get().answerStyle };
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
          changes: connection.live ? undefined : extractProfileChanges(prompt),
          profileBase,
          mode: connection.live ? 'live' : 'mock',
          provider: connection.live ? 'chatgpt' : 'mock',
          activity: { phase: 'waiting' },
          status: 'streaming',
        },
      ],
      streaming: true,
      error: null,
      attachments: [],
    }));
    try {
      if (connection.live) {
        const reviewProfile = needsProfileReview(prompt, options.attachments.length);
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
          effort: options.effort,
          webSearch: options.webSearch,
          turns,
          profile: reviewProfile ? profileBase : undefined,
          instructions:
            '你是 VoxCue，帮助用户准备面试、改善简历表达和整理项目经历。使用中文 Markdown 回答，避免捏造个人经历或成绩。资料更新需要用户明确确认。引用搜索来源，区分事实与建议。' +
            answerStyleInstructions(answerStyle) +
            '\n' +
            (reviewProfile
              ? ''
              : `以下是用户主动保存的个人资料，作为参考信息：\n${JSON.stringify(profileBase)}`),
        };
        const result = await streamChat(
          request,
          (event) => {
            if (current.signal.aborted) return;
            if (event.type === 'delta')
              set((state) => ({
                messages: state.messages.map((message) =>
                  message.id === id
                    ? {
                        ...message,
                        content: message.content + event.text,
                        activity: { phase: 'writing' as const },
                      }
                    : message,
                ),
              }));
            if (event.type === 'activity' || event.type === 'search')
              set((state) => ({
                messages: state.messages.map((message) =>
                  message.id === id
                    ? {
                        ...message,
                        activity:
                          event.type === 'activity'
                            ? event.activity
                            : { phase: 'searching' as const },
                      }
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
              ? {
                  ...message,
                  changes: validateChanges(result.profileChanges ?? {}),
                  // Fast JSON responses can resolve before queued IPC deltas arrive.
                  content: result.answerText ?? message.content,
                  sources: result.sources,
                  usage: result.usage,
                  status: 'completed',
                }
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
