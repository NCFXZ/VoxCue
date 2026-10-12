import type {
  ChatRequest,
  ChatModel,
  ChatEvent,
  ChatSource,
  ChatFailure,
  TokenUsage,
} from '../../contracts/chat';
import { responseEvents } from './responses';
import { modelEfforts } from './models';
import { reasoningEfforts } from '../../contracts/chat';
import { validProfile } from '../../contracts/profile';
import { profileFormat, profileInstructions, ProfileAnswerStream } from './profile';
import type { UsageLedger } from './usage';
const base = 'https://api.openai.com/v1';
const messages: Record<string, string> = {
  subscription_sharing_user_not_eligible: '当前账户或工作区不支持 ChatGPT 套餐调用。',
  subscription_sharing_usage_limit_exceeded:
    '已达到当前应用或账户的使用限制，请查看 ChatGPT 账户用量。',
  subscription_sharing_usage_unavailable: '暂时无法检查账户用量，请稍后重试。',
  subscription_sharing_unsupported_capability:
    '当前模型或账户不支持这次请求的功能，请关闭网络搜索或更换模型后重试。',
  subscription_sharing_route_not_supported: '当前账户不支持该接口，请检查 ChatGPT 授权。',
  subscription_sharing_invalid_user: 'ChatGPT 授权无效，请退出后重新登录。',
};
export class ChatServiceError extends Error {
  constructor(public detail: ChatFailure) {
    super(detail.message);
  }
}
function diagnostic(value: unknown) {
  return typeof value === 'string' && /^[\w.:[\]-]{1,160}$/.test(value) ? value : undefined;
}
export function apiError(
  status: number | undefined,
  body: any,
  requestId?: string,
): ChatServiceError {
  const value = body?.error ?? body ?? {};
  const code = diagnostic(value.code),
    param = diagnostic(value.param);
  const message =
    (code && messages[code]) ||
    (status === 401
      ? 'ChatGPT 授权未被接受，请退出后重新登录。'
      : status === 403
        ? '账户权限、工作区或服务地区策略不允许此次请求。'
        : status === 429
          ? '请求受到使用限制，请稍后重试或查看账户用量。'
          : status === 400
            ? '模型不支持当前输入或工具，请更换模型或调整附件与搜索选项。'
            : 'ChatGPT 服务暂时不可用，请稍后重试。');
  // Never forward raw remote messages: they can contain user input or credentials.
  return new ChatServiceError({ message, code, param, status, requestId: diagnostic(requestId) });
}
export function publicFailure(error: unknown): ChatFailure {
  if (error instanceof ChatServiceError) return error.detail;
  if (error instanceof Error && error.name === 'AbortError')
    return { message: '回答已停止。', code: 'cancelled' };
  if (error instanceof Error && /[\u4e00-\u9fff]/.test(error.message))
    return { message: error.message };
  return { message: '连接中断或请求失败，请检查网络后重试。' };
}
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
  if (text > 200000 || bytes > 32 * 1024 * 1024 || files > 20)
    throw new Error('对话内容过多，请减少附件或开始新对话（上下文最多 20 个文件、合计 32 MB）。');
  if (request.turns.at(-1)?.role !== 'user') throw new Error('缺少用户问题。');
  return request;
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
  fetch?: typeof fetch;
}
export class ChatGPTService {
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
          ...(request.effort ? { reasoning: { effort: request.effort } } : {}),
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
    let outputLength = 0;
    const profileStream = request.profile ? new ProfileAnswerStream() : undefined;
    let refused = false;
    const receiveText = (text: string, refusal = false) => {
      if (refusal) refused = true;
      outputLength += text.length;
      if (outputLength > 1000000) throw new Error('回答过长，已停止接收。');
      const delta = profileStream && !refused ? profileStream.append(text) : text;
      if (delta) emit({ id: request.id, type: 'delta', text: delta });
    };
    for await (const event of responseEvents(response, signal)) {
      if (
        ['response.output_text.delta', 'response.refusal.delta'].includes(event.type) &&
        typeof event.delta === 'string'
      ) {
        receiveText(event.delta, event.type === 'response.refusal.delta');
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
    if (proposal?.delta) emit({ id: request.id, type: 'delta', text: proposal.delta });
    return { usage, sources: [...sources.values()], warning, profileChanges: proposal?.changes };
  }
}
