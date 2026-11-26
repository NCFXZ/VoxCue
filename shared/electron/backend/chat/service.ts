import { ReasoningSummary } from './summary';
import { prepareResponseInput, encodeAttachmentBody, noWebSearchInstructions } from './input';
export { buildInput } from './input';
import { mergeActivityLog, type ChatActivity } from '../../contracts/activity';
import { chatGPTProvider } from '../../contracts/chat';
import type { ChatEvent, ChatSource, ModelProvider, TokenUsage } from '../../contracts/chat';
import type { AIChatService } from './ports';
import { apiError, ChatServiceError, invalidatesModelCatalog, networkFailure } from './errors';
import { validateRequest, validSource, sourceKey } from './validation';
export { apiError, publicFailure, ChatServiceError } from './errors';
export { validateRequest, validSource } from './validation';
import { responseEvents, requestResponse, readErrorResponse } from './responses';
import { responseActivity } from './activity';
import { ResponseText } from './responseText';
import { invalidCatalog, openAIModels, type OpenAIAccess, type OpenAIModel } from './models';
import { ModelCatalog } from './modelCatalog';
import { profileFormat, profileContext, profileSchemaInstructions, ProfileAnswerStream } from './profile';
import { recoverApiProfileOutput } from './profileRecovery';
import { ProfilePreviews } from './profilePreviews';
import { verifySkillProposal } from './proposal';
import type { UsageLedger } from './usage';
import type { ChatGPTAccountUsage } from './accountUsage';
import { boundedJson } from '../boundedJson';
import { abortable } from '../cancellable';
import { ProviderCredentialUnavailable } from '../auth/providerCredentialAccess';
const apiBase = 'https://api.openai.com/v1';
const managedBase = 'https://chatgpt.com/backend-api/codex';
export function parseUsage(value: any): TokenUsage | null {
  if (
    !value ||
    !['input_tokens', 'output_tokens', 'total_tokens'].every(
      (key) => Number.isSafeInteger(value[key]) && value[key] >= 0,
    )
  )
    return null;
  return {
    inputTokens: value.input_tokens,
    outputTokens: value.output_tokens,
    totalTokens: value.total_tokens,
  };
}
interface Dependencies {
  access(): Promise<OpenAIAccess>;
  ledger: UsageLedger;
  idleTimeoutMs?: number;
  responseHeadersTimeoutMs?: number;
  fetch?: typeof fetch;
  accountUsage?: ChatGPTAccountUsage;
  provider?: ModelProvider;
  apiKeyEndpoint?: {
    base: string;
    webSearchInstructions: string;
    models(payload: unknown, provider: ModelProvider): OpenAIModel[];
    /** Long-reasoning providers regenerate visibly instead of within the short buffered window. */
    profileRecovery?: 'preview';
  };
  failure?: typeof apiError;
}
export class ChatGPTService implements AIChatService {
  private catalog = new ModelCatalog<OpenAIModel>();
  constructor(private dependencies: Dependencies) {}
  invalidateModels() {
    this.catalog.clear();
  }
  private async connection(signal: AbortSignal) {
    signal.throwIfAborted();
    const access = await abortable(this.dependencies.access(), signal).catch((error) => {
      if (error instanceof ProviderCredentialUnavailable) this.invalidateModels();
      else if (!signal.aborted) this.catalog.expire();
      throw error;
    });
    const managed = access.kind === 'codex';
    if (!managed && access.kind !== 'api-key')
      throw new Error('OpenAI 授权类型无效，请重新连接模型服务。');
    const base = managed ? managedBase : this.dependencies.apiKeyEndpoint?.base ?? apiBase;
    const catalogURL = new URL(`${base}/models`);
    // Report the same native runtime version used for login and quota.
    if (managed) catalogURL.searchParams.set('client_version', access.runtimeVersion);
    return {
      account: access.account,
      kind: access.kind,
      base,
      catalogURL: catalogURL.href,
      headers: {
        authorization: `Bearer ${access.token}`,
        ...(managed ? { 'ChatGPT-Account-Id': access.chatgptAccountId, originator: 'voxcue' } : {}),
      },
    };
  }
  private async checked(response: Response, signal: AbortSignal) {
    if (!response.ok) {
      const body = await readErrorResponse(response, signal, this.dependencies.idleTimeoutMs);
      throw (this.dependencies.failure ?? apiError)(response.status, body, response.headers.get('x-request-id') ?? undefined);
    }
    return response;
  }
  async models(force = false, caller?: AbortSignal) {
    const signal = this.catalog.signal(caller);
    const connection = await this.connection(AbortSignal.any([signal, AbortSignal.timeout(20000)]));
    return this.readModels(connection, force, signal);
  }
  private readModels(
    {
      account,
      kind,
      catalogURL,
      headers,
    }: Awaited<ReturnType<ChatGPTService['connection']>>,
    force: boolean,
    signal: AbortSignal,
  ) {
    return this.catalog.read(`${kind}:${account}`, force, signal, async (deadline) => {
      const response = await this.checked(
        await (this.dependencies.fetch ?? fetch)(catalogURL, {
          headers,
          signal: deadline,
          redirect: 'error',
          cache: 'no-store',
        }).catch((error) => {
          throw networkFailure(error);
        }),
        deadline,
      );
      const payload = await boundedJson(response, 4 * 1024 * 1024, deadline).catch(() => {
        if (deadline.aborted) throw deadline.reason;
        throw invalidCatalog();
      });
      const latest = await abortable(this.dependencies.access(), deadline);
      if (latest.kind !== kind || latest.account !== account)
        throw new Error('账户已变更，请重新刷新模型列表。');
      const { apiKeyEndpoint, provider = chatGPTProvider } = this.dependencies;
      return kind === 'api-key' && apiKeyEndpoint
        ? apiKeyEndpoint.models(payload, provider)
        : openAIModels(payload, latest, provider);
    });
  }
  async resetUsage() {
    const { account } = await this.dependencies.access();
    return this.dependencies.ledger.reset(account);
  }
  accountUsage() {
    return this.dependencies.accountUsage?.read() ?? Promise.resolve(null);
  }
  async usage() {
    const { account } = await this.dependencies.access();
    return this.dependencies.ledger.get(account);
  }
  async stream(value: unknown, emit: (event: ChatEvent) => void, signal: AbortSignal) {
    const scope = this.catalog.signal(signal);
    try {
      if (this.dependencies.provider)
        return await recoverApiProfileOutput(validateRequest(value), emit, scope,
          (request, publish, attemptSignal) => this.run(request, publish, attemptSignal),
          this.dependencies.apiKeyEndpoint?.profileRecovery);
      return await this.run(value, emit, scope);
    } catch (error) {
      if (!scope.aborted && invalidatesModelCatalog(error)) this.catalog.expire();
      throw error;
    }
  }
  private async run(value: unknown, emit: (event: ChatEvent) => void, signal: AbortSignal) {
    const request = validateRequest(value);
    signal.throwIfAborted();
    const connection = await this.connection(AbortSignal.any([signal, AbortSignal.timeout(20000)]));
    const { account, base, headers } = connection;
    const models = await this.readModels(connection, false, signal);
    signal.throwIfAborted();
    const model = models.find((item) => item.id === request.modelId);
    if (!model) throw new Error('所选模型当前不可用，请刷新模型列表。');
    if (request.effort && !model.reasoningEfforts?.includes(request.effort))
      throw new Error('所选模型不支持该思考强度，请选择自动或刷新模型列表。');
    const { input, attachments } = prepareResponseInput(request);
    if (model.fileInput === false && input.some(turn =>
      Array.isArray(turn.content) && turn.content.some(part => part.type === 'input_file')))
      throw Error('该 API 连接支持文本和所选模型可读取的图片，请将文档转换成纯文本再发送。');
    if (
      model.imageInput === false &&
      input.some(
        (turn) =>
          Array.isArray(turn.content) && turn.content.some((part) => part.type === 'input_image'),
      )
    )
      throw new Error('所选模型不支持图片输入，请移除图片或更换模型。');
    const summaryEnabled = model.reasoningSummary && request.effort !== 'none';
    const webSearch = request.webSearch && model.webSearch === true;
    const provider = this.dependencies.provider ?? chatGPTProvider;
    emit({ id: request.id, type: 'provider', provider });
    // Active reasoning, searches and heartbeats can legitimately exceed three minutes.
    // Header waiting and stream inactivity have independent, cancellable limits.
    const deadline = signal;
    let completedWebSearch = false;
    let activities: ChatActivity[] = [];
    let phase: ChatActivity['phase'] | undefined;
    let phaseId = '',
      phaseSequence = 0;
    const recordActivity = (activity: ChatActivity) => {
      activities = mergeActivityLog(activities, activity);
      emit({ id: request.id, type: 'activity', activity });
    };
    const publishActivity = (activity: ChatActivity, trackPhase = true) => {
      const known = activity.id && activities.some((entry) => entry.id === activity.id);
      if (trackPhase && !known && activity.phase !== phase) {
        if (phase) recordActivity({ id: phaseId, kind: 'status', phase, status: 'completed' });
        phase = activity.phase;
        phaseId = `progress-state-${++phaseSequence}`;
        recordActivity({ id: phaseId, kind: 'status', phase, status: 'in_progress' });
      }
      recordActivity(activity);
    };
    {
      deadline.throwIfAborted();
      const json = JSON.stringify({
        model: request.modelId,
        instructions: request.instructions + profileContext(request) +
          (webSearch ? this.dependencies.apiKeyEndpoint?.webSearchInstructions ?? '' : '') +
          (request.webSearch && !webSearch ? noWebSearchInstructions : '') +
          (request.profile && !model.nativeProfileFormat ? profileSchemaInstructions : ''),
        input,
        store: false,
        stream: true,
        ...(request.profile && model.nativeProfileFormat ? { text: profileFormat } : {}),
        ...(request.effort || summaryEnabled
          ? {
              reasoning: {
                ...(request.effort ? { effort: request.effort } : {}),
                ...(summaryEnabled ? { summary: 'auto' } : {}),
              },
            }
          : {}),
        ...(webSearch
          ? {
              tools: [{ type: 'web_search' }],
              tool_choice: 'auto',
              include: ['web_search_call.action.sources'],
            }
          : {}),
      });
      const body = attachments.length ? await encodeAttachmentBody(json, attachments, deadline) : json;
      deadline.throwIfAborted();
      const response = await this.checked(
        await requestResponse(
          this.dependencies.fetch ?? fetch,
          `${base}/responses`,
          {
            method: 'POST',
            headers: {
              ...headers,
              'content-type': 'application/json',
              accept: 'text/event-stream',
            },
            body,
            redirect: 'error',
          },
          deadline,
          this.dependencies.responseHeadersTimeoutMs,
        ),
        deadline,
      );
      const sources = new Map<string, ChatSource>();
      let usage: TokenUsage | null = null, completed = false;
      let warning: string | undefined;
      const streamedItems = new Map<number, Record<string, any>>();
      const commentary = new Map<number, string>();
      const publishCommentary = (index: number, item: any, text: string, completed = false) => {
        if (typeof item?.id !== 'string' || !/^[\w-]{1,160}$/.test(item.id) || !text.trim()) return;
        const detail = text.slice(0, 4096);
        commentary.set(index, detail);
        publishActivity(
          {
            id: item.id,
            kind: 'commentary',
            phase: 'processing',
            detail,
            status: completed ? 'completed' : 'in_progress',
          },
          false,
        );
      };
      let sourcesChanged = false;
      const publishSources = () => {
        if (!sourcesChanged) return;
        emit({ id: request.id, type: 'sources', sources: [...sources.values()] });
        sourcesChanged = false;
      };
      const addSource = (value: unknown) => {
        const source = validSource(value);
        const key = source && sourceKey(source.url);
        if (!source || !key) return;
        const previous = sources.get(key);
        if (!previous && sources.size >= 300) return;
        if (previous?.url === source.url && previous.title === source.title) return;
        sources.set(key, source);
        sourcesChanged = true;
      };
      const collectSources = (item: any) => {
        for (const content of item?.content ?? [])
          for (const annotation of content?.annotations ?? []) addSource(annotation);
        if (item?.type !== 'web_search_call' || item.status !== 'completed') return;
        completedWebSearch = true;
        for (const source of item.action?.sources ?? []) addSource(source);
        if (['open_page', 'find_in_page'].includes(item.action?.type))
          addSource({ url: item.action.url });
      };
      const summary = new ReasoningSummary();
      const publishedSummaries = new Map<string, string>();
      const publishSummaries = (itemId?: string) => {
        for (const part of summary.entries) {
          if (itemId !== undefined && !part.id.startsWith(`${itemId}:`)) continue;
          if (!part.text.trim() || publishedSummaries.get(part.id) === part.text) continue;
          const id = `public-summary-0-${part.id}`;
          if (!publishedSummaries.has(part.id)) publishActivity({ phase: 'thinking' });
          publishedSummaries.set(part.id, part.text);
          publishActivity({ id, kind: 'reasoning', phase: 'thinking', detail: part.text }, false);
        }
      };
      let outputLength = 0;
      let answerText = '';
      const streamedText = new ResponseText();
      const apiProfile = !!this.dependencies.provider;
      let profileStream = request.profile ? new ProfileAnswerStream(apiProfile) : undefined;
      using previews = profileStream && new ProfilePreviews(request.id, emit, deadline);
      let refused = false;
      let lastActivity = '';
      const receiveText = (text: string, refusal = false, publish = true) => {
        if (refusal) {
          refused = true;
          previews?.reset();
        }
        outputLength += text.length;
        if (outputLength > 1000000) throw new Error('回答过长，已停止接收。');
        const delta = profileStream && !refused ? profileStream.append(text) : text;
        if (!refused) previews?.update(profileStream);
        if (delta) {
          answerText += delta;
          if (publish) emit({ id: request.id, type: 'delta', text: delta });
        }
      };
      for await (const event of responseEvents(
        response,
        deadline,
        this.dependencies.idleTimeoutMs,
      )) {
        if (
          Number.isSafeInteger(event.output_index) &&
          event.output_index >= 0 &&
          event.output_index < 100
        ) {
          if (
            ['response.output_item.added', 'response.output_item.done'].includes(event.type) &&
            event.item &&
            typeof event.item === 'object' &&
            (event.type === 'response.output_item.done' || !streamedItems.get(event.output_index)?.done)
          )
            streamedItems.set(event.output_index, { ...event.item, done: event.type === 'response.output_item.done' });
        }
        const summaryChanged = summary.receive(event);
        if (summaryChanged) emit({ id: request.id, type: 'reasoning-summary', text: summary.text });
        const commentaryItem = streamedItems.get(event.output_index);
        const activity =
          commentaryItem?.phase === 'commentary' && event.type === 'response.output_text.delta'
            ? undefined
            : profileStream?.answerComplete && event.type === 'response.output_text.delta'
              ? { phase: 'organizing' as const }
              : responseActivity(event);
        if (activity && JSON.stringify(activity) !== lastActivity) {
          lastActivity = JSON.stringify(activity);
          publishActivity(activity);
        }
        if (
          summaryChanged &&
          !['response.completed', 'response.failed', 'response.incomplete'].includes(event.type)
        )
          publishSummaries();
        if (
          ['response.output_text.delta', 'response.refusal.delta'].includes(event.type) &&
          typeof event.delta === 'string'
        ) {
          const item = streamedItems.get(event.output_index);
          if (item?.type === 'message' && item.phase === 'commentary')
            publishCommentary(
              event.output_index,
              item,
              (commentary.get(event.output_index) ?? '') + event.delta,
            );
          else {
            const refusal = event.type === 'response.refusal.delta';
            receiveText(event.delta, refusal);
            streamedText.append(event.output_index, event.content_index, refusal, event.delta);
          }
        }
        if (
          event.type === 'response.output_item.done' &&
          event.item?.type === 'message' &&
          event.item.phase === 'commentary'
        )
          publishCommentary(
            event.output_index,
            event.item,
            (event.item.content ?? [])
              .filter((part: any) => part.type === 'output_text' && typeof part.text === 'string')
              .map((part: any) => part.text)
              .join(''),
            true,
          );
        if (profileStream?.answerComplete && event.type === 'response.output_text.delta') {
          const activity = { phase: 'organizing' as const };
          if (JSON.stringify(activity) !== lastActivity) {
            lastActivity = JSON.stringify(activity);
            publishActivity(activity);
          }
        }
        if (event.type === 'response.web_search_call.in_progress')
          emit({ id: request.id, type: 'search' });
        if (event.type === 'response.web_search_call.completed') completedWebSearch = true;
        if (event.type === 'response.output_text.annotation.added') addSource(event.annotation);
        if (event.type === 'response.output_item.done') collectSources(event.item);
        publishSources();
        if (['response.completed', 'response.failed', 'response.incomplete'].includes(event.type)) {
          const terminal = event.response;
          for (const [index, item] of (terminal?.output ?? []).entries()) {
            if (item.type === 'reasoning') publishSummaries(item.id);
            const action = responseActivity({ type: 'response.output_item.done', item });
            if (action?.id) publishActivity(action);
            if (item.type === 'message' && item.phase === 'commentary')
              publishCommentary(
                index,
                item,
                (item.content ?? [])
                  .filter(
                    (part: any) => part.type === 'output_text' && typeof part.text === 'string',
                  )
                  .map((part: any) => part.text)
                  .join(''),
                true,
              );
          }
          if (
            (terminal?.output ?? []).some(
              (item: any) => item.type === 'web_search_call' && item.status === 'completed',
            )
          )
            completedWebSearch = true;
          usage = parseUsage(terminal?.usage);
          if (usage && typeof terminal.id === 'string') {
            try {
              await this.dependencies.ledger.add(account, terminal.id, usage);
            } catch {
              warning = '回答已接收，但本机用量保存失败。';
            }
          }
          for (const item of terminal?.output ?? []) collectSources(item);
          publishSources();
          const successful = event.type === 'response.completed' && (!terminal?.status || terminal.status === 'completed');
          if (!outputLength || successful) {
            const { replace, parts } = streamedText.reconcile(terminal?.output ?? [], streamedItems);
            if (replace) {
              // The final result replaces the visible draft in both chat and interview.
              // Rebuild validated profile JSON without emitting the same answer twice.
              previews?.reset();
              if (profileStream) profileStream = new ProfileAnswerStream(apiProfile);
              answerText = '';
              outputLength = 0;
              refused = false;
            }
            for (const part of parts) receiveText(part.text, part.refusal, !replace);
          }
          if (event.type === 'response.failed')
            throw (this.dependencies.failure ?? apiError)(
              undefined,
              { error: terminal?.error },
              response.headers.get('x-request-id') ?? undefined,
            );
          if (
            event.type === 'response.incomplete' ||
            (terminal?.status && terminal.status !== 'completed')
          )
            throw new Error('回答未完成，请检查已有内容后重试。');
          completed = true;
          break;
        }
        if (event.type === 'error')
          throw (this.dependencies.failure ?? apiError)(undefined, event, response.headers.get('x-request-id') ?? undefined);
      }
      signal.throwIfAborted();
      if (!completed)
        throw new ChatServiceError({
          code: 'connection_closed',
          message: '回答连接提前中断，已保留接收内容；用量可能尚未返回。',
        });
      previews?.flush();
      const proposal =
        profileStream && request.profile && !refused
          ? profileStream.finish(request.profile)
          : undefined;
      const skillSourceIssues = verifySkillProposal(
        request,
        proposal?.changes,
        sources,
        completedWebSearch,
        proposal?.skillScope,
      );
      if (proposal?.delta) {
        answerText += proposal.delta;
        emit({ id: request.id, type: 'delta', text: proposal.delta });
      }
      if (!answerText.trim() && !Object.keys(proposal?.changes ?? {}).length)
        throw new ChatServiceError({ code: 'empty_response', message: '未收到有效回答，请重试。' });
      if (phase) recordActivity({ id: phaseId, kind: 'status', phase, status: 'completed' });
      return {
        usage,
        provider,
        sources: [...sources.values()],
        warning,
        profileChanges: proposal?.changes,
        skillSourceIssues,
        reasoningSummary: summary.text.trim() || undefined,
        activities: activities.length ? activities : undefined,
        answerText: answerText,
      };
    }
  }
}
