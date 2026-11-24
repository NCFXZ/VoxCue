import { createHash } from 'node:crypto';
import { apiProviders, type ApiBalance, type ApiProvider } from '../../contracts/apiConnections';
import type { ChatEvent, ModelProvider } from '../../contracts/chat';
import { abortable } from '../cancellable';
import { boundedJson } from '../boundedJson';
import { ChatGPTService } from '../chat/service';
import { ChatServiceError, invalidatesModelCatalog } from '../chat/errors';
import { ModelCatalog } from '../chat/modelCatalog';
import { modelId, record } from '../chat/models';
import { requestResponse } from '../chat/responses';
import { recoverApiProfileOutput } from '../chat/profileRecovery';
import { validateRequest } from '../chat/validation';
import type { UsageLedger } from '../chat/usage';
import { deepseekApi } from './catalogs';
import { deepSeekProSearchModel, deepSeekResponsesEvents, prepareDeepSeekResponsesRequest } from './deepseekResponses';
import { deepSeekProfileRecovery, deepSeekStructureRequest } from './deepseekProfile';
import { messagesBody, receiveMessages } from './messages';
import type { ApiChatService, ApiCredential, ApiModel, CatalogGet } from './types';

export type { ApiCredential } from './types';

function accountOf(provider: ApiProvider, credential: ApiCredential) {
  // Keep the existing usage ledger keys for all retained connections.
  return (
    provider +
    ':' +
    createHash('sha256')
      .update(JSON.stringify([credential.key, '', '']))
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
      ? 'API 密钥未被接受，请检查密钥。'
      : status === 402
        ? 'API 账户可用余额不足，请查看服务商账单。'
        : status === 403
          ? 'API 账户无权访问该服务，请检查权限与套餐。'
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

function checkApiResponse(response: Response) {
  if (response.ok) return;
  void response.body?.cancel().catch(() => {});
  throw apiFailure(response.status);
}

function getJson(
  credential: ApiCredential,
  fetcher: typeof fetch,
  signal: AbortSignal,
): CatalogGet {
  return async (url) => {
    signal.throwIfAborted();
    const response = await requestResponse(
      fetcher,
      url,
      {
        headers: { authorization: 'Bearer ' + credential.key },
        cache: 'no-store',
        redirect: 'error',
      },
      signal,
    );
    checkApiResponse(response);
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
  if (provider !== 'deepseek') return [];
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  return deepseekApi.balance(getJson(credential, fetcher, deadline));
}

export function createApiChatService(
  provider: ApiProvider,
  credential: () => Promise<ApiCredential>,
  ledger: UsageLedger,
  fetcher: typeof fetch = fetch,
): ApiChatService {
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
  if (provider !== 'deepseek') throw Error('不支持此 API 服务。');
  const catalog = new ModelCatalog<ApiModel>();
  const account = async () => accountOf(provider, await credential());
  const readModels = (secret: ApiCredential, force: boolean, signal: AbortSignal) => {
    const expected = accountOf(provider, secret);
    return catalog.read(expected, force, signal, async (deadline) => {
      const result = await deepseekApi.models(getJson(secret, fetcher, deadline));
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
        return await recoverApiProfileOutput(request, emit, signal, async (attempt, publish, deadline, recovering) => {
          const searchEnabled = !!attempt.profile && attempt.webSearch;
          const flashSearch = searchEnabled && model.id === 'deepseek-flash';
          const responsesSearch = searchEnabled && model.id === deepSeekProSearchModel &&
            !attempt.turns.some(turn => turn.files?.length);
          const body = await messagesBody(attempt, model, deadline, flashSearch, responsesSearch, recovering);
          deadline.throwIfAborted();
          const deepSeekRequest = responsesSearch ? prepareDeepSeekResponsesRequest(body) : undefined;
          if (responsesSearch && !deepSeekRequest) throw Error('所选模型无法发送此联网请求。');
          publish({ id: attempt.id, type: 'provider', provider: owner });
          const url = deepSeekRequest?.url ?? deepseekApi.endpoint;
          const init: RequestInit = {
            method: 'POST',
            redirect: 'error',
            cache: 'no-store',
            headers: {
              authorization: 'Bearer ' + secret.key,
              'content-type': 'application/json',
              accept: 'text/event-stream',
            },
            body: deepSeekRequest?.body ?? body,
          };
          const response = await requestResponse(fetcher, url, init, deadline);
          checkApiResponse(response);
          // Same model and context without tools: ask only whether the shown answer proposes changes.
          const requestStructure = async (answerText: string) => {
            const followUp = { ...attempt, turns: [...attempt.turns,
              { role: 'assistant' as const, content: answerText },
              { role: 'user' as const, content: deepSeekStructureRequest }] };
            const structureBody = await messagesBody(followUp, model, deadline, false, false, true);
            const structure = await requestResponse(fetcher, deepseekApi.endpoint, { ...init, body: structureBody }, deadline);
            checkApiResponse(structure);
            return structure;
          };
          const result = await receiveMessages(response, attempt, publish, deadline,
            (id, tokens) => ledger.add(accountOf(provider, secret), id, tokens), {
              webSearch: flashSearch || responsesSearch,
              events: deepSeekRequest ? deepSeekResponsesEvents(response, deadline) : undefined,
              requestStructure,
            });
          deadline.throwIfAborted();
          return { ...result, provider: owner };
        }, 'preview', deepSeekProfileRecovery);
      } catch (error) {
        if (!signal.aborted && invalidatesModelCatalog(error)) catalog.expire();
        throw error;
      }
    },
  };
}
