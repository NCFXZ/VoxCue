import { CHAT_INSTRUCTIONS_LIMIT, CHAT_TEXT_LIMIT, type ChatEvent, type ChatRequest } from '../../contracts/chat';
import type { ChatActivity } from '../../contracts/activity';
import { ChatServiceError } from './errors';
import { noWebSearchInstructions } from './input';
import { ProfileOutputError } from './profile';
import type { ChatCompletion } from './ports';

const recoveryInstructions = '\n\n重新回答用户当前请求。仅输出一个完整 JSON 对象，按 answer、changes、skillScope 的顺序，禁止代码围栏和额外文字。answer 是用户可见的完整回答，只在需要时提出待确认的资料变更。changes 必须是对象，仅填写用户明确要求修改的字段。空字符串表示清空单个文本字段，null 或省略表示保持原值。没有更新时使用 {"answer":"正常回答","changes":{},"skillScope":null}。根据用户的话和上下文判断意图，含义不清时澄清。';

/** Retry once after a completed API stream failed profile format validation. */
export async function recoverApiProfileOutput(
  request: ChatRequest,
  emit: (event: ChatEvent) => void,
  signal: AbortSignal,
  stream: (request: ChatRequest, emit: (event: ChatEvent) => void, signal: AbortSignal, recovering?: true) => Promise<ChatCompletion>,
  recovery: 'buffered' | 'preview' = 'buffered',
  retryInstructions = recoveryInstructions,
) {
  if (!request.profile) return stream(request, emit, signal);
  try {
    return await stream(request, emit, signal);
  } catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof ProfileOutputError)) throw error;
    const instructions = request.instructions + retryInstructions + noWebSearchInstructions;
    const textLength = request.turns.reduce((length, turn) => length + turn.content.length, instructions.length);
    if (instructions.length > CHAT_INSTRUCTIONS_LIMIT || textLength > CHAT_TEXT_LIMIT) throw error;
    const retry = { ...request, instructions, webSearch: false };

    if (recovery === 'preview') {
      const emptyPreview = { id: request.id, type: 'profile-preview' as const, preview: {} };
      emit(emptyPreview);
      let firstText = true;
      let prefix = '';
      const retryActivity = (activity: ChatActivity): ChatActivity => ({
        ...activity,
        ...(activity.id ? { id: 'profile-recovery-' + activity.id } : {}),
        ...(activity.kind === 'status' && activity.phase === 'waiting' ? {
          detail: activity.status === 'completed' ? '已收到重试响应' : '正在重新生成回答',
        } : {}),
      });
      try {
        // The transport bounds waiting for headers and new data. Replace the old draft once new text arrives.
        const result = await stream(retry, (event) => {
          if (signal.aborted) return;
          if (event.type === 'profile-preview') emit(event);
          if (event.type === 'activity') emit({ ...event, activity: retryActivity(event.activity) });
          if (event.type === 'delta') {
            if (firstText) {
              prefix += event.text;
              if (!prefix.trim()) return;
              emit({ id: request.id, type: 'sources', sources: [] });
              emit({ ...event, text: prefix, replace: true });
              firstText = false;
            } else emit(event);
          }
        }, signal, true);
        return { ...result, activities: result.activities?.map(retryActivity) };
      } catch (retryError) {
        if (!signal.aborted && retryError instanceof ChatServiceError && retryError.detail.code === 'content_filter') {
          emit(emptyPreview);
          throw new ChatServiceError({ ...retryError.detail, discardPartial: true });
        }
        throw retryError;
      }
    }

    // Keep retry events private so only the validated result replaces the first draft.
    return stream(
      retry,
      () => {},
      AbortSignal.any([signal, AbortSignal.timeout(25000)]),
      true,
    );
  }
}
