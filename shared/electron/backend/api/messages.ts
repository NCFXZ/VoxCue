import type { ChatEvent, ChatRequest, TokenUsage } from '../../contracts/chat';
import { mergeActivityLog, type ChatActivity } from '../../contracts/activity';
import { encodeAttachmentBody, noWebSearchInstructions, prepareResponseInput } from '../chat/input';
import { ProfileAnswerStream, profileContext, profileSchemaInstructions } from '../chat/profile';
import { ProfilePreviews } from '../chat/profilePreviews';
import { verifySkillProposal } from '../chat/proposal';
import { responseEvents } from '../chat/responses';
import { ChatServiceError } from '../chat/errors';
import type { ApiModel, CompatibleApi } from './types';

function messageParts({ input, attachments }: ReturnType<typeof prepareResponseInput>, model: ApiModel, nativeClaude: boolean) {
  return input.map(({ role, content }) => {
    if (typeof content === 'string') return { role, content };
    const parts = content.map((part) => {
      if (part.type === 'input_text') return { type: 'text', text: part.text };
      const image = part.type === 'input_image';
      if (image && model.imageInput !== true)
        throw Error('所选模型未确认支持图片输入，请移除图片或更换模型。');
      if (!nativeClaude) {
        if (image) return { type: 'image_url', image_url: { url: part.image_url } };
        throw Error('该 API 连接支持文本和所选模型可读取的图片，请将文档转换成纯文本再发送。');
      }
      const data = image ? part.image_url : part.file_data;
      const separator = typeof data === 'string' ? data.indexOf(',') : -1;
      const media_type = typeof data === 'number' ? attachments[data].mime : data.slice(5, separator - ';base64'.length);
      if (!image && (media_type !== 'application/pdf' || !model.pdfInput))
        throw Error('所选模型不支持该文档格式，请转换成纯文本再发送。');
      return {
        type: image ? 'image' : 'document',
        source: { type: 'base64', media_type, data: typeof data === 'number' ? data : data.slice(separator + 1) },
      };
    });
    return { role, content: parts };
  });
}

export function messagesBody(request: ChatRequest, model: ApiModel, adapter: CompatibleApi | undefined, signal: AbortSignal) {
  const prepared = prepareResponseInput(request);
  const turns = messageParts(prepared, model, !adapter);
  const json = JSON.stringify(messageEnvelope(request, model, turns, prepared.attachments, adapter));
  return prepared.attachments.length
    ? encodeAttachmentBody(json, prepared.attachments, signal, adapter ? 'compatible' : 'claude')
    : json;
}

function messageEnvelope(request: ChatRequest, model: ApiModel, turns: ReturnType<typeof messageParts>,
  attachments: ReturnType<typeof prepareResponseInput>['attachments'], adapter?: CompatibleApi) {
  let instructions = request.instructions + profileContext(request);
  if (request.webSearch) instructions += noWebSearchInstructions;
  if (request.profile) instructions += profileSchemaInstructions;
  if (!adapter) {
    const effort = request.effort;
    return {
      model: model.id,
      stream: true,
      max_tokens: Math.min(model.maxOutput ?? 8192, 16384),
      ...(instructions ? { system: instructions } : {}),
      messages: turns,
      ...(effort === 'none'
        ? { thinking: { type: 'disabled' } }
        : effort
          ? {
              ...(model.adaptiveThinking
                ? { thinking: { type: 'adaptive' } }
                : effort === 'on'
                  ? { thinking: { type: 'enabled', budget_tokens: 1024 } }
                  : {}),
              ...(effort === 'on' ? {} : { output_config: { effort } }),
            }
          : {}),
    };
  }
  if (adapter.replayTextHistory?.(model) && turns.length > 1) {
    // Some models require private reasoning on assistant turns. Keep imported
    // public transcripts as quoted user data and preserve the order of images.
    const content: Record<string, unknown>[] = [];
    for (const turn of turns.slice(0, -1)) {
      const parts =
        typeof turn.content === 'string' ? [{ type: 'text', text: turn.content }] : turn.content;
      content.push({ type: 'text', text: JSON.stringify({ historicalRole: turn.role }) });
      for (const part of parts) {
        if (part.type === 'text' && typeof part.text === 'number') {
          attachments[part.text].quotedProperty = 'historicalText';
          content.push(part);
        } else {
          content.push(part.type === 'text'
            ? { type: 'text', text: JSON.stringify({ historicalText: part.text }) }
            : part);
        }
      }
    }
    content.push({ type: 'text', text: '以上为历史对话资料。以下为当前用户消息。' });
    const current = turns.at(-1)!.content;
    content.push(...(typeof current === 'string' ? [{ type: 'text', text: current }] : current));
    return compatibleBody([{ role: 'user', content }]);
  }
  return compatibleBody(turns);

  function compatibleBody(messages: unknown[]) {
    return {
      model: model.id,
      stream: true,
      ...(adapter!.streamUsage?.(model) !== false ? { stream_options: { include_usage: true } } : {}),
      ...(request.effort ? adapter!.reasoning?.(model, request.effort) : {}),
      ...(adapter!.historyOptions && turns.some(turn => turn.role === 'assistant')
        ? adapter!.historyOptions(model) : {}),
      messages: instructions ? [{ role: 'system', content: instructions }, ...messages] : messages,
    };
  }
}

const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
function usageCounts(input: unknown, output: unknown, total?: unknown): TokenUsage | null {
  if (!count(input) || !count(output)) return null;
  const sum = total ?? input + output;
  if (!count(sum)) return null;
  return { inputTokens: input, outputTokens: output, totalTokens: sum };
}

export async function receiveMessages(
  response: Response,
  request: ChatRequest,
  nativeClaude: boolean,
  emit: (event: ChatEvent) => void,
  signal: AbortSignal,
  saveUsage: (id: string, usage: TokenUsage) => Promise<void>,
) {
  const profile = request.profile ? new ProfileAnswerStream() : undefined;
  using previews = profile && new ProfilePreviews(request.id, emit, signal);
  let activities: ChatActivity[] = [];
  let lastPhase: ChatActivity['phase'] | undefined;
  let sequence = 0;
  const activity = (phase: ChatActivity['phase'], completed = false) => {
    if (lastPhase === phase && !completed) return;
    if (lastPhase && !completed) activity(lastPhase, true);
    const item: ChatActivity = {
      kind: 'status',
      phase,
      id: 'api-phase-' + (completed ? sequence : ++sequence),
      status: completed ? 'completed' : 'in_progress',
    };
    activities = mergeActivityLog(activities, item);
    emit({ id: request.id, type: 'activity', activity: item });
    lastPhase = phase;
  };
  activity('waiting');
  let text = '',
    responseId = '',
    complete = false;
  let stopReason: unknown;
  let usage: TokenUsage | null = null;
  let claudeInput: number | undefined, claudeOutput: number | undefined;
  let cacheRead = 0, cacheWrite = 0;
  function captureClaude(value: Record<string, unknown> | undefined) {
    if (!value) return;
    if (count(value.input_tokens)) claudeInput = value.input_tokens;
    if (count(value.cache_creation_input_tokens)) cacheWrite = value.cache_creation_input_tokens;
    if (count(value.cache_read_input_tokens)) cacheRead = value.cache_read_input_tokens;
    if (count(value.output_tokens)) claudeOutput = value.output_tokens;
    usage = usageCounts(claudeInput === undefined ? undefined : claudeInput + cacheRead + cacheWrite, claudeOutput);
  }
  for await (const event of responseEvents(response, signal)) {
    if (event.type === 'error' || event.error)
      throw new ChatServiceError({ message: '模型服务返回流式错误，已保留收到的回答。' });
    let delta: unknown,
      thinking = false;
    if (nativeClaude) {
      if (event.type === 'message_start') {
        responseId = event.message?.id;
        captureClaude(event.message?.usage);
      }
      if (event.type === 'content_block_start') {
        const block = event.content_block?.type;
        thinking = block === 'thinking' || block === 'redacted_thinking';
      }
      if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta') delta = event.delta.text;
        thinking = event.delta?.type === 'thinking_delta';
      }
      if (event.type === 'message_delta') {
        captureClaude(event.usage);
        if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
      }
      if (event.type === 'message_stop') {
        complete = true;
        break;
      }
    } else {
      if (typeof event.id === 'string' && !responseId) responseId = event.id;
      const choice = event.choices?.[0];
      delta = choice?.delta?.content;
      thinking = !!choice?.delta?.reasoning_content;
      if (choice?.finish_reason) {
        stopReason = choice.finish_reason;
        complete = true;
      }
      if (event.usage)
        usage = usageCounts(
          event.usage.prompt_tokens,
          event.usage.completion_tokens,
          event.usage.total_tokens,
        );
    }
    if (thinking) activity('thinking');
    if (typeof delta === 'string' && delta) {
      if (text.length + delta.length > 1000000) throw Error('回答过长，已停止接收。');
      text += delta;
      const visible = profile ? profile.append(delta) : delta;
      activity(profile?.answerComplete ? 'organizing' : 'writing');
      if (visible) emit({ id: request.id, type: 'delta', text: visible });
      previews?.update(profile);
    }
  }
  signal.throwIfAborted();
  let warning: string | undefined;
  // A length-limited response or an invalid profile proposal can still be billed.
  if (complete && usage && typeof responseId === 'string' && /^[\w.:-]{1,200}$/.test(responseId)) {
    try {
      await saveUsage(responseId, usage);
    } catch {
      warning = '回答已接收，但本机用量保存失败。';
    }
  }
  signal.throwIfAborted();
  if (complete && (stopReason === 'refusal' || stopReason === 'content_filter' || stopReason === 'sensitive'))
    throw new ChatServiceError({ code: 'content_filter', message: '模型服务拒绝了这次请求。' });
  if (stopReason === 'model_context_window_exceeded')
    throw new ChatServiceError({ code: stopReason, message: '请求已超出模型上下文窗口，请缩短对话或减少附件后重试。' });
  if (stopReason === 'network_error')
    throw new ChatServiceError({ code: stopReason, message: '模型推理中断，已保留收到的内容，请稍后重试。' });
  const finished = nativeClaude ? stopReason === 'end_turn' || stopReason === 'stop_sequence' : stopReason === 'stop';
  if (!complete || !finished || !text.trim())
    throw Error('回答未完整返回，已保留收到的内容，请重试。');
  previews?.flush();
  const proposal = profile && request.profile ? profile.finish(request.profile) : undefined;
  const skillSourceIssues = verifySkillProposal(
    request,
    proposal?.changes,
    new Map(),
    false,
    proposal?.skillScope,
  );
  if (proposal?.delta) emit({ id: request.id, type: 'delta', text: proposal.delta });
  if (lastPhase) activity(lastPhase, true);
  return {
    answerText: profile ? (JSON.parse(profile.raw).answer as string) : text,
    sources: [],
    usage,
    activities,
    profileChanges: proposal?.changes,
    skillSourceIssues,
    warning,
  };
}
