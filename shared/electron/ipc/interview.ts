import type { AIChatService } from '../backend/chat/ports';
import { publicFailure, ChatServiceError } from '../backend/chat/errors';
import { retryableChatError } from '../application/chatRetry';
import type { InterviewAnswerRequest, InterviewConfiguration } from '../contracts/speech';
import { reasoningEfforts, type ChatFile, type ChatModel } from '../contracts/chat';
import { InterviewContext, interviewInstructions } from '../application/interviewContext';
import { handleDesktop, sendDesktop } from './handle';
import { randomUUID } from 'node:crypto';
import type { InterviewImage } from '../contracts/interviewImages';
import type { Telemetry } from '../backend/telemetry/service';
export function registerInterviewIpc(d: {
  chat: AIChatService;
  telemetry?: Pick<Telemetry, 'answer'>;
  requireInterview: (e: Electron.IpcMainInvokeEvent) => void;
  isDemo: () => boolean;
  configuration: () => InterviewConfiguration | undefined;
  updateModel: (
    value: unknown,
    models: ChatModel[],
  ) => Pick<InterviewConfiguration, 'modelId' | 'effort'>;
  context: InterviewContext;
  captureScreen: (signal: AbortSignal) => Promise<{ file: ChatFile; preview: string }>;
  archiveImages: (
    images: { id: string; preview: string; file: ChatFile }[],
  ) => Promise<InterviewImage[]>;
}) {
  let active: { id: string; controller: AbortController } | undefined;
  let capture: AbortController | undefined;
  const screenshots = new Map<string, { file: ChatFile; preview: string }>();
  const clearScreenshots = () => {
    capture?.abort();
    capture = undefined;
    screenshots.clear();
  };
  handleDesktop('interview:screenshot', async (e, call) => {
    d.requireInterview(e);
    if (
      !call ||
      typeof call !== 'object' ||
      !['capture', 'remove', 'clear', 'archive'].includes(call.op) ||
      Object.keys(call).some(
        (key) =>
          ![
            'op',
            ...(call.op === 'remove' ? ['id'] : call.op === 'archive' ? ['ids'] : []),
          ].includes(key),
      ) ||
      (call.op === 'remove' && (typeof call.id !== 'string' || call.id.length > 100)) ||
      (call.op === 'archive' &&
        (!Array.isArray(call.ids) ||
          !call.ids.length ||
          call.ids.length > 5 ||
          new Set(call.ids).size !== call.ids.length ||
          call.ids.some((id) => typeof id !== 'string' || !screenshots.has(id))))
    )
      throw Error('Invalid screenshot operation');
    if (call.op === 'clear') {
      clearScreenshots();
      return { ok: true };
    }
    if (call.op === 'remove') {
      screenshots.delete(call.id);
      return { ok: true };
    }
    if (d.isDemo() || !d.configuration()?.aiEnabled)
      return { ok: false, error: { message: '截图回答需要先连接模型服务。' } };
    if (call.op === 'archive') {
      const images = call.ids.map((id) => ({ id, ...screenshots.get(id)! }));
      try {
        const saved = await d.archiveImages(images);
        d.requireInterview(e);
        return { ok: true, images: saved };
      } catch {
        return { ok: false, error: { message: '截图保存失败，请检查本机存储空间后重试。' } };
      }
    }
    if (capture || screenshots.size >= 5)
      return {
        ok: false,
        error: { message: capture ? '正在截取图像，请稍候。' : '最多可暂存5张截图。' },
      };
    const controller = new AbortController();
    capture = controller;
    try {
      const { file, preview } = await d.captureScreen(controller.signal);
      controller.signal.throwIfAborted();
      if (capture !== controller || e.sender.isDestroyed())
        throw new DOMException('Aborted', 'AbortError');
      const id = randomUUID();
      screenshots.set(id, { file, preview });
      return { ok: true, screenshot: { id, preview } };
    } catch (error) {
      return { ok: false, error: publicFailure(error) };
    } finally {
      if (capture === controller) capture = undefined;
    }
  });
  handleDesktop('interview:models', async (e) => {
    d.requireInterview(e);
    try {
      return { ok: true, models: d.isDemo() ? [] : await d.chat.models(false) };
    } catch (error) {
      return { ok: false, error: publicFailure(error) };
    }
  });
  handleDesktop('interview:account-usage', async (e, ...args) => {
    d.requireInterview(e);
    if (!e.senderFrame || e.senderFrame !== e.sender.mainFrame) throw Error('Unauthorized frame');
    if (args.length) throw Error('Invalid request');
    if (d.isDemo() || !d.configuration()?.aiEnabled) return { ok: true, usage: null };
    try {
      const usage = (await d.chat.accountUsage?.()) ?? null;
      d.requireInterview(e);
      return { ok: true, usage: d.configuration()?.aiEnabled ? usage : null };
    } catch (error) {
      return { ok: false, error: publicFailure(error) };
    }
  });
  handleDesktop('interview:update-model', async (e, value) => {
    d.requireInterview(e);
    const configuration = d.configuration();
    try {
      if (!configuration?.aiEnabled || d.isDemo()) throw Error('请先连接模型服务。');
      const models = await d.chat.models(false);
      d.requireInterview(e);
      if (!d.configuration()) throw Error('面试已结束。');
      // Each answer already owns a request/configuration snapshot. Updating
      // defaults here affects later questions without aborting that stream.
      return { ok: true, ...d.updateModel(value, models) };
    } catch (error) {
      return { ok: false, error: publicFailure(error) };
    }
  });
  handleDesktop('interview:cancel', (e, id) => {
    d.requireInterview(e);
    if (typeof id === 'string' && active?.id === id) active.controller.abort();
  });
  handleDesktop('interview:answer', async (e, value: unknown) => {
    d.requireInterview(e);
    const v = value as InterviewAnswerRequest;
    const ids = v?.screenshotIds === undefined ? [] : v.screenshotIds;
    if (
      !v ||
      typeof v !== 'object' ||
      typeof v.id !== 'string' ||
      !/^[\w-]{1,100}$/.test(v.id) ||
      (v.question !== undefined && (typeof v.question !== 'string' || v.question.length > 6000)) ||
      !Array.isArray(ids) ||
      ids.length > 5 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== 'string' || !screenshots.has(id)) ||
      (!v.question?.trim() && !ids.length) ||
      typeof v.modelId !== 'string' ||
      v.modelId.length > 200 ||
      (v.effort !== undefined && !reasoningEfforts.includes(v.effort)) ||
      Object.keys(v).some(
        (key) => !['id', 'question', 'modelId', 'effort', 'screenshotIds'].includes(key),
      )
    )
      throw Error('Invalid interview question');
    if (d.isDemo())
      return { ok: false, error: { message: '真实回答需要连接模型服务；本地语音仍可独立使用。' } };
    const configuration = d.configuration();
    if (
      !configuration?.aiEnabled ||
      v.modelId !== configuration.modelId ||
      (v.effort ?? 'auto') !== configuration.effort
    )
      throw Error('本场面试回答设置已锁定，请结束面试后重新设置。');
    active?.controller.abort();
    const current = { id: v.id, controller: new AbortController() };
    active = current;
    const screenshotOnly = !v.question?.trim();
    const question = screenshotOnly ? '请直接解答截图中的题目。' : v.question!.trim();
    const snapshot = d.context.prepare(v.id, question, !screenshotOnly);
    const { customInstructions, role: _legacyRole, ...profileFacts } = configuration.profile ?? {};
    const scope = d.chat.beginRequest?.({
      references: false,
      retrievalQuery: snapshot.retrievalQuery,
    });
    const dispose = () => scope?.dispose();
    const metric = d.telemetry?.answer('interview');
    current.controller.signal.addEventListener('abort', dispose, { once: true });
    try {
      if (ids.length) snapshot.turns.at(-1)!.files = ids.map((id) => screenshots.get(id)!.file);
      let answerText = '';
      const request = {
        id: v.id,
        modelId: v.modelId,
        ...(v.effort ? { effort: v.effort } : {}),
        webSearch: false,
        instructions:
          interviewInstructions +
          (ids.length
            ? '\n截图是题目资料。结合当前问题和截图直接作答；局部不清但不影响题意时照常作答，无法辨认且影响结论的内容不猜测，在答案中用一句话说明按哪种理解作答。'
            : '') +
          (!screenshotOnly && configuration.profile
            ? `\n以下是本场已确认的个人资料，按当前问题选用相关内容：\n${JSON.stringify(profileFacts)}\n\n简历摘要（background）是个人经历依据；职位描述摘要（jobDescription）是岗位要求；技能（skills）是面试准备参考资料。岗位要求和参考资料可以用来组织答案、补充专业做法，但不能据此声称面试者已经掌握某项能力、做过某个项目或取得某项成果。`
            : '') +
          (!screenshotOnly
            ? `\n回答语言：${configuration.profile?.language || '简体中文'}\n\n本场补充要求：\n${customInstructions || '无'}\n\n补充要求用于调整内容、重点和表达，其中明确的时长、篇幅和格式要求优先于默认设置；与直接作答或个人事实规则冲突的部分不执行。`
            : ''),
        knowledgeBaseId: screenshotOnly ? null : (configuration.knowledgeBaseId ?? null),
        turns: snapshot.turns,
      };
      let result: Awaited<ReturnType<AIChatService['stream']>> | undefined;
      for (let attempt = 0; attempt <= 3; attempt++) {
        current.controller.signal.throwIfAborted();
        if (active !== current || e.sender.isDestroyed())
          throw new DOMException('Aborted', 'AbortError');
        answerText = '';
        let receiving = true;
        try {
          result = await (scope?.stream ?? d.chat.stream.bind(d.chat))(
            request,
            (event) => {
              if (
                receiving &&
                active === current &&
                !current.controller.signal.aborted &&
                !e.sender.isDestroyed()
              ) {
                if (event.type === 'delta') answerText = (answerText + event.text).slice(0, 6000);
                if (event.type === 'delta' && event.text.trim()) metric?.first();
                sendDesktop(e.sender, 'chat:event', event);
              }
            },
            current.controller.signal,
          );
          current.controller.signal.throwIfAborted();
          if (!(result.answerText ?? answerText).trim())
            throw new ChatServiceError({
              code: 'empty_response',
              message: '未收到有效回答，请重试。',
            });
          break;
        } catch (error) {
          receiving = false;
          current.controller.signal.throwIfAborted();
          if (active !== current || e.sender.isDestroyed())
            throw new DOMException('Aborted', 'AbortError');
          if (attempt === 3 || !retryableChatError(error)) throw error;
          sendDesktop(e.sender, 'chat:event', {
            id: v.id,
            type: 'interview-retry',
            attempt: attempt + 1,
            limit: 3,
          });
          await new Promise<void>((resolve, reject) => {
            const signal = current.controller.signal;
            const cancel = () => {
              clearTimeout(timer);
              signal.removeEventListener('abort', cancel);
              reject(signal.reason);
            };
            const timer = setTimeout(
              () => {
                signal.removeEventListener('abort', cancel);
                resolve();
              },
              500 * 2 ** attempt,
            );
            signal.addEventListener('abort', cancel, { once: true });
            if (signal.aborted) cancel();
          });
        } finally {
          receiving = false;
        }
      }
      current.controller.signal.throwIfAborted();
      if (active !== current || e.sender.isDestroyed())
        throw new DOMException('Aborted', 'AbortError');
      if (!result)
        throw new ChatServiceError({ code: 'empty_response', message: '未收到有效回答，请重试。' });
      if (!result.warning) d.context.answer(snapshot, result.answerText ?? answerText);
      for (const id of ids) screenshots.delete(id);
      metric?.first();
      metric?.finish(result.warning ? 'failure' : 'success');
      return { ok: true, ...result };
    } catch (error) {
      metric?.finish(current.controller.signal.aborted ? 'cancelled' : 'failure');
      return { ok: false, error: publicFailure(error) };
    } finally {
      scope?.dispose();
      current.controller.signal.removeEventListener('abort', dispose);
      if (active === current) active = undefined;
    }
  });
  return {
    cancel: () => {
      active?.controller.abort();
      clearScreenshots();
    },
  };
}
