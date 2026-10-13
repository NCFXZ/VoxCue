import {
  CHAT_TEXT_LIMIT,
  reasoningEfforts,
  type ChatRequest,
  type ChatSource,
} from '../../contracts/chat';
import { validProfile } from '../../contracts/profile';
export function validSource(value: any): ChatSource | null {
  if (typeof value?.url !== 'string' || value.url.length > 4096) return null;
  try {
    const url = new URL(value.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return {
      url: url.href,
      title: typeof value.title === 'string' ? value.title.slice(0, 300) : url.hostname,
    };
  } catch {
    return null;
  }
}
export function validateRequest(value: unknown): ChatRequest {
  const request = value as ChatRequest;
  if (
    !request ||
    typeof request !== 'object' ||
    Object.keys(request).some(
      (key) =>
        !['id', 'modelId', 'effort', 'webSearch', 'instructions', 'turns', 'profile'].includes(key),
    ) ||
    typeof request.id !== 'string' ||
    !/^[\w-]{1,80}$/.test(request.id) ||
    typeof request.modelId !== 'string' ||
    request.modelId.length > 160 ||
    typeof request.webSearch !== 'boolean' ||
    (request.effort !== undefined && !reasoningEfforts.includes(request.effort)) ||
    typeof request.instructions !== 'string' ||
    request.instructions.length > 40000 ||
    (request.profile !== undefined && !validProfile(request.profile)) ||
    !Array.isArray(request.turns) ||
    !request.turns.length ||
    request.turns.length > 100
  )
    throw new Error('聊天请求无效，请重新开始对话。');
  let bytes = 0,
    text = request.instructions.length,
    files = 0;
  for (const turn of request.turns) {
    if (!turn || !['user', 'assistant'].includes(turn.role) || typeof turn.content !== 'string')
      throw new Error('对话内容无效。');
    text += turn.content.length;
    if (turn.files !== undefined && (!Array.isArray(turn.files) || turn.role !== 'user'))
      throw new Error('附件请求无效。');
    for (const file of turn.files ?? []) {
      if (
        typeof file?.name !== 'string' ||
        !file.name ||
        file.name.length > 300 ||
        !(file.bytes instanceof Uint8Array) ||
        !file.bytes.byteLength ||
        file.bytes.byteLength > 20 * 1024 * 1024
      )
        throw new Error('附件请求无效或超过 20 MB。');
      bytes += file.bytes.byteLength;
      files++;
    }
  }
  if (text > CHAT_TEXT_LIMIT || bytes > 32 * 1024 * 1024 || files > 20)
    throw new Error('对话内容过多，请减少附件或开始新对话（上下文最多 20 个文件、合计 32 MB）。');
  if (request.turns.at(-1)?.role !== 'user') throw new Error('缺少用户问题。');
  return request;
}
