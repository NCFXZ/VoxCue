import { create } from 'zustand';
import { mergeActivityLog } from '../../electron/contracts/activity';
import {
  mockPreparation,
  extractProfileChanges,
  needsProfileReview,
  needsSkillResearch,
  type ChatMessage,
  type PersonalInfo,
} from '../services/preparation';
import { localKnowledge, type LocalDocument } from '../services/knowledge';
import { stageAttachments, type ChatAttachment } from '../services/chatOptions';
import { useChatConnection } from './chatConnection';
import { streamChat, ChatRequestError } from '../services/chat';
import { localChats, type ChatSnapshot, type PreparationConversation } from '../services/chats';
import type { ChatRequest, ReasoningEffort } from '../../electron/contracts/chat';
import {
  validProfile,
  validateChanges,
  profileProposalStale,
} from '../../electron/contracts/profile';
import {
  defaultAnswerStyle,
  validateAnswerStyle,
  answerStyleInstructions,
  type AnswerStyle,
} from '../services/answerStyle';
const emptyInfo: PersonalInfo = { name: '', jobDescription: '', background: '' };
let controller: AbortController | undefined;
let controllerConversation: string | null = null;
let restoringChats: Promise<void> | undefined;
let savingChats: Promise<void> | undefined;
let pendingChats: ChatSnapshot | undefined;
interface PreparationState {
  conversations: PreparationConversation[];
  chatsReady: boolean;
  chatStorageError: string | null;
  restoreChats(): Promise<void>;
  flushChats(): Promise<boolean>;
  viewing: boolean;
  setViewing(value: boolean): void;
  activeConversation: string | null;
  selectConversation(id: string): void;
  deleteConversation(id: string): void;
  info: PersonalInfo;
  selectedKnowledgeBaseId: string | null;
  selectKnowledgeBase(id: string | null): Promise<boolean>;
  skillsNeedUpdate: boolean;
  dismissSkillUpdate(): void;
  generateSkills(): Promise<void>;
  answerStyle: AnswerStyle;
  messages: ChatMessage[];
  draft: string;
  setDraft(value: string): void;
  resume: LocalDocument | null;
  streaming: boolean;
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
  send(prompt: string, retryId?: string, task?: 'skills'): Promise<void>;
  retry(id: string): Promise<void>;
  reset(preserveReply?: boolean): void;
  stop(): void;
  updateInfo(info: Partial<PersonalInfo>, messageId?: string): boolean;
  dismissProfile(messageId: string): void;
  removeResume(): Promise<boolean>;
}
export const usePreparation = create<PreparationState>((set, get) => ({
  conversations: [],
  chatsReady: false,
  chatStorageError: null,
  async restoreChats() {
    if (get().chatsReady) return;
    if (restoringChats) return restoringChats;
    restoringChats = (async () => {
      try {
        const saved = await localChats.read();
        const active = saved?.conversations.find((c) => c.id === saved.activeConversation);
        set({
          ...(saved
            ? {
                conversations: saved.conversations,
                modelId: saved.modelId,
                effort: saved.effort,
                webSearch: saved.webSearch,
                skillsNeedUpdate: saved.skillsNeedUpdate ?? false,
                activeConversation: active?.id ?? null,
                messages: active?.messages ?? [],
                draft: active?.draft ?? saved.draft,
                attachments: active?.attachments ?? saved.attachments,
              }
            : {}),
          chatsReady: true,
          chatStorageError: null,
        });
      } catch (error) {
        set({
          chatStorageError:
            error instanceof Error ? error.message : '聊天读取失败，请重试。现有数据已保留。',
        });
      }
    })();
    try {
      await restoringChats;
    } finally {
      restoringChats = undefined;
    }
  },
  async flushChats() {
    if (restoringChats) await restoringChats;
    if (!get().chatsReady) return false;
    queueChats(get());
    while (savingChats) await savingChats;
    return !get().chatStorageError;
  },
  viewing: false,
  setViewing(viewing) {
    set((state) => ({
      viewing,
      conversations: viewing
        ? state.conversations.map((conversation) =>
            conversation.id === state.activeConversation
              ? { ...conversation, unread: false }
              : conversation,
          )
        : state.conversations,
    }));
  },
  activeConversation: null,
  draft: '',
  setDraft(draft) {
    set({ draft });
  },
  selectConversation(id) {
    const conversation = get().conversations.find((item) => item.id === id);
    if (!conversation || get().activeConversation === id) return;
    set((state) => ({
      activeConversation: id,
      messages: conversation.messages,
      draft: conversation.draft ?? '',
      attachments: conversation.attachments ?? [],
      error: null,
      conversations: [
        ...state.conversations.map((item) =>
          state.viewing && item.id === id ? { ...item, unread: false } : item,
        ),
        ...(!state.activeConversation && (state.draft.trim() || state.attachments.length)
          ? [
              {
                id: crypto.randomUUID(),
                title: state.draft.trim().slice(0, 36) || state.attachments[0].name,
                messages: [],
                draft: state.draft,
                attachments: state.attachments,
              },
            ]
          : []),
      ],
    }));
  },
  deleteConversation(id) {
    if (id === controllerConversation) get().stop();
    if (get().activeConversation === id) get().reset(id !== controllerConversation);
    set((state) => ({ conversations: state.conversations.filter((item) => item.id !== id) }));
  },
  info: emptyInfo,
  selectedKnowledgeBaseId: null,
  skillsNeedUpdate: false,
  dismissSkillUpdate() {
    set({ skillsNeedUpdate: false });
  },
  async generateSkills() {
    await get().send(
      '请联网查询，根据已确认的简历摘要和职位描述摘要，整理最相关的3–5项核心面试技能。每项用约120–220字简述技术重点、岗位关联和必要事实边界，附1–2个本次真实来源；不要默认展开教程、口述稿或追问清单。保留未要求变更的已有技能。完整内容只放下方待确认提案，聊天正文简短说明即可，不直接保存。',
      undefined,
      'skills',
    );
  },
  async selectKnowledgeBase(id) {
    try {
      if (id !== null && !(await localKnowledge.listBases()).some((base) => base.id === id))
        throw Error('所选知识库已不存在，请重新选择。');
      localStorage.setItem('copilot-interview-knowledge-base-v1', JSON.stringify(id));
      set({ selectedKnowledgeBaseId: id, error: null });
      return true;
    } catch {
      set({ error: '知识库选择保存失败，请刷新后重新选择。' });
      return false;
    }
  },
  answerStyle: { ...defaultAnswerStyle },
  messages: [],
  resume: null,
  streaming: false,
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
    await get().restoreChats();
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
        // Read old instruction lists as one document; never rewrite storage on load.
        if (Array.isArray(info.customInstructions)) {
          const entries = info.customInstructions;
          if (
            entries.length > 10 ||
            !Array.from(entries).every(
              (entry: any) =>
                entry && typeof entry.title === 'string' && typeof entry.content === 'string',
            )
          )
            throw new Error();
          info.customInstructions = entries
            .map((entry: any) => `${entry.title}\n${entry.content}`)
            .join('\n\n');
        }
        if (!validProfile(info)) throw new Error();
        set({ info });
      }
      const selection = localStorage.getItem('copilot-interview-knowledge-base-v1');
      if (selection) {
        const id = JSON.parse(selection);
        if (id !== null && (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id))) throw Error();
        set({ selectedKnowledgeBaseId: id });
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
        if (profileProposalStale(get().info, proposal.profileBase, info))
          throw new Error('个人信息已变化，为避免覆盖较新的修改，请重新生成提案。');
      }
      const merged = { ...get().info, ...info };
      if (!validProfile(merged)) throw new Error('个人信息格式无效或内容过长。');
      localStorage.setItem('copilot-personal-info-v1', JSON.stringify(merged));
      set((state) => ({
        info: merged,
        skillsNeedUpdate:
          info.skills !== undefined
            ? false
            : (info.background !== undefined && info.background !== state.info.background) ||
                (info.jobDescription !== undefined &&
                  info.jobDescription !== state.info.jobDescription)
              ? true
              : state.skillsNeedUpdate,
        error: null,
        messages: state.messages.map((message) =>
          message.id === messageId ? { ...message, applied: true, error: undefined } : message,
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
      if (messageId)
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === messageId ? { ...message, error: state.error || undefined } : message,
          ),
        }));
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
  async retry(id) {
    await get().send('', id);
  },
  async send(prompt, retryId, task) {
    if (restoringChats) await restoringChats;
    const retryIndex = retryId ? get().messages.findIndex((m) => m.id === retryId) : -1;
    const retryMessage = get().messages[retryIndex];
    const retryUser = retryIndex > 0 ? get().messages[retryIndex - 1] : undefined;
    if (
      retryId &&
      (retryIndex !== get().messages.length - 1 ||
        retryMessage?.role !== 'assistant' ||
        !['failed', 'stopped'].includes(retryMessage.status ?? '') ||
        retryUser?.role !== 'user')
    )
      return;
    if ((!prompt.trim() && !get().attachments.length && !retryUser) || get().streaming) return;
    if (retryUser) prompt = retryUser.content;
    const yes = /^(?:确认|确定|同意|确认更新|确认保存|同意更新|同意保存)[。！!\s]*$/.test(
      prompt.trim(),
    );
    const no = /^(?:拒绝|拒绝更新|取消更新|保留旧版|不更新|暂不更新|不同意|取消)[。！!\s]*$/.test(
      prompt.trim(),
    );
    const explicitConfirmation = /^(?:确认更新|确认保存|同意更新|同意保存)[。！!\s]*$/.test(
      prompt.trim(),
    );
    if (!retryId && (yes || no)) {
      const proposal = [...get().messages]
        .reverse()
        .find((message) => message.role === 'assistant');
      const hasProposal = !!proposal?.changes && !!Object.keys(proposal.changes).length;
      const acknowledge = (content: string) =>
        set((state) => ({
          draft: '',
          error: null,
          messages: [
            ...state.messages,
            { id: crypto.randomUUID(), role: 'user', content: prompt.trim() },
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              status: 'completed',
              mode: 'live',
              provider: { id: 'voxcue', name: 'VoxCue', dataRecipient: '本机' },
              content,
            },
          ],
        }));
      if (hasProposal && !proposal!.applied && !proposal!.dismissed) {
        if (yes) {
          if (get().updateInfo({}, proposal!.id))
            acknowledge('资料已确认并保存到本机，可以继续聊天。');
        } else {
          get().dismissProfile(proposal!.id);
          acknowledge('已保留原资料，可以继续聊天。');
        }
        return;
      }
      // A saved proposal is not pending again. A separate skills question never locks chat.
      if (get().skillsNeedUpdate && !explicitConfirmation) {
        if (no) {
          get().dismissSkillUpdate();
          acknowledge('已保存的资料保持不变，本次暂不联网更新技能。');
        } else if (get().info.background.trim() && get().info.jobDescription.trim()) {
          await get().generateSkills();
        } else {
          get().dismissSkillUpdate();
          acknowledge(
            '已确认的资料已经保存。简历和职位描述摘要尚未齐全，本次暂不生成技能；可以继续聊天或补充缺少的摘要。',
          );
        }
        return;
      }
      if (hasProposal && proposal!.applied) {
        acknowledge('这份资料已确认并保存，无需再次确认，可以继续聊天。');
        return;
      }
      if (explicitConfirmation) {
        if (hasProposal) get().updateInfo({}, proposal!.id);
        else
          set({
            error:
              '没有可确认的完整资料提案。请重新发送“更新我的简历”并等待提案卡片出现，再确认更新。',
          });
        return;
      }
    }
    const skillTask =
      task === 'skills' ||
      retryUser?.options?.profileTask === 'skills' ||
      needsSkillResearch(prompt);
    if (skillTask && (!get().info.background.trim() || !get().info.jobDescription.trim())) {
      set({ error: '请先提供并确认简历摘要和职位描述摘要，再联网生成技能。' });
      return;
    }
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
      webSearch: skillTask || get().webSearch,
      ...(skillTask ? { profileTask: 'skills' as const } : {}),
      attachments: skillTask ? [] : [...(retryUser?.options?.attachments ?? get().attachments)],
    };
    const text = prompt.trim() || '请帮我整理这些附件。';
    const profileBase = structuredClone(get().info);
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
    const owner = get().activeConversation!;
    // Route every event to its originating conversation, even after navigation.
    const update = (
      change: Partial<PreparationState> | ((state: PreparationState) => Partial<PreparationState>),
    ) =>
      set((state) => {
        const messages =
          state.activeConversation === owner
            ? state.messages
            : state.conversations.find((c) => c.id === owner)?.messages;
        if (!messages) return {};
        const patch = typeof change === 'function' ? change({ ...state, messages }) : change;
        if (patch.messages)
          patch.messages = patch.messages.map((message) =>
            message.id === id &&
            message.startedAt !== undefined &&
            messages.find((previous) => previous.id === id)?.status !== 'stopped'
              ? { ...message, durationMs: Math.max(0, Date.now() - message.startedAt) }
              : message,
          );
        const completed = patch.messages?.some(
          (message) =>
            message.role === 'assistant' &&
            message.status === 'completed' &&
            messages.find((previous) => previous.id === message.id)?.status === 'streaming',
        );
        const unread = completed && !(state.viewing && state.activeConversation === owner);
        if (state.activeConversation === owner)
          return {
            ...patch,
            ...(unread
              ? {
                  conversations: state.conversations.map((conversation) =>
                    conversation.id === owner ? { ...conversation, unread: true } : conversation,
                  ),
                }
              : {}),
          };
        const {
          messages: nextMessages,
          error: _error,
          attachments: _attachments,
          ...shared
        } = patch;
        return {
          ...shared,
          conversations: nextMessages
            ? state.conversations.map((c) =>
                c.id === owner
                  ? { ...c, messages: nextMessages, ...(unread ? { unread: true } : {}) }
                  : c,
              )
            : state.conversations,
        };
      });
    const current = new AbortController();
    controllerConversation = owner;
    controller = current;
    const id = crypto.randomUUID();
    update((state) => ({
      messages: [
        ...(retryId
          ? state.messages.slice(0, -1).map((m) => (m.id === retryUser?.id ? { ...m, options } : m))
          : state.messages),
        ...(!retryId
          ? [{ id: crypto.randomUUID(), role: 'user' as const, content: text, options }]
          : []),
        {
          id,
          role: 'assistant',
          content: '',
          changes: connection.live ? undefined : extractProfileChanges(prompt),
          profileBase,
          mode: connection.live ? 'live' : 'mock',
          provider: connection.live ? (selected.provider ?? 'unknown') : 'mock',
          activity: { phase: 'thinking' },
          status: 'streaming',
          startedAt: Date.now(),
          durationMs: 0,
        },
      ],
      streaming: true,
      error: null,
      attachments: retryId || skillTask ? get().attachments : [],
      ...(!retryId && !task ? { draft: '' } : {}),
    }));
    try {
      if (connection.live) {
        const reviewProfile =
          !!task || skillTask || needsProfileReview(prompt, options.attachments.length);
        const turns = await Promise.all(
          get()
            .messages.filter(
              (message) =>
                message.id !== id && (message.role === 'user' || message.status === 'completed'),
            )
            .map(async (message) => ({
              role: message.role,
              content:
                message.content +
                (message.role === 'assistant' &&
                message.changes &&
                Object.keys(message.changes).length
                  ? message.applied
                    ? '\n\n[本机操作状态：用户已在应用中确认这份提案，资料已成功保存。不要再要求发送确认或拒绝；当前资料以本次提供的 profile 为准。]'
                    : message.dismissed
                      ? '\n\n[本机操作状态：用户已拒绝这份提案并保留旧资料，不再等待确认。]'
                      : '\n\n[本机操作状态：这份提案尚未保存；用户可以继续普通聊天，不必先确认或拒绝。]'
                  : ''),
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
          profile: (({ role: _legacyRole, ...active }) => active)(profileBase),
          ...(skillTask ? { profileTask: 'skills' as const } : {}),
          knowledgeBaseId: reviewProfile ? null : get().selectedKnowledgeBaseId,
          instructions:
            '你是 VoxCue，帮助用户准备面试、改善简历表达和整理项目经历。使用中文 Markdown 回答，避免捏造个人经历或成绩。资料更新需要用户明确确认。引用搜索来源，区分事实与建议。' +
            answerStyleInstructions(answerStyle) +
            `\n遵循用户已经确认的自定义指令，优先于默认表达偏好：${profileBase.customInstructions || '无'}`,
        };
        const result = await streamChat(
          request,
          (event) => {
            if (current.signal.aborted) return;
            if (event.type === 'profile-preview')
              update((state) => ({
                messages: state.messages.map((message) =>
                  message.id === id ? { ...message, profilePreview: event.preview } : message,
                ),
              }));
            if (event.type === 'reasoning-summary')
              update((state) => ({
                messages: state.messages.map((message) =>
                  message.id === id ? { ...message, reasoningSummary: event.text } : message,
                ),
              }));
            if (event.type === 'delta')
              update((state) => ({
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
              update((state) => ({
                messages: state.messages.map((message) =>
                  message.id === id
                    ? {
                        ...message,
                        activity:
                          event.type === 'activity'
                            ? event.activity
                            : { phase: 'searching' as const },
                        activities:
                          event.type === 'activity'
                            ? mergeActivityLog(message.activities, event.activity)
                            : message.activities,
                      }
                    : message,
                ),
              }));
            if (event.type === 'sources')
              update((state) => ({
                messages: state.messages.map((message) =>
                  message.id === id ? { ...message, sources: event.sources } : message,
                ),
              }));
            if (event.type === 'provider')
              update((state) => ({
                messages: state.messages.map((message) =>
                  message.id === id ? { ...message, provider: event.provider } : message,
                ),
              }));
          },
          current.signal,
        );
        current.signal.throwIfAborted();
        update((state) => ({
          error: result.warning ?? null,
          messages: state.messages.map((message) =>
            message.id === id
              ? {
                  ...message,
                  changes: validateChanges(result.profileChanges ?? {}),
                  profilePreview: undefined,
                  // Fast JSON responses can resolve before queued IPC deltas arrive.
                  content: result.answerText ?? message.content,
                  provider: result.provider ?? message.provider,
                  reasoningSummary: result.reasoningSummary ?? message.reasoningSummary,
                  activities: result.activities ?? message.activities,
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
              update((state) => ({
                messages: state.messages.map((message) =>
                  message.id === id ? { ...message, content: message.content + chunk } : message,
                ),
              }));
          },
          current.signal,
          options,
        );
        if (!current.signal.aborted)
          update((state) => ({
            messages: state.messages.map((message) =>
              message.id === id ? { ...message, status: 'completed' } : message,
            ),
          }));
      }
    } catch (error) {
      const stopped = current.signal.aborted;
      const partial = !stopped && error instanceof ChatRequestError ? error.partial : undefined;
      const messageError = stopped
        ? undefined
        : error instanceof Error
          ? error.message
          : '回复失败，请重试。';
      if (!stopped)
        update({ error: error instanceof Error ? error.message : '回复失败，请重试。' });
      update((state) => ({
        messages: state.messages.map((message) =>
          message.id === id
            ? {
                ...message,
                ...(partial?.answerText !== undefined ? { content: partial.answerText } : {}),
                ...(partial?.reasoningSummary !== undefined
                  ? { reasoningSummary: partial.reasoningSummary }
                  : {}),
                ...(partial?.profilePreview !== undefined
                  ? { profilePreview: partial.profilePreview }
                  : {}),
                ...(partial?.sources !== undefined ? { sources: partial.sources } : {}),
                ...(partial?.activities !== undefined ? { activities: partial.activities } : {}),
                ...(partial?.activity !== undefined ? { activity: partial.activity } : {}),
                status: stopped ? 'stopped' : 'failed',
                error: messageError,
                errorCode:
                  !stopped && error instanceof ChatRequestError ? error.failure.code : undefined,
              }
            : message,
        ),
      }));
    } finally {
      if (controller === current) update({ streaming: false });
      if (connection.live) void useChatConnection.getState().refreshUsage();
    }
  },
  stop() {
    controller?.abort();
    const mark = (messages: ChatMessage[]) =>
      messages.map((message) =>
        message.status === 'streaming'
          ? {
              ...message,
              status: 'stopped' as const,
              ...(message.startedAt !== undefined
                ? { durationMs: Math.max(0, Date.now() - message.startedAt) }
                : {}),
            }
          : message,
      );
    set((state) => ({
      streaming: false,
      messages:
        state.activeConversation === controllerConversation ? mark(state.messages) : state.messages,
      conversations: state.conversations.map((c) =>
        c.id === controllerConversation ? { ...c, messages: mark(c.messages) } : c,
      ),
    }));
  },
  reset(preserveReply = false) {
    if (!preserveReply) get().stop();
    set((state) => ({
      ...(!state.activeConversation &&
      preserveReply &&
      (state.draft.trim() || state.attachments.length)
        ? {
            conversations: [
              ...state.conversations,
              {
                id: crypto.randomUUID(),
                title: state.draft.trim().slice(0, 36) || state.attachments[0].name,
                messages: [],
                draft: state.draft,
                attachments: state.attachments,
              },
            ],
          }
        : {}),
      activeConversation: null,
      messages: [],
      draft: '',
      attachments: [],
      error: null,
    }));
  },
  async removeResume() {
    const doc = get().resume;
    if (!doc) return false;
    try {
      await localKnowledge.deleteDocument(doc.id);
      set({ resume: null, error: null });
      return true;
    } catch {
      set({ error: '移除简历失败，请重试。' });
      return false;
    }
  },
}));
// Keep the active conversation snapshot in sync without duplicating File objects.
usePreparation.subscribe((state, previous) => {
  if (
    state.activeConversation &&
    (state.messages !== previous.messages ||
      state.draft !== previous.draft ||
      state.attachments !== previous.attachments)
  ) {
    usePreparation.setState({
      conversations: state.conversations.map((item) =>
        item.id === state.activeConversation
          ? {
              ...item,
              messages: state.messages,
              draft: state.draft,
              attachments: state.attachments,
            }
          : item,
      ),
    });
    return;
  }
  if (
    state.chatsReady &&
    previous.chatsReady &&
    (state.conversations !== previous.conversations ||
      state.activeConversation !== previous.activeConversation ||
      state.draft !== previous.draft ||
      state.attachments !== previous.attachments ||
      state.modelId !== previous.modelId ||
      state.effort !== previous.effort ||
      state.skillsNeedUpdate !== previous.skillsNeedUpdate ||
      state.webSearch !== previous.webSearch)
  )
    queueChats(state);
});

function queueChats(state: PreparationState) {
  pendingChats = {
    conversations: state.conversations,
    activeConversation: state.activeConversation,
    draft: state.draft,
    attachments: state.attachments,
    modelId: state.modelId,
    effort: state.effort,
    webSearch: state.webSearch,
    skillsNeedUpdate: state.skillsNeedUpdate,
  };
  if (savingChats) return;
  savingChats = (async () => {
    while (pendingChats) {
      const snapshot = pendingChats;
      pendingChats = undefined;
      try {
        await localChats.write(snapshot);
        usePreparation.setState({ chatStorageError: null });
      } catch (error) {
        pendingChats = undefined;
        usePreparation.setState({
          chatStorageError: error instanceof Error ? error.message : '聊天保存失败，请重试。',
        });
      }
    }
  })().finally(() => {
    savingChats = undefined;
    if (pendingChats) queueChats(usePreparation.getState());
  });
}
