import type { ChatEvent, ChatRequest, ChatSource, TokenUsage } from '../../contracts/chat';
import { mergeActivityLog, type ChatActivity } from '../../contracts/activity';
import { encodeAttachmentBody, noWebSearchInstructions, prepareResponseInput, publicWebSearchInstructions } from '../chat/input';
import { ProfileOutputError, profileContext } from '../chat/profile';
import { ProfilePreviews } from '../chat/profilePreviews';
import { verifySkillProposal } from '../chat/proposal';
import { responseEvents } from '../chat/responses';
import { ChatServiceError } from '../chat/errors';
import { deepseekApi } from './catalogs';
import { DeepSeekProfileStream, deepSeekProfileInstructions } from './deepseekProfile';
import { DeepSeekWebResults } from './deepseekWeb';
import type { ApiModel } from './types';

export function messagesBody(
  request: ChatRequest,
  model: ApiModel,
  signal: AbortSignal,
  flashSearch?: boolean,
  responsesSearch?: boolean,
  // A recovery or structure follow-up states its own search limits.
  skipSearchNote?: boolean,
) {
  const { input, attachments } = prepareResponseInput(request);
  const turns = input.map(({ role, content }) => {
    if (typeof content === 'string') return { role, content };
    const parts = content.map(part => {
      if (part.type === 'input_text') return { type: 'text', text: part.text };
      if (part.type === 'input_image') {
        if (model.imageInput !== true)
          throw Error('所选模型未确认支持图片输入，请移除图片或更换模型。');
        return { type: 'image_url', image_url: { url: part.image_url } };
      }
      throw Error('该 API 连接支持文本和所选模型可读取的图片，请将文档转换成纯文本再发送。');
    });
    return { role, content: parts };
  });
  let instructions = request.instructions + profileContext(request);
  if (flashSearch || responsesSearch) {
    instructions += publicWebSearchInstructions;
  } else if (!skipSearchNote) {
    instructions += noWebSearchInstructions;
  }
  if (request.profile) instructions += deepSeekProfileInstructions;

  const json = JSON.stringify({
    model: model.id,
    stream: true,
    ...(flashSearch ? {
      tools: [{ type: 'deepseek_web_search' }],
      safety_check: { level: 'high' },
    } : {}),
    stream_options: { include_usage: true },
    ...(request.effort ? deepseekApi.reasoning(request.effort) : {}),
    messages: instructions ? [{ role: 'system', content: instructions }, ...turns] : turns,
  });
  return attachments.length ? encodeAttachmentBody(json, attachments, signal, 'compatible') : json;
}

const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
function usageCounts(input: unknown, output: unknown, total?: unknown): TokenUsage | null {
  if (!count(input) || !count(output)) return null;
  const sum = total ?? input + output;
  if (!count(sum)) return null;
  return { inputTokens: input, outputTokens: output, totalTokens: sum };
}
const addUsage = (a: TokenUsage | null, b: TokenUsage | null): TokenUsage | null => a && b ? {
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  totalTokens: a.totalTokens + b.totalTokens,
} : a ?? b;

export async function receiveMessages(
  response: Response,
  request: ChatRequest,
  emit: (event: ChatEvent) => void,
  signal: AbortSignal,
  saveUsage: (id: string, usage: TokenUsage) => Promise<void>,
  options: {
    webSearch?: boolean;
    events?: ReturnType<typeof responseEvents>;
    /** Asks only for the intent and proposal of an answer whose structure was unreliable. */
    requestStructure?: (answerText: string) => Promise<Response>;
  } = {},
) {
  const deepSeekWeb = options.webSearch ? new DeepSeekWebResults() : undefined;
  const profile = request.profile ? new DeepSeekProfileStream() : undefined;
  let activities: ChatActivity[] = [];
  let lastPhase: ChatActivity['phase'] | undefined;
  let sequence = 0;
  let warning: string | undefined;
  const publishActivity = (item: ChatActivity) => {
    activities = mergeActivityLog(activities, item);
    emit({ id: request.id, type: 'activity', activity: item });
  };
  const activity = (phase: ChatActivity['phase'], completed = false) => {
    if (lastPhase === phase && !completed) return;
    if (lastPhase && !completed) activity(lastPhase, true);
    const item: ChatActivity = {
      kind: 'status',
      phase,
      id: 'api-phase-' + (completed ? sequence : ++sequence),
      status: completed ? 'completed' : 'in_progress',
    };
    publishActivity(item);
    lastPhase = phase;
  };
  let previewShown = false;
  using previews = profile && new ProfilePreviews(request.id, (event) => {
    activity('organizing');
    previewShown = true;
    emit(event);
  }, signal);

  // Read one reply to a normal stop. Text is handed to `receive`; usage is saved even on failure.
  const consume = async (
    events: AsyncIterable<any>,
    receive: (delta: string) => void,
    reasoning: ChatActivity['phase'],
    web?: DeepSeekWebResults,
  ) => {
    let text = '',
      responseId = '',
      complete = false;
    let stopReason: unknown;
    let streamFailed = false;
    let usage: TokenUsage | null = null;
    for await (const event of events) {
      const failed = event.type === 'error' || !!event.error;
      if (failed && !web)
        throw new ChatServiceError({ message: '模型服务返回流式错误，已保留收到的回答。' });
      if (typeof event.id === 'string' && !responseId) responseId = event.id;
      const choice = event.choices?.[0];
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
      if (failed) {
        streamFailed = true;
        break;
      }
      if (choice?.finish_reason !== 'content_filter' && web?.ingest(choice, item => {
        if (item.status === 'in_progress') activity(item.phase);
        publishActivity(item);
      }))
        emit({ id: request.id, type: 'sources', sources: [...web.sources.values()] });
      if (choice?.delta?.reasoning_content) activity(reasoning);
      const delta = choice?.delta?.content;
      if (typeof delta === 'string' && delta) {
        if (text.length + delta.length > 1000000) throw Error('回答过长，已停止接收。');
        text += delta;
        receive(delta);
      }
    }
    signal.throwIfAborted();
    // A length-limited response or an invalid profile proposal can still be billed.
    if ((complete || streamFailed) && usage && typeof responseId === 'string' && /^[\w.:-]{1,200}$/.test(responseId)) {
      try {
        await saveUsage(responseId, usage);
      } catch {
        warning = '回答已接收，但本机用量保存失败。';
      }
    }
    signal.throwIfAborted();
    if (streamFailed)
      throw new ChatServiceError({ message: '模型服务返回流式错误，已保留收到的回答。' });
    if (complete && (stopReason === 'refusal' || stopReason === 'content_filter' || stopReason === 'sensitive'))
      throw new ChatServiceError({
        code: 'content_filter', message: '模型服务拒绝了这次请求。',
        ...(web ? { discardPartial: true } : {}),
      });
    if (stopReason === 'model_context_window_exceeded')
      throw new ChatServiceError({ code: stopReason, message: '请求已超出模型上下文窗口，请缩短对话或减少附件后重试。' });
    if (stopReason === 'network_error')
      throw new ChatServiceError({ code: stopReason, message: '模型推理中断，已保留收到的内容，请稍后重试。' });
    if (profile && stopReason === 'length')
      throw new ChatServiceError({ code: 'length', message: 'DeepSeek 的回答达到输出长度上限，请缩短请求后重试。' });
    if (profile && (stopReason === 'insufficient_system_resource' || stopReason === 'aborted'))
      throw new ChatServiceError({ code: stopReason, message: 'DeepSeek 中断了生成，请稍后重试。' });
    if (!complete || stopReason !== 'stop')
      throw Error('回答未完整返回，已保留收到的内容，请重试。');
    return { text, usage };
  };

  activity('waiting');
  const reply = await consume(options.events ?? responseEvents(response, signal), delta => {
    const visible = profile?.append(delta) ?? delta;
    if (!profile || visible.trim() || (!profile.previewReady && delta.trim())) activity('writing');
    if (visible) emit({ id: request.id, type: 'delta', text: visible });
    previews?.update(profile);
  }, 'thinking', deepSeekWeb);
  let usage = reply.usage;
  if (profile && !reply.text.trim())
    throw new ProfileOutputError('DeepSeek 返回了空白回答，请重试。');
  if (!reply.text.trim())
    throw Error('回答未完整返回，已保留收到的内容，请重试。');
  previews?.flush();
  let proposal = profile && request.profile ? profile.finish(request.profile) : undefined;
  if (proposal?.delta) {
    activity('writing');
    emit({ id: request.id, type: 'delta', text: proposal.delta });
  }
  if (proposal?.issue && request.profile) {
    // Keep the shown answer and its search results; ask only for the missing structure.
    if (!options.requestStructure) throw new ChatServiceError({ message: proposal.issue });
    activity('organizing');
    // A partial proposal from the first reply is not reliable; the follow-up replaces it.
    if (previewShown) emit({ id: request.id, type: 'profile-preview', preview: {} });
    previews?.reset();
    const structure = new DeepSeekProfileStream(true);
    const followUp = await consume(responseEvents(await options.requestStructure(proposal.answerText), signal), delta => {
      structure.append(delta);
      previews?.update(structure);
    }, 'organizing');
    usage = addUsage(usage, followUp.usage);
    previews?.flush();
    const resolved = structure.finish(request.profile);
    // Never retry the whole answer here: report the unresolved structure with the answer kept.
    if (resolved.issue) throw new ChatServiceError({ message: resolved.issue });
    proposal = { ...proposal, changes: resolved.changes, skillScope: resolved.skillScope, issue: undefined };
  }
  const profileChanges = proposal && Object.keys(proposal.changes).length ? proposal.changes : undefined;
  const sources = deepSeekWeb?.sources ?? new Map<string, ChatSource>();
  const skillSourceIssues = verifySkillProposal(
    request,
    profileChanges,
    sources,
    deepSeekWeb?.completedSearch ?? false,
    proposal?.skillScope,
  );
  if (lastPhase) activity(lastPhase, true);
  return {
    answerText: proposal?.answerText ?? reply.text,
    sources: [...sources.values()],
    usage,
    activities,
    profileChanges,
    skillSourceIssues,
    warning,
  };
}
