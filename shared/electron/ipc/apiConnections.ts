import {
  isApiProvider,
  parseApiConnectionConfig,
  type ApiKeyField,
  type ApiKeyPromptCommand,
  type ApiProvider,
} from '../contracts/apiConnections';
import type { ProfileApiConnections } from '../application/apiConnections';
import { publicFailure } from '../backend/chat/errors';
import { handleDesktop, sendDesktop } from './handle';

const consoles: Record<ApiProvider, { keys: string; billing: string }> = {
  openai: {
    keys: 'https://platform.openai.com/api-keys',
    billing: 'https://platform.openai.com/settings/organization/billing/overview',
  },
  anthropic: {
    keys: 'https://platform.claude.com/settings/keys',
    billing: 'https://platform.claude.com/settings/billing',
  },
  gemini: {
    keys: 'https://aistudio.google.com/api-keys',
    billing: 'https://aistudio.google.com/billing',
  },
  qwen: {
    keys: 'https://help.aliyun.com/zh/model-studio/get-api-key',
    billing: 'https://help.aliyun.com/zh/model-studio/bill-query-and-cost-management',
  },
  deepseek: {
    keys: 'https://platform.deepseek.com/api_keys',
    billing: 'https://platform.deepseek.com/usage',
  },
  kimi: {
    keys: 'https://platform.kimi.com/console/api-keys',
    billing: 'https://platform.kimi.com/console/fee-detail',
  },
  glm: {
    keys: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    billing: 'https://open.bigmodel.cn/finance/expensebill/list?active=detail',
  },
  doubao: {
    keys: 'https://ark.volcengine.com/region:cn-beijing/apiKey?apikey=%7B%7D',
    billing: 'https://console.volcengine.com/finance/bill/detail',
  },
};
function fieldBounds(value: unknown): ApiKeyField {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 5)
    throw Error('Invalid input field');
  const { x, y, width, height, dark } = value as ApiKeyField;
  const bounded = (n: number, min: number, max: number) =>
    Number.isFinite(n) && n >= min && n <= max;
  if (
    !bounded(x, 0, 32768) ||
    !bounded(y, 0, 32768) ||
    !bounded(width, 1, 1024) ||
    !bounded(height, 1, 128) ||
    typeof dark !== 'boolean'
  )
    throw Error('Invalid input field');
  return { x, y, width, height, dark };
}
function promptCommand(value: unknown): ApiKeyPromptCommand {
  if (!value || typeof value !== 'object') throw Error('Invalid input action');
  const keys = Object.keys(value);
  const command = value as ApiKeyPromptCommand;
  if (keys.length === 2 && command.action === 'layout')
    return { action: 'layout', field: fieldBounds(command.field) };
  if (keys.length === 2 && command.action === 'visibility' && typeof command.visible === 'boolean')
    return { action: 'visibility', visible: command.visible };
  if (keys.length === 1 && ['focus', 'submit', 'cancel'].includes(command.action)) return command;
  throw Error('Invalid input action');
}
function requestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value))
    throw Error('Invalid input request');
  return value;
}
export function registerApiConnectionIpc(ports: {
  requireMain(event: Electron.IpcMainInvokeEvent): void;
  current(): Pick<ProfileApiConnections, 'list' | 'configure' | 'remove' | 'balance'>;
  checkChange(provider: ApiProvider, remove: boolean): void;
  prompt(
    provider: ApiProvider,
    signal: AbortSignal,
    field: ApiKeyField,
    tab: (backwards: boolean) => void,
  ): Promise<string | null>;
  control(command: ApiKeyPromptCommand): Promise<void> | void;
  open(url: string): Promise<void>;
}) {
  let active:
    | {
        id: string;
        sender: Electron.WebContents;
        api: ReturnType<typeof ports.current>;
        controller: AbortController;
      }
    | undefined;
  function context(event: Electron.IpcMainInvokeEvent, extra: unknown[]) {
    ports.requireMain(event);
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || extra.length)
      throw Error('Invalid API connection request');
    return ports.current();
  }
  function provider(value: unknown) {
    if (!isApiProvider(value)) throw Error('Invalid API provider');
    return value;
  }
  const failed = (error: unknown): never => {
    throw Error(publicFailure(error).message);
  };
  handleDesktop('api-keys:list', (event, ...extra) => context(event, extra).list().catch(failed));
  handleDesktop('api-keys:configure', async (event, value, token, bounds, ...extra) => {
    const api = context(event, extra);
    const config = parseApiConnectionConfig(value);
    const id = requestId(token);
    const field = fieldBounds(bounds);
    if (active) throw Error('API 密钥操作正在进行。');
    const check = () => {
      if (context(event, []) !== api) throw Error('账号已变化，请重新操作。');
      ports.checkChange(config.provider, false);
    };
    check();
    const controller = new AbortController();
    active = { id, sender: event.sender, api, controller };
    const cancel = () => controller.abort();
    const tab = (backwards: boolean) => {
      if (!controller.signal.aborted && active?.controller === controller)
        sendDesktop(event.sender, 'api-keys:tab', id, backwards);
    };
    event.sender.once('destroyed', cancel);
    event.sender.once('did-start-loading', cancel);
    try {
      return await api.configure(
        config,
        (signal) => ports.prompt(config.provider, signal, field, tab),
        check,
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) return false;
      return failed(error);
    } finally {
      if (active?.controller === controller) active = undefined;
      event.sender.off('destroyed', cancel);
      event.sender.off('did-start-loading', cancel);
    }
  });
  handleDesktop('api-keys:control', (event, token, value, ...extra) => {
    const api = context(event, extra);
    const id = requestId(token);
    const command = promptCommand(value);
    if (!active || active.id !== id || active.sender !== event.sender || active.api !== api) return;
    if (command.action === 'cancel') active.controller.abort();
    else if (!active.controller.signal.aborted) return ports.control(command);
  });
  handleDesktop('api-keys:remove', (event, value, ...extra) => {
    const api = context(event, extra);
    const id = provider(value);
    ports.checkChange(id, true);
    return api.remove(id).catch(failed);
  });
  handleDesktop('api-keys:balance', (event, value, ...extra) =>
    context(event, extra).balance(provider(value)).catch(failed),
  );
  handleDesktop('api-keys:open', (event, value, destination, ...extra) => {
    context(event, extra);
    if (destination !== 'keys' && destination !== 'billing') throw Error('Invalid API link');
    return ports.open(consoles[provider(value)][destination]);
  });
}
