import { createHash } from 'node:crypto';
import { apiProviders, type ApiBalance, type ApiProvider } from '../../contracts/apiConnections';
import type { ChatEvent, ModelProvider } from '../../contracts/chat';
import { abortable } from '../cancellable';
import { boundedJson } from '../boundedJson';
import { ChatGPTService } from '../chat/service';
import { ChatServiceError, invalidatesModelCatalog } from '../chat/errors';
import { ModelCatalog } from '../chat/modelCatalog';
import { modelId, record } from '../chat/models';
import type { AIChatService } from '../chat/ports';
import { readErrorResponse, requestResponse } from '../chat/responses';
import { validateRequest } from '../chat/validation';
import type { UsageLedger } from '../chat/usage';
import { claude, claudeHeaders, claudeModels, compatibleApis } from './catalogs';
import { chineseProviders } from './chineseProviders';
import { messagesBody, receiveMessages } from './messages';
import type { ApiCredential, ApiModel, CatalogGet, CompatibleApi } from './types';

export type { ApiCredential } from './types';
const adapters: Record<Exclude<ApiProvider, 'openai' | 'anthropic'>, CompatibleApi> = {
  ...compatibleApis,
  ...chineseProviders,
};
type ApiService = AIChatService & { invalidateModels(): void };

function accountOf(provider: ApiProvider, credential: ApiCredential) {
  return (
    provider +
    ':' +
    createHash('sha256')
      .update(JSON.stringify([credential.key, credential.region ?? '', credential.workspace ?? '']))
      .digest('hex')
  );
}
function identity(provider: ApiProvider): ModelProvider {
  return {
    id: provider,
    name: apiProviders[provider].name,
    dataRecipient: apiProviders[provider].recipient,
  };
}
function apiFailure(status?: number) {
  const message =
    status === 401
      ? 'API 密钥未被接受，请检查密钥与所选地域或工作区。'
      : status === 402
        ? 'API 账户可用余额不足，请查看服务商账单。'
        : status === 403
          ? 'API 账户无权访问该服务，请检查权限、地域与套餐。'
          : status === 404
            ? '所选 API 模型或端点不可用，请检查配置并刷新模型列表。'
            : status === 429
              ? 'API 服务已达到调用限额，请查看服务商用量或稍后重试。'
              : status === 400
                ? 'API 服务未接受请求，请检查模型、输入及思考设置。'
                : 'API 服务暂时不可用，请稍后重试。';
  return new ChatServiceError({ message, status });
}

// Both HTTP failures and Responses stream errors can carry the same OpenAI code.
// Expose only recognized diagnostics; an upstream message may contain input or credentials.
function openAIFailure(status: number | undefined, body: unknown) {
  const payload = record(body);
  const error = record(payload?.error) ?? payload;
  const code = error?.code;
  if (typeof code === 'string') {
    let message: string | undefined;
    switch (code) {
      case 'credit_balance_exhausted': message = apiFailure(402).message; break;
      case 'rate_limit_exceeded': message = apiFailure(429).message; break;
      case 'model_not_found': message = apiFailure(404).message; break;
      case 'insufficient_quota':
      case 'api_key_spend_limit_exceeded':
      case 'project_spend_limit_exceeded':
      case 'organization_spend_limit_exceeded':
      case 'organization_usage_limit_exceeded':
      case 'usage_limit_exceeded':
        message = 'API 账户已达到支出或用量上限，请查看服务商账单。';
        break;
    }
    if (message) return new ChatServiceError({ status, code, message });
  }
  return apiFailure(status);
}

async function checkApiResponse(response: Response, signal: AbortSignal, failure?: CompatibleApi['failure']) {
  if (response.ok) return;
  if (failure) {
    const detail = failure(response.status, await readErrorResponse(response, signal));
    if (detail) throw detail;
  } else {
    void response.body?.cancel().catch(() => {});
  }
  throw apiFailure(response.status);
}

function getJson(
  credential: ApiCredential,
  fetcher: typeof fetch,
  signal: AbortSignal,
  failure?: CompatibleApi['failure'],
): CatalogGet {
  return async (url, extra = {}) => {
    signal.throwIfAborted();
    const response = await requestResponse(
      fetcher,
      url,
      {
        headers: {
          ...(extra['x-goog-api-key'] ? {} : { authorization: 'Bearer ' + credential.key }),
          ...extra,
        },
        cache: 'no-store',
        redirect: 'error',
      },
      signal,
    );
    await checkApiResponse(response, signal, failure);
    try {
      return await boundedJson(response, 4 * 1024 * 1024, signal);
    } catch {
      signal.throwIfAborted();
      throw Error('API 服务返回的数据格式无效或过大。');
    }
  };
}

export async function readApiBalance(
  provider: ApiProvider,
  credential: ApiCredential,
  signal = new AbortController().signal,
  fetcher: typeof fetch = fetch,
): Promise<ApiBalance[]> {
  const adapter =
    provider === 'openai' || provider === 'anthropic' ? undefined : adapters[provider];
  if (!adapter?.balance) return [];
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  return adapter.balance(credential, getJson(credential, fetcher, deadline));
}

export function createApiChatService(
  provider: ApiProvider,
  credential: () => Promise<ApiCredential>,
  ledger: UsageLedger,
  fetcher: typeof fetch = fetch,
): ApiService {
  const owner = identity(provider);
  if (provider === 'openai') {
    return new ChatGPTService({
      provider: owner,
      ledger,
      fetch: fetcher,
      failure: openAIFailure,
      access: async () => {
        const secret = await credential();
        return { kind: 'api-key', token: secret.key, account: accountOf(provider, secret) };
      },
    });
  }
  const adapter = provider === 'anthropic' ? undefined : adapters[provider];
  const catalog = new ModelCatalog<ApiModel>();
  const account = async () => accountOf(provider, await credential());
  const readModels = (secret: ApiCredential, force: boolean, signal: AbortSignal) => {
    const expected = accountOf(provider, secret);
    return catalog.read(expected, force, signal, async (deadline) => {
      const get = getJson(secret, fetcher, deadline, adapter?.failure);
      const result = adapter ? await adapter.models(secret, get) : await claudeModels(secret, get);
      if ((await abortable(account(), deadline)) !== expected)
        throw Error('API 连接已更改，请重新选择模型。');
      const distinct = new Map<string, ApiModel>();
      for (const model of result)
        if (modelId(model.id) && !distinct.has(model.id))
          distinct.set(model.id, { ...model, provider: owner });
      return [...distinct.values()];
    });
  };
  return {
    invalidateModels: () => catalog.clear(),
    async models(force = false, caller?: AbortSignal) {
      const signal = catalog.signal(caller);
      signal.throwIfAborted();
      const secret = await abortable(
        credential(),
        AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      );
      return readModels(secret, force, signal);
    },
    usage: async () => ledger.get(await account()),
    resetUsage: async () => ledger.reset(await account()),
    async stream(value, emit: (event: ChatEvent) => void, caller: AbortSignal) {
      const request = validateRequest(value);
      const signal = catalog.signal(caller);
      signal.throwIfAborted();
      try {
        const secret = await abortable(
          credential(),
          AbortSignal.any([signal, AbortSignal.timeout(20000)]),
        );
        const models = await readModels(secret, false, signal);
        const model = models.find((entry) => entry.id === request.modelId);
        if (!model) throw Error('所选 API 模型当前不可用，请刷新模型列表。');
        if (request.effort && !model.reasoningEfforts?.includes(request.effort))
          throw Error('所选模型不支持该思考强度，请选择自动或刷新模型列表。');
        const body = await messagesBody(request, model, adapter, signal);
        signal.throwIfAborted();
        emit({ id: request.id, type: 'provider', provider: owner });
        const response = await requestResponse(
          fetcher,
          adapter ? adapter.endpoint(secret) : claude + '/messages',
          {
            method: 'POST',
            redirect: 'error',
            cache: 'no-store',
            headers: {
              authorization: 'Bearer ' + secret.key,
              'content-type': 'application/json',
              accept: 'text/event-stream',
              ...(adapter ? {} : claudeHeaders(secret)),
            },
            body,
          },
          signal,
        );
        await checkApiResponse(response, signal, adapter?.failure);
        const result = await receiveMessages(
          response,
          request,
          !adapter,
          emit,
          signal,
          (id, tokens) => ledger.add(accountOf(provider, secret), id, tokens),
        );
        signal.throwIfAborted();
        return { ...result, provider: owner };
      } catch (error) {
        if (!signal.aborted && invalidatesModelCatalog(error)) catalog.expire();
        throw error;
      }
    },
  };
}
