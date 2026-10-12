import type {
  ChatRequest,
  ChatEvent,
  ChatResult,
  ChatFailure,
} from '../../electron/contracts/chat';
export function failureText(error: ChatFailure) {
  return [
    error.message,
    error.status ? `HTTP ${error.status}` : '',
    error.code,
    error.param ? `参数：${error.param}` : '',
    error.requestId ? `请求：${error.requestId}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
export async function streamChat(
  request: ChatRequest,
  onEvent: (event: ChatEvent) => void,
  signal: AbortSignal,
): Promise<Extract<ChatResult, { ok: true }>> {
  const desktop = window.desktop;
  if (!desktop) throw new Error('真实聊天需要在桌面应用中使用。');
  signal.throwIfAborted();
  const unsubscribe = desktop.onChatEvent((event) => {
    if (event.id === request.id && !signal.aborted) onEvent(event);
  });
  const cancel = () => {
    void desktop.chatCancel(request.id).catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const result = await desktop.chatSend(request);
    signal.throwIfAborted();
    if (!result.ok) throw new Error(failureText(result.error));
    return result;
  } finally {
    unsubscribe();
    signal.removeEventListener('abort', cancel);
  }
}
export async function openChatLink(url: string) {
  if (window.desktop) await window.desktop.chatOpenLink(url);
}
