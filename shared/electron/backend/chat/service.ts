import { ReasoningSummary } from './summary';
import { mergeActivityLog, type ChatActivity } from '../../contracts/activity';
import { chatGPTProvider } from '../../contracts/chat';
import type {
  ChatRequest,
  ChatModel,
  ChatEvent,
  ChatSource,
  TokenUsage,
} from '../../contracts/chat';
import type { AIChatService } from './ports';
import { apiError, ChatServiceError, networkFailure } from './errors';
import { validateRequest, validSource, sourceKey } from './validation';
export { apiError, publicFailure, ChatServiceError } from './errors';
export { validateRequest, validSource } from './validation';
import { responseEvents, requestResponse, readErrorResponse } from './responses';
import { responseActivity } from './activity';
import { modelEfforts } from './models';
import { profileFormat, profileContext, ProfileAnswerStream } from './profile';
import { verifySkillProposal } from './proposal';
import type { UsageLedger } from './usage';
import type { ChatGPTAccountUsage } from './accountUsage';
import { boundedJson } from '../boundedJson';
import { abortable } from '../cancellable';
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
const mimeTypes: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
export function buildInput(request: ChatRequest) {
  return request.turns.map((turn) => {
    if (!turn.files?.length) return { role: turn.role, content: turn.content };
    const content: Record<string, string>[] = [{ type: 'input_text', text: turn.content }];
    for (const file of turn.files) {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (['txt', 'md'].includes(extension)) {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
        if (text.length > 200000) throw new Error('文本附件内容过长，请缩短后再发送。');
        content.push({ type: 'input_text', text: `附件 ${file.name}：\n${text}` });
      } else {
        const mime = mimeTypes[extension];
        if (!mime) throw new Error('不支持的附件格式。');
        const data = `data:${mime};base64,${Buffer.from(file.bytes).toString('base64')}`;
        content.push(
          mime.startsWith('image/')
            ? { type: 'input_image', image_url: data }
            : { type: 'input_file', filename: file.name.split(/[\\/]/).pop()!, file_data: data },
        );
      }
    }
    return { role: turn.role, content };
  });
}
interface Dependencies {
  access(): Promise<{ token: string; account: string; chatgptAccountId?: string }>;
  ledger: UsageLedger;
  idleTimeoutMs?: number;
  responseHeadersTimeoutMs?: number;
  fetch?: typeof fetch;
  accountUsage?: ChatGPTAccountUsage;
}
export class ChatGPTService implements AIChatService {
  private catalog: { account: string; at: number; models: ChatModel[] } | undefined;
  constructor(private dependencies: Dependencies) {}
  private async connection() {
    const access = await this.dependencies.access();
    const managed = !!access.chatgptAccountId;
    return {
      account: access.account,
      base: managed ? managedBase : apiBase,
      managed,
      headers: {
        authorization: `Bearer ${access.token}`,
        ...(managed
          ? { 'ChatGPT-Account-Id': access.chatgptAccountId!, originator: 'voxcue' }
          : {}),
      },
    };
  }
  private async checked(response: Response, signal = AbortSignal.timeout(20000)) {
    if (!response.ok) {
      const body = await readErrorResponse(response, signal, this.dependencies.idleTimeoutMs);
      throw apiError(response.status, body, response.headers.get('x-request-id') ?? undefined);
    }
    return response;
  }
  async models(force = false): Promise<ChatModel[]> {
    const { account, base, headers, managed } = await this.connection();
    if (!force && this.catalog?.account === account && Date.now() - this.catalog.at < 300000)
      return this.catalog.models;
    const response = await this.checked(
      await (this.dependencies.fetch ?? fetch)(
        `${base}/models${managed ? '?client_version=0.164.0' : ''}`,
        {
          headers,
          signal: AbortSignal.timeout(20000),
          redirect: 'error',
        },
      ).catch((error) => {
        throw networkFailure(error);
      }),
    );
    const data = (await boundedJson(response, 4 * 1024 * 1024).catch((error) => {
      if (error instanceof SyntaxError) throw new Error('模型列表响应无效，请重试。');
      throw networkFailure(error);
    })) as any;
    if (!Array.isArray(data.models)) throw new Error('模型列表响应无效，请重试。');
    const ids = new Set<string>();
    const models: ChatModel[] = [];
    for (const model of data.models) {
      if (
        model.visibility !== 'list' ||
        typeof model.slug !== 'string' ||
        !/^[\w.:-]{1,160}$/.test(model.slug) ||
        typeof model.display_name !== 'string' ||
        ids.has(model.slug)
      )
        continue;
      ids.add(model.slug);
      models.push({
        id: model.slug,
        label: model.display_name.slice(0, 120),
        description: 'ChatGPT 账户可用模型',
        provider: { ...chatGPTProvider },
        reasoningEfforts: modelEfforts(model),
      });
    }
    if (!models.length) throw new Error('当前账户没有可用模型，请检查 ChatGPT 授权或套餐。');
    this.catalog = { account, at: Date.now(), models };
    return models;
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
    return this.run(value, emit, signal);
  }
  private async run(value: unknown, emit: (event: ChatEvent) => void, signal: AbortSignal) {
    const request = validateRequest(value);
    signal.throwIfAborted();
    const models = await abortable(this.models(), signal);
    signal.throwIfAborted();
    if (!models.some((model) => model.id === request.modelId))
      throw new Error('所选模型当前不可用，请刷新模型列表。');
    if (
      request.effort &&
      !models
        .find((model) => model.id === request.modelId)
        ?.reasoningEfforts?.includes(request.effort)
    )
      throw new Error('所选模型不支持该思考强度，请选择自动或刷新模型列表。');
    const { account, base, headers } = await abortable(this.connection(), signal);
    signal.throwIfAborted();
    const input: Record<string, unknown>[] = buildInput(request);
    emit({ id: request.id, type: 'provider', provider: { ...chatGPTProvider } });
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
            body: JSON.stringify({
              model: request.modelId,
              instructions: request.instructions + profileContext(request),
              input,
              store: false,
              stream: true,
              ...(request.profile ? { text: profileFormat } : {}),
              ...(request.effort ||
              (models.find((m) => m.id === request.modelId)?.reasoningEfforts?.length &&
                request.effort !== 'none')
                ? {
                    reasoning: {
                      ...(request.effort ? { effort: request.effort } : {}),
                      ...(models.find((m) => m.id === request.modelId)?.reasoningEfforts?.length &&
                      request.effort !== 'none'
                        ? { summary: 'auto' }
                        : {}),
                    },
                  }
                : {}),
              ...(request.webSearch
                ? {
                    tools: [{ type: 'web_search' }],
                    tool_choice: 'auto',
                    include: ['web_search_call.action.sources'],
                  }
                : {}),
            }),
            redirect: 'error',
          },
          deadline,
          this.dependencies.responseHeadersTimeoutMs,
        ),
        deadline,
      );
      const sources = new Map<string, ChatSource>();
      let usage: TokenUsage | null = null,
        completed = false,
        warning: string | undefined;
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
      const profileStream = request.profile ? new ProfileAnswerStream() : undefined;
      let refused = false;
      let lastActivity = '';
      let lastPreview = '';
      const receiveText = (text: string, refusal = false) => {
        if (refusal) refused = true;
        outputLength += text.length;
        if (outputLength > 1000000) throw new Error('回答过长，已停止接收。');
        const delta = profileStream && !refused ? profileStream.append(text) : text;
        const preview = !refused ? profileStream?.preview() : undefined;
        const previewState = JSON.stringify([preview, profileStream?.generation]);
        if (preview && previewState !== lastPreview) {
          lastPreview = previewState;
          emit({
            id: request.id,
            type: 'profile-preview',
            preview,
            generation: profileStream?.generation,
          });
        }
        if (delta) {
          answerText += delta;
          emit({ id: request.id, type: 'delta', text: delta });
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
            typeof event.item === 'object'
          )
            streamedItems.set(event.output_index, { ...event.item });
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
          else receiveText(event.delta, event.type === 'response.refusal.delta');
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
          if (!outputLength) {
            for (const content of (terminal?.output ?? [])
              .filter((item: any) => item.phase !== 'commentary')
              .flatMap((item: any) => item.content ?? [])) {
              if (content.type === 'output_text' && typeof content.text === 'string')
                receiveText(content.text);
              if (content.type === 'refusal' && typeof content.refusal === 'string')
                receiveText(content.refusal, true);
            }
          }
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
          if (event.type === 'response.failed')
            throw apiError(
              undefined,
              { error: terminal?.error },
              response.headers.get('x-request-id') ?? undefined,
            );
          if (event.type === 'response.incomplete')
            throw new Error('回答未完成，请检查已有内容后重试。');
          completed = true;
          break;
        }
        if (event.type === 'error')
          throw apiError(undefined, event, response.headers.get('x-request-id') ?? undefined);
      }
      signal.throwIfAborted();
      if (!completed)
        throw new ChatServiceError({
          code: 'connection_closed',
          message: '回答连接提前中断，已保留接收内容；用量可能尚未返回。',
        });
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
      if (phase) recordActivity({ id: phaseId, kind: 'status', phase, status: 'completed' });
      return {
        usage,
        provider: { ...chatGPTProvider },
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
