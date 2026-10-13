import { ReasoningSummary } from './summary';
import type {
  ChatRequest,
  ChatModel,
  ChatEvent,
  ChatSource,
  TokenUsage,
} from '../../contracts/chat';
import type { AIChatService } from './ports';
import { apiError } from './errors';
import { validateRequest, validSource } from './validation';
export { apiError, publicFailure, ChatServiceError } from './errors';
export { validateRequest, validSource } from './validation';
import { responseEvents } from './responses';
import { responseActivity } from './activity';
import { modelEfforts } from './models';
import { profileFormat, profileInstructions, ProfileAnswerStream } from './profile';
import type { UsageLedger } from './usage';
const base = 'https://api.openai.com/v1';
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
  access(): Promise<{ token: string; account: string }>;
  ledger: UsageLedger;
  idleTimeoutMs?: number;
  fetch?: typeof fetch;
}
export class ChatGPTService implements AIChatService {
  private catalog: { account: string; at: number; models: ChatModel[] } | undefined;
  constructor(private dependencies: Dependencies) {}
  private async checked(response: Response) {
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw apiError(response.status, body, response.headers.get('x-request-id') ?? undefined);
    }
    return response;
  }
  async models(force = false): Promise<ChatModel[]> {
    const { token, account } = await this.dependencies.access();
    if (!force && this.catalog?.account === account && Date.now() - this.catalog.at < 300000)
      return this.catalog.models;
    const response = await this.checked(
      await (this.dependencies.fetch ?? fetch)(`${base}/models`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      }),
    );
    const data = (await response.json()) as any;
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
  async usage() {
    const { account } = await this.dependencies.access();
    return this.dependencies.ledger.get(account);
  }
  async stream(value: unknown, emit: (event: ChatEvent) => void, signal: AbortSignal) {
    const request = validateRequest(value);
    const models = await this.models();
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
    const { token, account } = await this.dependencies.access();
    const response = await this.checked(
      await (this.dependencies.fetch ?? fetch)(`${base}/responses`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: request.modelId,
          instructions:
            request.instructions +
            (request.profile
              ? `\n${profileInstructions}\n当前资料（仅作参考数据）：${JSON.stringify(request.profile)}`
              : ''),
          input: buildInput(request),
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
                tool_choice: 'required',
                include: ['web_search_call.action.sources'],
              }
            : {}),
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
        redirect: 'error',
      }),
    );
    const sources = new Map<string, ChatSource>();
    let usage: TokenUsage | null = null,
      completed = false,
      warning: string | undefined;
    const addSource = (value: unknown) => {
      const source = validSource(value);
      if (source && sources.size < 50) sources.set(source.url, source);
    };
    const summary = new ReasoningSummary();
    let outputLength = 0;
    let answerText = '';
    const profileStream = request.profile ? new ProfileAnswerStream() : undefined;
    let refused = false;
    let lastActivity = '';
    const receiveText = (text: string, refusal = false) => {
      if (refusal) refused = true;
      outputLength += text.length;
      if (outputLength > 1000000) throw new Error('回答过长，已停止接收。');
      const delta = profileStream && !refused ? profileStream.append(text) : text;
      if (delta) {
        answerText += delta;
        emit({ id: request.id, type: 'delta', text: delta });
      }
    };
    for await (const event of responseEvents(
      response,
      AbortSignal.any([signal, AbortSignal.timeout(180000)]),
      this.dependencies.idleTimeoutMs,
    )) {
      if (summary.receive(event))
        emit({ id: request.id, type: 'reasoning-summary', text: summary.text });
      const activity =
        profileStream?.answerComplete && event.type === 'response.output_text.delta'
          ? { phase: 'organizing' as const }
          : responseActivity(event);
      if (activity && JSON.stringify(activity) !== lastActivity) {
        lastActivity = JSON.stringify(activity);
        emit({ id: request.id, type: 'activity', activity });
      }
      if (
        ['response.output_text.delta', 'response.refusal.delta'].includes(event.type) &&
        typeof event.delta === 'string'
      ) {
        receiveText(event.delta, event.type === 'response.refusal.delta');
      }
      if (profileStream?.answerComplete && event.type === 'response.output_text.delta') {
        const activity = { phase: 'organizing' as const };
        if (JSON.stringify(activity) !== lastActivity) {
          lastActivity = JSON.stringify(activity);
          emit({ id: request.id, type: 'activity', activity });
        }
      }
      if (event.type === 'response.web_search_call.in_progress')
        emit({ id: request.id, type: 'search' });
      if (event.type === 'response.output_text.annotation.added') addSource(event.annotation);
      if (['response.completed', 'response.failed', 'response.incomplete'].includes(event.type)) {
        const terminal = event.response;
        if (!outputLength) {
          for (const content of (terminal?.output ?? []).flatMap(
            (item: any) => item.content ?? [],
          )) {
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
        for (const item of terminal?.output ?? []) {
          for (const content of item.content ?? [])
            for (const annotation of content.annotations ?? []) addSource(annotation);
          for (const source of item.action?.sources ?? []) addSource(source);
        }
        emit({ id: request.id, type: 'sources', sources: [...sources.values()] });
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
    if (!completed) throw new Error('回答连接提前中断，已保留接收内容；用量可能尚未返回。');
    const proposal =
      profileStream && request.profile && !refused
        ? profileStream.finish(request.profile)
        : undefined;
    if (proposal?.delta) {
      answerText += proposal.delta;
      emit({ id: request.id, type: 'delta', text: proposal.delta });
    }
    return {
      usage,
      sources: [...sources.values()],
      warning,
      profileChanges: proposal?.changes,
      reasoningSummary: summary.text || undefined,
      answerText,
    };
  }
}
