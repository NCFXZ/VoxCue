import { ChatServiceError } from '../backend/chat/errors';

// Deliberate allow-list. Unknown errors, configuration failures and limits never
// become retryable by matching an untrusted message.
export function retryableChatError(error: unknown): boolean {
  if (!(error instanceof ChatServiceError)) return false;
  const { status, code, param } = error.detail;
  if (param || (status !== undefined && ![502, 503, 504].includes(status))) return false;
  if (
    code &&
    /quota|limit|auth|permission|invalid|unsupported|model|configuration|integrity/i.test(code)
  )
    return false;
  return (
    status !== undefined ||
    [
      'network_error',
      'connection_closed',
      'empty_response',
      'response_headers_timeout',
      'response_idle_timeout',
    ].includes(code ?? '')
  );
}
