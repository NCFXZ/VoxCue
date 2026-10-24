import { ChatServiceError } from '../chat/errors';
import type { ChatFailure } from '../../contracts/chat';

/** Only application-authored messages and bounded diagnostic IDs cross the boundary. */
export class CopilotError extends ChatServiceError {
  constructor(message: string, detail: Omit<ChatFailure, 'message'> = {}) {
    super({ ...detail, message });
  }
}
const identifier = (v: unknown) =>
  typeof v === 'string' && /^[\w.:[\]-]{1,160}$/.test(v) ? v : undefined;
export function copilotFailure(data: {
  errorType?: string;
  errorCode?: string;
  statusCode?: number;
  providerErrorParam?: string;
  providerCallId?: string;
}) {
  const category = data.errorType;
  const fixed = {
    authentication: [401, 'Copilot 授权无效，请重新登录。'],
    authorization: [403, 'Copilot 账户权限不允许此次请求。'],
    policy: [403, 'Copilot 组织策略不允许此次请求。'],
    quota: [429, 'Copilot 账户额度已达到限制，请查看官方用量。'],
    rate_limit: [429, 'Copilot 请求受到使用限制，请稍后重试或查看官方用量。'],
    context_limit: [400, '本次 Copilot 上下文超过限制，请减少内容。'],
    query: [undefined, 'Copilot 未接受此次请求，请检查模型与输入。'],
  } as const;
  const known = fixed[category as keyof typeof fixed];
  return new CopilotError(known?.[1] ?? 'GitHub Copilot 请求失败，请检查网络或稍后重试。', {
    status:
      (Number.isInteger(data.statusCode) && data.statusCode! >= 400 && data.statusCode! <= 599
        ? data.statusCode
        : undefined) ?? known?.[0],
    code:
      (category === 'query' ? identifier(data.errorCode) : undefined) ??
      (known
        ? `copilot_${category}`
        : category === 'network'
          ? 'network_error'
          : identifier(data.errorCode)),
    param: identifier(data.providerErrorParam),
    requestId: identifier(data.providerCallId),
  });
}
