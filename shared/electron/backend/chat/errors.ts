import type { ChatFailure } from '../../contracts/chat';
export class ChatServiceError extends Error {
  constructor(public detail: ChatFailure) {
    super(detail.message);
  }
}
export function invalidatesModelCatalog(error: unknown) {
  if (!(error instanceof ChatServiceError)) return false;
  const { status, code } = error.detail;
  return status === 401 || status === 403 || status === 404 || code === 'model_not_found' || code === 'API_KEY_INVALID';
}
export function networkFailure(error: unknown): unknown {
  if (error instanceof Error && error.name === 'TimeoutError')
    return new ChatServiceError({
      code: 'response_headers_timeout',
      message: '等待模型服务响应超时，请稍后重试。',
    });
  if (error instanceof TypeError && !(error instanceof ChatServiceError))
    return new ChatServiceError({
      code: 'network_error',
      message: '模型服务连接中断，请稍后重试。',
    });
  return error;
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
    (status === 400 && param === 'reasoning.effort'
      ? '当前模型未接受所选思考强度，请选择自动或其他档位后重试；也可刷新模型列表。'
      : undefined) ||
    (status === 401
      ? 'ChatGPT 授权未被接受，请退出后重新登录。'
      : status === 403
        ? '账户权限、工作区或服务地区策略不允许此次请求。'
        : status === 404 || code === 'model_not_found'
          ? '所选模型当前不可用，请刷新模型列表。'
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
  if (error instanceof Error && error.name === 'TimeoutError')
    return { message: '等待模型服务超时，请稍后重试。', code: 'request_timeout' };
  if (error instanceof Error && /[\u4e00-\u9fff]/.test(error.message))
    return { message: error.message };
  return { message: '连接中断或请求失败，请检查网络后重试。' };
}
