import type { AIChatService } from '../backend/chat/ports';
import { publicFailure } from '../backend/chat/errors';
import { batchChatEvents } from '../backend/chat/events';
import { validSource, validateRequest } from '../backend/chat/validation';
import {
  emptyUsage,
  type ChatRequest,
  type ChatResult,
  type ChatPartialResponse,
} from '../contracts/chat';
import { mergeActivityLog } from '../contracts/activity';
import { handleDesktop, sendDesktop } from './handle';
import type { Telemetry } from '../backend/telemetry/service';

interface Dependencies {
  chat: AIChatService;
  requireMain(event: Electron.IpcMainInvokeEvent): void;
  isDemo(): boolean;
  openLink(url: string): Promise<void>;
  telemetry?: Pick<Telemetry, 'activity' | 'answer'>;
}
// IPC owns sender checks and the lifetime of each native chat request. Business
// orchestration has no Electron dependency and can be tested independently.
export function registerChatIpc(dependencies: Dependencies) {
  const { chat } = dependencies;
  const requireMain = (event: Electron.IpcMainInvokeEvent) => {
    dependencies.requireMain(event);
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame)
      throw Error('Unauthorized frame');
  };
  const activeChats = new Map<
    string, { sender: Electron.WebContents; controller: AbortController }
  >();
  let resettingUsage = false;
  let catalogRequests = new AbortController();
  const cancelActive = () => {
    for (const { controller } of activeChats.values()) controller.abort();
  };
  const cancelModels = () => {
    catalogRequests.abort();
    catalogRequests = new AbortController();
  };
  handleDesktop('chat:models', async (event, force: unknown = false, ...extra) => {
    requireMain(event);
    if (typeof force !== 'boolean' || extra.length) throw Error('Invalid request');
    if (dependencies.isDemo()) return { ok: true, models: [] };
    try {
      const signal = catalogRequests.signal;
      const models = await chat.models(force, signal);
      signal.throwIfAborted();
      return { ok: true, models };
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
    if (activeChats.size)
      return { ok: false, error: { message: '请等待当前回答完成或停止后重置用量。' } };
    if (resettingUsage) return { ok: false, error: { message: '用量正在重置，请稍后重试。' } };
    resettingUsage = true;
    try {
      return { ok: true, usage: await chat.resetUsage() };
    } catch (error) {
      return { ok: false, error: publicFailure(error) };
    } finally {
      resettingUsage = false;
    }
  });
  handleDesktop('chat:send', async (event, request: unknown): Promise<ChatResult> => {
    requireMain(event);
    if (dependencies.isDemo())
      return { ok: false, error: { message: '请先登录模型服务后调用真实模型。' } };
    let validated: ChatRequest;
    try {
      validated = validateRequest(request);
    } catch (error) {
      return { ok: false, error: publicFailure(error) };
    }
    if (resettingUsage) return { ok: false, error: { message: '用量正在重置，请稍后重试。' } };
    if (activeChats.has(validated.id))
      return { ok: false, error: { message: '此请求已发送，请等待回答完成。' } };
    const controller = new AbortController();
    const active = { sender: event.sender, controller };
    activeChats.set(validated.id, active);
    const current = () => activeChats.get(validated.id) === active && !event.sender.isDestroyed();
    const events = batchChatEvents(
      (value) => sendDesktop(event.sender, 'chat:event', value),
      controller.signal,
      current,
    );
    const partial: ChatPartialResponse = {};
    let metric: ReturnType<Telemetry['answer']> | undefined;
    try {
      controller.signal.throwIfAborted();
      dependencies.telemetry?.activity('chat_send');
      metric = dependencies.telemetry?.answer('chat');
      const result = await chat.stream(
        validated,
        (value) => {
          if (value.id === validated.id && !controller.signal.aborted && current()) {
            if (value.type === 'delta' && value.text.trim()) metric?.first();
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
            events.emit(value);
          }
        },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      if (event.sender.isDestroyed()) throw new DOMException('Aborted', 'AbortError');
      if (result.answerText?.trim()) metric?.first();
      metric?.finish(
        !result.warning && (result.answerText ?? partial.answerText)?.trim()
          ? 'success'
          : 'failure',
      );
      return { ok: true, ...result };
    } catch (error) {
      metric?.finish(controller.signal.aborted ? 'cancelled' : 'failure');
      return {
        ok: false,
        error: publicFailure(error),
        ...(Object.keys(partial).length ? { partial } : {}),
      };
    } finally {
      try {
        events.finish();
      } finally {
        activeChats.delete(validated.id);
      }
    }
  });
  handleDesktop('chat:cancel', (event, id: unknown) => {
    requireMain(event);
    const active = typeof id === 'string' ? activeChats.get(id) : undefined;
    if (active?.sender === event.sender) active.controller.abort();
  });
  handleDesktop('chat:open-link', async (event, value: unknown) => {
    requireMain(event);
    const source = validSource({ url: value });
    if (!source) throw new Error('无效的链接。');
    await dependencies.openLink(source.url);
  });
  return { cancelActive, cancelModels, isBusy: () => activeChats.size > 0 || resettingUsage };
}
