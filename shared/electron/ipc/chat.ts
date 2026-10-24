import type { AIChatService } from '../backend/chat/ports';
import { publicFailure } from '../backend/chat/errors';
import { validSource, validateRequest } from '../backend/chat/validation';
import {
  emptyUsage,
  type ChatRequest,
  type ChatResult,
  type ChatPartialResponse,
} from '../contracts/chat';
import { mergeActivityLog } from '../contracts/activity';
import { handleDesktop, sendDesktop } from './handle';

interface Dependencies {
  chat: AIChatService;
  requireMain(event: Electron.IpcMainInvokeEvent): void;
  isDemo(): boolean;
  openLink(url: string): Promise<void>;
}
// IPC owns sender checks and the single active native chat request. Business
// orchestration has no Electron dependency and can be tested independently.
export function registerChatIpc(dependencies: Dependencies) {
  const { chat } = dependencies;
  const requireMain = (event: Electron.IpcMainInvokeEvent) => {
    dependencies.requireMain(event);
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame)
      throw Error('Unauthorized frame');
  };
  let activeChat: { id: string; controller: AbortController } | undefined;
  let pendingChats = 0;
  const cancelActive = () => {
    const previous = activeChat;
    activeChat = undefined;
    previous?.controller.abort();
  };
  handleDesktop('chat:models', async (event, force: unknown) => {
    requireMain(event);
    if (dependencies.isDemo()) return { ok: true, models: [] };
    try {
      return { ok: true, models: await chat.models(force === true) };
    } catch (error) {
      return { ok: false, error: publicFailure(error) };
    }
  });
  handleDesktop('chat:usage', async (event) => {
    requireMain(event);
    if (dependencies.isDemo()) return { ok: true, usage: emptyUsage() };
    try {
      return { ok: true, usage: await chat.usage() };
    } catch (error) {
      return { ok: false, error: publicFailure(error) };
    }
  });
  handleDesktop('chat:account-usage', async (event, ...args) => {
    requireMain(event);
    if (args.length) throw Error('Invalid request');
    if (dependencies.isDemo()) return { ok: true, usage: null };
    try {
      return { ok: true, usage: (await chat.accountUsage?.()) ?? null };
    } catch (error) {
      return { ok: false, error: publicFailure(error) };
    }
  });
  handleDesktop('chat:usage-reset', async (event) => {
    requireMain(event);
    if (dependencies.isDemo()) return { ok: true, usage: emptyUsage() };
    if (activeChat)
      return { ok: false, error: { message: '请等待当前回答完成或停止后重置用量。' } };
    try {
      return { ok: true, usage: await chat.resetUsage() };
    } catch (error) {
      return { ok: false, error: publicFailure(error) };
    }
  });
  handleDesktop('chat:send', async (event, request: unknown): Promise<ChatResult> => {
    requireMain(event);
    if (dependencies.isDemo())
      return { ok: false, error: { message: '请先登录模型服务后调用真实模型。' } };
    if (activeChat) return { ok: false, error: { message: '请等待当前回答完成或停止后重试。' } };
    const controller = new AbortController();
    const active = { id: (request as ChatRequest)?.id, controller };
    activeChat = active;
    pendingChats++;
    const partial: ChatPartialResponse = {};
    try {
      controller.signal.throwIfAborted();
      const result = await chat.stream(
        validateRequest(request),
        (value) => {
          if (activeChat === active && !controller.signal.aborted && !event.sender.isDestroyed()) {
            if (value.type === 'delta')
              partial.answerText = ((partial.answerText ?? '') + value.text).slice(0, 1000000);
            if (value.type === 'reasoning-summary')
              partial.reasoningSummary = value.text.slice(0, 100000);
            if (value.type === 'profile-preview') partial.profilePreview = value.preview;
            if (value.type === 'sources') partial.sources = value.sources;
            if (value.type === 'activity') {
              partial.activity = value.activity;
              partial.activities = mergeActivityLog(partial.activities, value.activity);
            }
            sendDesktop(event.sender, 'chat:event', value);
          }
        },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      if (event.sender.isDestroyed()) throw new DOMException('Aborted', 'AbortError');
      return { ok: true, ...result };
    } catch (error) {
      return {
        ok: false,
        error: publicFailure(error),
        ...(Object.keys(partial).length ? { partial } : {}),
      };
    } finally {
      pendingChats--;
      if (activeChat === active) activeChat = undefined;
    }
  });
  handleDesktop('chat:cancel', (event, id: unknown) => {
    requireMain(event);
    if (typeof id === 'string' && activeChat?.id === id) cancelActive();
  });
  handleDesktop('chat:open-link', async (event, value: unknown) => {
    requireMain(event);
    const source = validSource({ url: value });
    if (!source) throw new Error('无效的链接。');
    await dependencies.openLink(source.url);
  });
  return { cancelActive, isBusy: () => pendingChats > 0 };
}
