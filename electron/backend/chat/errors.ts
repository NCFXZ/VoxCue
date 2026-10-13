import type { ChatFailure } from '../../contracts/chat';
const messages: Record<string, string> = {
  subscription_sharing_user_not_eligible: '当前账户或工作区不支持 ChatGPT 套餐调用。',
  subscription_sharing_usage_limit_exceeded:
    '已达到当前应用或账户的使用限制，请查看 ChatGPT 账户用量。',
  subscription_sharing_usage_unavailable: '暂时无法检查账户用量，请稍后重试。',
  subscription_sharing_unsupported_capability:
    '当前模型或账户不支持这次请求的功能，请关闭网络搜索或更换模型后重试。',
  subscription_sharing_route_not_supported: '当前账户不支持该接口，请检查 ChatGPT 授权。',
  subscription_sharing_invalid_user: 'ChatGPT 授权无效，请退出后重新登录。',
};
export class ChatServiceError extends Error {
  constructor(public detail: ChatFailure) {
    super(detail.message);
  }
}
function diagnostic(value: unknown) {
  return typeof value === 'string' && /^[\w.:[\]-]{1,160}$/.test(value) ? value : undefined;
}
export function apiError(
  status: number | undefined,
  body: any,
  requestId?: string,
): ChatServiceError {
  const value = body?.error ?? body ?? {};
  const code = diagnostic(value.code),
    param = diagnostic(value.param);
  const message =
    (code && messages[code]) ||
    (status === 401
      ? 'ChatGPT 授权未被接受，请退出后重新登录。'
      : status === 403
        ? '账户权限、工作区或服务地区策略不允许此次请求。'
        : status === 429
          ? '请求受到使用限制，请稍后重试或查看账户用量。'
          : status === 400
            ? '模型不支持当前输入或工具，请更换模型或调整附件与搜索选项。'
            : 'ChatGPT 服务暂时不可用，请稍后重试。');
  // Never forward raw remote messages: they can contain user input or credentials.
  return new ChatServiceError({ message, code, param, status, requestId: diagnostic(requestId) });
}
export function publicFailure(error: unknown): ChatFailure {
  if (error instanceof ChatServiceError) return error.detail;
  if (error instanceof Error && error.name === 'AbortError')
    return { message: '回答已停止。', code: 'cancelled' };
  if (error instanceof Error && /[\u4e00-\u9fff]/.test(error.message))
    return { message: error.message };
  return { message: '连接中断或请求失败，请检查网络后重试。' };
}
