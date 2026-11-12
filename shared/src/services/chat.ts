import type {
  ChatRequest,
  ChatEvent,
  ChatResult,
  ChatFailure,
  ChatPartialResponse,
  ChatTurn,
} from '../../electron/contracts/chat';
import {
  CHAT_TEXT_LIMIT,
  CHAT_TURN_LIMIT,
  CHAT_FILE_LIMIT,
  CHAT_FILE_BYTES_LIMIT,
  CHAT_FILES_BYTES_LIMIT,
} from '../../electron/contracts/chat';

/** Check the complete context before allocating attachment buffers for IPC. */
export async function prepareChatRequest(
  request: Omit<ChatRequest, 'turns'> & {
    turns: Array<Omit<ChatTurn, 'files'> & { files?: Array<{ name: string; file: File }> }>;
  },
  signal: AbortSignal,
): Promise<ChatRequest> {
  signal.throwIfAborted();
  if (!request.turns.length || request.turns.length > CHAT_TURN_LIMIT)
    throw Error('聊天请求无效，请重新开始对话。');
  let bytes = 0,
    text = request.instructions.length,
    files = 0;
  for (const turn of request.turns) {
    text += turn.content.length;
    for (const attachment of turn.files ?? []) {
      if (
        !attachment.name ||
        attachment.name.length > 300 ||
        !attachment.file.size ||
        attachment.file.size > CHAT_FILE_BYTES_LIMIT
      )
        throw Error('附件请求无效或超过 20 MB。');
      bytes += attachment.file.size;
      files++;
    }
  }
  if (text > CHAT_TEXT_LIMIT || bytes > CHAT_FILES_BYTES_LIMIT || files > CHAT_FILE_LIMIT)
    throw Error('对话内容过多，请减少附件或开始新对话（上下文最多 20 个文件、合计 32 MB）。');
  const turns: ChatTurn[] = [];
  for (const turn of request.turns) {
    const attachments: NonNullable<ChatTurn['files']> = [];
    for (const attachment of turn.files ?? []) {
      signal.throwIfAborted();
      const data = await attachment.file.arrayBuffer();
      signal.throwIfAborted();
      attachments.push({ name: attachment.name, bytes: new Uint8Array(data) });
    }
    turns.push({ ...turn, files: turn.files ? attachments : undefined });
  }
  return { ...request, turns };
}

export function failureText(error: ChatFailure) {
  return [
    error.message,
    error.status ? `HTTP ${error.status}` : '',
    error.code?.startsWith('skill_') ? '' : error.code,
    error.param ? `参数：${error.param}` : '',
    error.requestId ? `请求：${error.requestId}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
export class ChatRequestError extends Error {
  constructor(
    public failure: ChatFailure,
    public partial?: ChatPartialResponse,
  ) {
    super(failureText(failure));
  }
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
    if (!result.ok) throw new ChatRequestError(result.error, result.partial);
    return result;
  } finally {
    unsubscribe();
    signal.removeEventListener('abort', cancel);
  }
}
export async function openChatLink(url: string) {
  if (window.desktop) await window.desktop.chatOpenLink(url);
}
