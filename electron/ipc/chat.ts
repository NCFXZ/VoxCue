import type { AIChatService } from '../backend/chat/ports';
import { publicFailure } from '../backend/chat/errors';
import { validSource, validateRequest } from '../backend/chat/validation';
import { emptyUsage, type ChatRequest, type ChatResult } from '../contracts/chat';
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
  const { chat, requireMain } = dependencies;
  let activeChat: { id: string; controller: AbortController } | undefined;
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
      return { ok: false, error: { message: '请使用 ChatGPT 登录后调用真实模型。' } };
    if (activeChat) return { ok: false, error: { message: '请等待当前回答完成或停止后重试。' } };
    const controller = new AbortController();
    const active = { id: (request as ChatRequest)?.id, controller };
    activeChat = active;
    try {
      controller.signal.throwIfAborted();
      const result = await chat.stream(
        validateRequest(request),
        (value) => {
          if (!controller.signal.aborted && !event.sender.isDestroyed())
            sendDesktop(event.sender, 'chat:event', value);
        },
        controller.signal,
      );
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: publicFailure(error) };
    } finally {
      if (activeChat === active) activeChat = undefined;
    }
  });
  handleDesktop('chat:cancel', (event, id: unknown) => {
    requireMain(event);
    if (typeof id === 'string' && activeChat?.id === id) activeChat.controller.abort();
  });
  handleDesktop('chat:open-link', async (event, value: unknown) => {
    requireMain(event);
    const source = validSource({ url: value });
    if (!source) throw new Error('无效的链接。');
    await dependencies.openLink(source.url);
  });
  return { cancelActive: () => activeChat?.controller.abort() };
}
