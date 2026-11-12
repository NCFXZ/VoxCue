import {
  CHAT_TEXT_LIMIT,
  CHAT_TURN_LIMIT,
  CHAT_FILE_LIMIT,
  CHAT_FILE_BYTES_LIMIT,
  CHAT_FILES_BYTES_LIMIT,
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
      title:
        typeof value.title === 'string' && value.title.trim()
          ? value.title.slice(0, 300)
          : url.hostname,
    };
  } catch {
    return null;
  }
}
// Page fragments and known advertising tags do not identify a different document.
// Preserve meaningful queries, path, protocol and host; never match by domain alone.
export function sourceKey(value: string): string | undefined {
  const source = validSource({ url: value });
  if (!source) return;
  const url = new URL(source.url);
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (/^utm_/i.test(key) || /^(?:gclid|dclid|fbclid|msclkid|_ga)$/i.test(key))
      url.searchParams.delete(key);
  return url.href;
}
export function validateRequest(value: unknown): ChatRequest {
  const request = value as ChatRequest;
  if (
    !request ||
    typeof request !== 'object' ||
    Object.keys(request).some(
      (key) =>
        ![
          'id',
          'modelId',
          'effort',
          'webSearch',
          'instructions',
          'turns',
          'profile',
          'profileTask',
          'knowledgeBaseId',
        ].includes(key),
    ) ||
    typeof request.id !== 'string' ||
    !/^[\w-]{1,80}$/.test(request.id) ||
    typeof request.modelId !== 'string' ||
    request.modelId.length > 160 ||
    typeof request.webSearch !== 'boolean' ||
    (request.effort !== undefined && !reasoningEfforts.includes(request.effort)) ||
    typeof request.instructions !== 'string' ||
    request.instructions.length > 60000 ||
    (request.profile !== undefined && !validProfile(request.profile)) ||
    (request.profileTask !== undefined &&
      (request.profileTask !== 'skills' ||
        !request.profile ||
        !request.profile.background.trim() ||
        !request.profile.jobDescription.trim())) ||
    (request.knowledgeBaseId !== undefined &&
      request.knowledgeBaseId !== null &&
      (typeof request.knowledgeBaseId !== 'string' ||
        !/^[\w-]{1,100}$/.test(request.knowledgeBaseId))) ||
    !Array.isArray(request.turns) ||
    !request.turns.length ||
    request.turns.length > CHAT_TURN_LIMIT
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
        file.bytes.byteLength > CHAT_FILE_BYTES_LIMIT
      )
        throw new Error('附件请求无效或超过 20 MB。');
      bytes += file.bytes.byteLength;
      files++;
    }
  }
  if (text > CHAT_TEXT_LIMIT || bytes > CHAT_FILES_BYTES_LIMIT || files > CHAT_FILE_LIMIT)
    throw new Error('对话内容过多，请减少附件或开始新对话（上下文最多 20 个文件、合计 32 MB）。');
  if (request.turns.at(-1)?.role !== 'user') throw new Error('缺少用户问题。');
  return request;
}
