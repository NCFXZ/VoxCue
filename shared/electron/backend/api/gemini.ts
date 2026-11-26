import { randomUUID } from 'node:crypto';
import { mergeActivityLog, type ChatActivity } from '../../contracts/activity';
import { GOOGLE_SEARCH_SUGGESTIONS_LIMIT, type ChatEvent, type ChatRequest, type ChatSource, type ModelProvider, type ReasoningEffort, type TokenUsage } from '../../contracts/chat';
import { abortable } from '../cancellable';
import { boundedJson } from '../boundedJson';
import { ChatServiceError, invalidatesModelCatalog } from '../chat/errors';
import { base64Chunks, noWebSearchInstructions, publicWebSearchInstructions, prepareResponseInput } from '../chat/input';
import { ModelCatalog } from '../chat/modelCatalog';
import { invalidCatalog, modelId, modelLabel, record } from '../chat/models';
import { profileContext, profileFormat, profileSchemaInstructions, ProfileAnswerStream } from '../chat/profile';
import { ProfilePreviews } from '../chat/profilePreviews';
import { recoverApiProfileOutput } from '../chat/profileRecovery';
import { verifySkillProposal } from '../chat/proposal';
import { readErrorResponse, requestResponse, responseEvents } from '../chat/responses';
import { sourceKey, validSource, validateRequest } from '../chat/validation';
import type { UsageLedger } from '../chat/usage';
import type { ApiChatService, ApiCredential, ApiModel } from './types';

const base = 'https://generativelanguage.googleapis.com/v1beta';
const levelModels: Record<string, { levels: ReasoningEffort[]; default: ReasoningEffort }> = {
  'gemini-4-carbon': { levels: ['low', 'medium', 'high'], default: 'medium' },
  'gemini-4-argon': { levels: ['low', 'medium', 'high'], default: 'medium' },
  'gemini-4-neon': { levels: ['low', 'medium', 'high', 'xhigh'], default: 'high' },
  'gemini-4-hydrogen': { levels: ['low', 'medium', 'high', 'xhigh'], default: 'high' },
  'gemini-3.8-flash': { levels: ['low', 'medium', 'high'], default: 'medium' },
  'gemini-3.6-flash': { levels: ['minimal', 'low', 'medium', 'high'], default: 'medium' },
  'gemini-3.5-flash-lite': { levels: ['minimal', 'low', 'medium', 'high'], default: 'minimal' },
  'gemini-3.1-pro-preview': { levels: ['low', 'medium', 'high'], default: 'high' },
  'gemini-3.1-flash-lite': { levels: ['minimal', 'low', 'medium', 'high'], default: 'minimal' },
  'gemini-3-flash-preview': { levels: ['minimal', 'low', 'medium', 'high'], default: 'high' },
  'gemini-3-pro-preview': { levels: ['low', 'high'], default: 'high' },
};
const budgets: Partial<Record<ReasoningEffort, number>> = { none: 0, low: 1024, medium: 8192, high: 24576 };
interface GeminiModel extends ApiModel {
  thinking: boolean;
  budget: boolean;
  webSearch: boolean;
  /** Gemini 3 and later constrain decoding to a JSON Schema, also alongside Google Search. */
  nativeProfileFormat: boolean;
}

function parseModel(value: unknown, provider: ModelProvider): GeminiModel | undefined {
  const entry = record(value);
  const id = typeof entry?.name === 'string' ? entry.name.replace(/^models\//, '') : '';
  if (!modelId(id) || !id.startsWith('gemini-') ||
      /(?:image|audio|tts|live|embedding|robotics|computer-use)/i.test(id) ||
      !Array.isArray(entry?.supportedGenerationMethods) || !entry.supportedGenerationMethods.includes('generateContent')) return;
  const levels = levelModels[id];
  const budget = /^gemini-2\.5-(?:pro|flash|flash-lite)(?:-(?:preview(?:-\d{2}-\d{2})?|\d{3}))?$/.test(id);
  const known = !!levels || budget || /^gemini-2\.0-flash(?:-lite)?(?:-\d{3})?$/.test(id);
  const thinking = entry.thinking === true;
  return {
    id, label: modelLabel(entry.displayName) ? entry.displayName : id, description: '', provider,
    thinking, budget, imageInput: known,
    nativeProfileFormat: /^gemini-(?:[3-9]|[1-9]\d+)[.-]/.test(id),
    webSearch: (!!levels && id !== 'gemini-3-pro-preview') || budget || /^gemini-2\.0-flash(?:-\d{3})?$/.test(id),
    reasoningEfforts: thinking ? levels?.levels ?? (budget ?
      (id.includes('-pro') ? ['low', 'medium', 'high'] : ['none', 'low', 'medium', 'high']) : []) : [],
    ...(thinking && levels ? { defaultReasoningEffort: levels.default } : {}),
  };
}

function geminiFailure(status: number | undefined, body: unknown) {
  const error = record(record(body)?.error);
  const details = Array.isArray(error?.details) ? error.details : [];
  const invalidKey = details.some(value => record(value)?.reason === 'API_KEY_INVALID');
  const code = invalidKey ? 'API_KEY_INVALID' : typeof error?.status === 'string' && /^[A-Z_]{1,60}$/.test(error.status)
    ? error.status : undefined;
  const message = invalidKey || status === 401 ? 'API 密钥未被接受，请检查密钥。'
    : status === 403 ? 'API 账户无权访问该服务，请检查权限与套餐。'
    : status === 404 ? '所选 API 模型或端点不可用，请检查配置并刷新模型列表。'
    : status === 429 ? 'API 服务已达到调用限额，请查看服务商用量或稍后重试。'
    : status === 400 ? 'API 服务未接受请求，请检查模型、输入及思考设置。'
    : 'API 服务暂时不可用，请稍后重试。';
  return new ChatServiceError({ message, status, code });
}

// Google reports overload as 503 and a short per-minute limit as 429 with RetryInfo.
// Nothing has streamed before a failed status, so the same request can be sent again.
const retryWaits = [1000, 3000];
function retryWait(status: number, body: unknown, attempt: number) {
  if (attempt >= retryWaits.length) return;
  if (status === 503) return retryWaits[attempt];
  if (status !== 429) return;
  const details = record(record(body)?.error)?.details;
  const info = Array.isArray(details)
    ? details.map(record).find(value => value?.['@type'] === 'type.googleapis.com/google.rpc.RetryInfo')
    : undefined;
  const seconds = typeof info?.retryDelay === 'string' ? /^(\d{1,3}(?:\.\d{1,9})?)s$/.exec(info.retryDelay)?.[1] : undefined;
  const wait = seconds === undefined ? undefined : Math.ceil(Number(seconds) * 1000);
  return wait !== undefined && wait <= 15000 ? Math.max(wait, retryWaits[attempt]) : undefined;
}

function pause(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, milliseconds);
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  });
}

async function send(fetcher: typeof fetch, url: string, init: RequestInit, signal: AbortSignal, retrying?: () => void) {
  for (let attempt = 0; ; attempt++) {
    const response = await requestResponse(fetcher, url, init, signal);
    if (response.ok) return response;
    const body = await readErrorResponse(response, signal);
    const wait = retryWait(response.status, body, attempt);
    if (wait === undefined) throw geminiFailure(response.status, body);
    retrying?.();
    await pause(wait, signal);
  }
}

async function bodyFor(request: ChatRequest, model: GeminiModel, signal: AbortSignal, webSearch: boolean) {
  const { input, attachments } = prepareResponseInput(request);
  const part = (entry: Record<string, string | number>) => {
    if (entry.type === 'input_text') return { text: entry.text };
    if (!model.imageInput) throw Error('所选模型不支持图片输入，请移除图片或更换模型。');
    const data = entry.type === 'input_image' ? entry.image_url : entry.file_data;
    const mime = typeof data === 'number' ? attachments[data]?.mime : String(data).match(/^data:([^;]+);base64,/)?.[1];
    if (!mime || (!mime.startsWith('image/') && mime !== 'application/pdf'))
      throw Error('该 API 连接支持文本、图片和 PDF，请将其他文档转换成纯文本再发送。');
    return { inlineData: { mimeType: mime, data: typeof data === 'number' ? data : String(data).slice(String(data).indexOf(',') + 1) } };
  };
  // Prompt-only schemas let a small or lightly thinking model reply in plain prose.
  const nativeFormat = !!request.profile && model.nativeProfileFormat;
  const generationConfig = {
    ...(model.thinking ? { thinkingConfig: {
      ...(request.effort ? model.budget ? { thinkingBudget: budgets[request.effort] } : { thinkingLevel: request.effort } : {}),
    } } : {}),
    ...(nativeFormat ? { responseMimeType: 'application/json', responseJsonSchema: profileFormat.format.schema } : {}),
  };
  const json = JSON.stringify({
    systemInstruction: { parts: [{ text: request.instructions + profileContext(request) +
      (webSearch ? publicWebSearchInstructions : request.webSearch ? noWebSearchInstructions : '') +
      (request.profile && !nativeFormat ? profileSchemaInstructions : '') }] },
    contents: input.map(turn => ({ role: turn.role === 'assistant' ? 'model' : 'user',
      parts: typeof turn.content === 'string' ? [{ text: turn.content }] : turn.content.map(part) })),
    ...(webSearch ? { tools: [{ google_search: {} }] } : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
  });
  if (!attachments.length) return json;
  // Keep large attachments chunked, as in the existing provider adapters.
  const pieces: BlobPart[] = [];
  let start = 0;
  for (const match of json.matchAll(/("(?:data|text)":)(\d+)(?=[,}])/g)) {
    const file = attachments[Number(match[2])];
    if (!file) throw Error('附件请求无效。');
    pieces.push(json.slice(start, match.index + match[1].length));
    if (file.textName !== undefined) {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
      if (text.length > 200000) throw Error('文本附件内容过长，请缩短后再发送。');
      pieces.push(JSON.stringify(`附件 ${file.textName}：\n${text}`));
    } else {
      pieces.push('"');
      for await (const chunk of base64Chunks(file.bytes, signal)) pieces.push(new Blob([chunk]));
      pieces.push('"');
    }
    start = match.index + match[0].length;
  }
  signal.throwIfAborted();
  pieces.push(json.slice(start));
  return new Blob(pieces, { type: 'application/json' });
}

function tokenUsage(value: unknown): TokenUsage | null {
  const usage = record(value);
  if (!usage) return null;
  const inputTokens = usage.promptTokenCount;
  const candidates = usage.candidatesTokenCount ?? 0;
  const thoughts = usage.thoughtsTokenCount ?? 0;
  if (![candidates, thoughts].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) return null;
  const outputTokens = Number(candidates) + Number(thoughts);
  const totalTokens = usage.totalTokenCount;
  return [inputTokens, outputTokens, totalTokens].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    ? { inputTokens: inputTokens as number, outputTokens, totalTokens: totalTokens as number } : null;
}

export function createGeminiChatService(
  provider: ModelProvider,
  credential: () => Promise<ApiCredential>,
  accountOf: (credential: ApiCredential) => string,
  ledger: UsageLedger,
  fetcher: typeof fetch,
): ApiChatService {
  const catalog = new ModelCatalog<GeminiModel>();
  const secretFor = (signal: AbortSignal) => abortable(credential(), AbortSignal.any([signal, AbortSignal.timeout(20000)]));
  const readModels = (secret: ApiCredential, force: boolean, signal: AbortSignal) =>
    catalog.read(accountOf(secret), force, signal, async deadline => {
      const models = new Map<string, GeminiModel>();
      const pages = new Set<string>();
      let pageToken = '';
      do {
        if (pages.has(pageToken) || pages.size >= 20) throw invalidCatalog();
        pages.add(pageToken);
        const url = new URL(base + '/models');
        url.searchParams.set('pageSize', '1000');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const response = await send(fetcher, url.href, {
          headers: { 'x-goog-api-key': secret.key }, cache: 'no-store', redirect: 'error',
        }, deadline);
        const payload = record(await boundedJson(response, 4 * 1024 * 1024, deadline).catch(() => {
          deadline.throwIfAborted();
          throw invalidCatalog();
        }));
        if (!Array.isArray(payload?.models)) throw invalidCatalog();
        for (const value of payload.models) {
          const model = parseModel(value, provider);
          if (model && !models.has(model.id)) models.set(model.id, model);
        }
        const token = payload.nextPageToken;
        if (token !== undefined && (typeof token !== 'string' || token.length > 4096)) throw invalidCatalog();
        pageToken = token ?? '';
      } while (pageToken);
      if (accountOf(await abortable(credential(), deadline)) !== accountOf(secret))
        throw Error('API 连接已更改，请重新选择模型。');
      return [...models.values()];
    });
  async function stream(request: ChatRequest, emit: (event: ChatEvent) => void, signal: AbortSignal) {
    const secret = await secretFor(signal);
    const model = (await readModels(secret, false, signal)).find(model => model.id === request.modelId);
    if (!model) throw Error('所选 API 模型当前不可用，请刷新模型列表。');
    if (request.effort && !model.reasoningEfforts?.includes(request.effort))
      throw Error('所选模型不支持该思考强度，请选择自动或刷新模型列表。');
    const webSearch = request.webSearch && !!request.profile && model.webSearch;
    const body = await bodyFor(request, model, signal, webSearch);
    signal.throwIfAborted();
    emit({ id: request.id, type: 'provider', provider });
    let activities: ChatActivity[] = [];
    let phase: ChatActivity['phase'] | undefined;
    let sequence = 0;
    const publishActivity = (value: ChatActivity) => {
      activities = mergeActivityLog(activities, value);
      emit({ id: request.id, type: 'activity', activity: value });
    };
    const activity = (next: ChatActivity['phase'], completed = false) => {
      if (phase === next && !completed) return;
      if (phase) publishActivity({ id: `gemini-phase-${sequence}`, kind: 'status', phase, status: 'completed' });
      if (!completed) {
        phase = next;
        publishActivity({ id: `gemini-phase-${++sequence}`, kind: 'status', phase, status: 'in_progress' });
      }
    };
    activity('waiting');
    let retried = false;
    const generate = (payload: string | Blob) => send(fetcher,
      `${base}/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse`, {
        method: 'POST', headers: { 'x-goog-api-key': secret.key, 'content-type': 'application/json', accept: 'text/event-stream' },
        cache: 'no-store', redirect: 'error', body: payload,
      }, signal, () => {
        retried = true;
        publishActivity({ id: 'gemini-retry', kind: 'status', phase: 'processing', status: 'in_progress', detail: '模型服务繁忙，正在自动重试' });
      });
    // A free tier can run out of Google Search grounding while the model itself still
    // answers. Nothing has streamed yet, so ask again without search and say so.
    let searched = webSearch;
    let response: Response;
    try {
      response = await generate(body);
    } catch (error) {
      if (!webSearch || !(error instanceof ChatServiceError) || error.detail.status !== 429) throw error;
      searched = false;
      publishActivity({ id: 'gemini-search-quota', kind: 'status', phase: 'processing', status: 'in_progress', detail: 'Google 搜索额度已用完，改为不联网回答' });
      response = await generate(await bodyFor(request, model, signal, false));
    }
    if (retried)
      publishActivity({ id: 'gemini-retry', kind: 'status', phase: 'processing', status: 'completed', detail: '模型服务繁忙，已自动重试' });
    const profile = request.profile ? new ProfileAnswerStream(true) : undefined;
    using previews = profile && new ProfilePreviews(request.id, emit, signal);
    const sources = new Map<string, ChatSource>();
    let answerText = '', responseId = randomUUID(), finishReason = '';
    let outputLength = 0;
    let usage: TokenUsage | null = null;
    let streamFailure: unknown;
    let blocked = false;
    let completedSearch = false;
    let googleSearchSuggestions: string | undefined;
    try {
      for await (const event of responseEvents(response, signal)) {
        if (event.error) {
          streamFailure = geminiFailure(typeof event.error.code === 'number' ? event.error.code : undefined, event);
          break;
        }
        if (typeof event.responseId === 'string' && /^[\w.:-]{1,200}$/.test(event.responseId)) responseId = event.responseId;
        usage = tokenUsage(event.usageMetadata) ?? usage;
        if (event.promptFeedback?.blockReason) blocked = true;
        const candidate = Array.isArray(event.candidates) ? event.candidates.find((value: any) => !value.index) : undefined;
        if (!candidate) continue;
        const grounding = searched && record(candidate.groundingMetadata);
        if (grounding) {
          const html = record(grounding.searchEntryPoint)?.renderedContent;
          if (typeof html === 'string' && html.trim() && html.length <= GOOGLE_SEARCH_SUGGESTIONS_LIMIT && html !== googleSearchSuggestions) {
            googleSearchSuggestions = html;
            emit({ id: request.id, type: 'google-search-suggestions', html });
          }
          const previousSize = sources.size;
          for (const chunk of Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks : []) {
            const web = record(record(chunk)?.web);
            const source = web && validSource({ url: web.uri, title: web.title });
            const key = source && sourceKey(source.url);
            if (source && key && sources.size < 300 && !sources.has(key)) sources.set(key, source);
          }
          const searched = sources.size > 0 || (typeof html === 'string' && !!html.trim()) ||
            (Array.isArray(grounding.webSearchQueries) && grounding.webSearchQueries.some(query => typeof query === 'string' && query.trim()));
          if (searched && !completedSearch) {
            completedSearch = true;
            emit({ id: request.id, type: 'search' });
            publishActivity({ id: 'gemini-google-search', kind: 'web_search', phase: 'searching', status: 'completed' });
          }
          if (sources.size !== previousSize) emit({ id: request.id, type: 'sources', sources: [...sources.values()] });
        }
        for (const part of Array.isArray(candidate.content?.parts) ? candidate.content.parts : []) {
          if (typeof part.text !== 'string' || !part.text) continue;
          if (part.thought === true) {
            activity('thinking');
          } else {
            outputLength += part.text.length;
            if (outputLength > 1000000) throw Error('回答过长，已停止接收。');
            const delta = profile ? profile.append(part.text) : part.text;
            activity(profile?.answerComplete ? 'organizing' : 'writing');
            answerText += delta;
            if (delta) emit({ id: request.id, type: 'delta', text: delta });
            previews?.update(profile);
          }
        }
        if (typeof candidate.finishReason === 'string') finishReason = candidate.finishReason;
      }
    } catch (error) {
      streamFailure = error;
    }
    signal.throwIfAborted();
    let warning: string | undefined;
    if (usage) {
      try { await ledger.add(accountOf(secret), responseId, usage); }
      catch { warning = '回答已接收，但本机用量保存失败。'; }
    }
    if (webSearch && !searched) warning ??= 'Google 搜索额度已用完，本次未联网回答。';
    signal.throwIfAborted();
    if (completedSearch && !googleSearchSuggestions)
      throw new ChatServiceError({ code: 'grounding_suggestions_missing', message: 'Google 搜索建议未完整返回，请重试。', discardPartial: true });
    if (streamFailure) throw streamFailure;
    if (blocked) finishReason = 'SAFETY';
    if (finishReason && finishReason !== 'STOP') {
      if (finishReason === 'MAX_TOKENS') throw new ChatServiceError({ code: 'length', message: '模型的回答达到输出长度上限，请缩短请求后重试。' });
      if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'].includes(finishReason))
        throw new ChatServiceError({ code: 'content_filter', message: '模型服务拒绝了这次请求。', discardPartial: true });
      throw new ChatServiceError({ code: 'incomplete_response', message: '回答未完整返回，已保留收到的内容，请重试。' });
    }
    if (!finishReason) throw new ChatServiceError({ code: 'connection_closed', message: '回答连接提前中断，已保留接收内容；用量可能尚未返回。' });
    previews?.flush();
    const proposal = profile && request.profile ? profile.finish(request.profile) : undefined;
    if (proposal?.delta) {
      answerText += proposal.delta;
      emit({ id: request.id, type: 'delta', text: proposal.delta });
    }
    const skillSourceIssues = verifySkillProposal(request, proposal?.changes, sources, completedSearch, proposal?.skillScope);
    if (!answerText.trim() && !Object.keys(proposal?.changes ?? {}).length)
      throw new ChatServiceError({ code: 'empty_response', message: '未收到有效回答，请重试。' });
    if (phase) activity(phase, true);
    return { provider, answerText, usage, sources: [...sources.values()], googleSearchSuggestions, warning,
      profileChanges: proposal?.changes, skillSourceIssues, activities };
  }
  return {
    invalidateModels: () => catalog.clear(),
    async models(force = false, caller?: AbortSignal) {
      const signal = catalog.signal(caller);
      return readModels(await secretFor(signal), force, signal);
    },
    usage: async () => ledger.get(accountOf(await credential())),
    resetUsage: async () => ledger.reset(accountOf(await credential())),
    async stream(value, emit, caller) {
      const signal = catalog.signal(caller);
      try { return await recoverApiProfileOutput(validateRequest(value), emit, signal, stream, 'preview'); }
      catch (error) {
        if (!signal.aborted && invalidatesModelCatalog(error)) catalog.expire();
        throw error;
      }
    },
  };
}
