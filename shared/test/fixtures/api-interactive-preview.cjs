const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// Representative public model records in each vendor's wire format. The
// real provider adapters determine names, eligibility and reasoning controls.
const openai = { data: ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-terra'].map((id) => ({ id })) };
const deepseek = {
  data: [
    ['deepseek-flash', 'DeepSeek-V4.1-Flash'],
    ['deepseek-v4-pro', 'DeepSeek-V4-Pro'],
  ].map(([id, name]) => ({
    id,
    name,
    effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' },
    input_modalities: id === 'deepseek-flash' ? ['text', 'image'] : ['text'],
    output_modalities: ['text'],
  })),
};
const kimi = { data: ['kimi-k3.1-pro', 'kimi-k3'].map(id => ({
  object: 'model', id, supports_reasoning: true, supports_image_in: true,
})) };
const gemini = { models: ['gemini-4-hydrogen', 'gemini-2.5-flash'].map(id => ({
  name: 'models/' + id, displayName: id === 'gemini-4-hydrogen' ? 'Gemini 4 Hydrogen' : 'Gemini 2.5 Flash',
  supportedGenerationMethods: ['generateContent'], thinking: true,
})) };
const catalogs = { openai, deepseek, kimi, gemini };
const usage = { prompt_tokens: 48, completion_tokens: 24, total_tokens: 72 };
const googleSearchHtml = readFileSync(path.join(__dirname, 'google-search-suggestions.html'), 'utf8');
const [, googleSearchLink, googleSearchLabel] =
  googleSearchHtml.match(/<a class="chip" href="([^"]+)">([^<]+)<\/a>/u) ?? [];
if (!googleSearchLink || !googleSearchLabel) throw Error('The official Google fixture must include a search chip.');
const googleSearch = {
  source: { title: 'Synthetic Google grounding', url: 'https://example.org/google-grounding' },
  link: googleSearchLink,
  label: googleSearchLabel,
  html: googleSearchHtml,
};
const profilePreview = {
  request: '请将简历摘要改成一段用于合成流式验证的内容。',
  prefix: '这是一段用于流式验证的合成简历。',
  suffix: '收到后续片段后才具备完整内容。',
};
// Synthetic DeepSeek preparation scenarios. A gated stream pauses after its first chunk
// until the UI check releases it, so visible text must come from incremental output.
const deepSeekPreparation = {
  answer: {
    request: '请分段回答：我的优势是什么？',
    first: '合成优势一：能把检测软件的问题拆解清楚。',
    rest: '合成优势二：能持续维护回归测试。',
  },
  role: /^(?:把目标岗位改成|不对，改成)(.+?)。?$/u,
  retained: '[本机操作状态：用户已拒绝这份提案并保留旧资料',
  // A searched answer that omits the intent line; only a structure follow-up may complete it.
  unlabeled: {
    request: '请联网查一下合成框架的最新消息',
    answer: '合成框架最新公告：发布了合成版本的维护说明。',
  },
  followUp: '【应用补充请求，不是用户发言】',
};
const intent = (kind) => '<profile_intent>' + kind + '</profile_intent>';
const proposal = (answer, changes) =>
  intent('proposal') + '\n' + answer + '\n<profile_proposal>\n' +
  JSON.stringify({ changes, skillScope: null }) + '\n</profile_proposal>';
const routes = {
  openai: ['api.openai.com', '/v1/models', '/v1/responses'],
  deepseek: ['api.deepseek.com', '/models', '/chat/completions', '/user/balance'],
  kimi: ['api.moonshot.cn', '/v1/models', '/v1/responses', '/v1/users/me/balance'],
  gemini: ['generativelanguage.googleapis.com', '/v1beta/models'],
};

function transport(provider, key = 'preview-only') {
  // No external transport exists in this function, including for unexpected routes.
  return async (input, options = {}) => {
    options.signal?.throwIfAborted();
    const url = new URL(String(input));
    const [host, models, chat, balance] = routes[provider];
    const method = options.method ?? 'GET';
    if (url.protocol !== 'https:' || url.port || url.username || url.password ||
        url.hostname !== host)
      throw Error('模拟请求的服务地址与所选厂商不符。');
    const headers = new Headers(options.headers);
    if ((provider === 'gemini' ? headers.get('x-goog-api-key') : headers.get('authorization')) !==
        (provider === 'gemini' ? key : 'Bearer ' + key))
      throw Error('模拟请求未使用所选厂商的鉴权方式。');
    if (method === 'GET' && url.pathname === models) return Response.json(catalogs[provider]);
    if (provider === 'gemini') {
      const match = url.pathname.match(/^\/v1beta\/models\/([a-z0-9.-]+):streamGenerateContent$/);
      const body = JSON.parse(options.body instanceof Blob ? await options.body.text() : options.body);
      if (method !== 'POST' || !match || url.searchParams.get('alt') !== 'sse' ||
          !body.contents?.some(message => message.role === 'user'))
        throw Error('模拟请求缺少 Gemini 流式对话字段。');
      const thinking = body.generationConfig?.thinkingConfig;
      const effort = thinking?.thinkingLevel ?? ({ 0: 'none', 1024: 'low', 8192: 'medium', 24576: 'high' }[thinking?.thinkingBudget]) ?? 'auto';
      const answer = '当前模型为 ' + match[1] + '，思考设置为 ' + effort + '。这是模拟回答。';
      const system = body.systemInstruction?.parts?.map(part => part.text ?? '').join('') ?? '';
      const nativeProfile = body.generationConfig?.responseMimeType === 'application/json' &&
        body.generationConfig.responseJsonSchema;
      const text = nativeProfile || system.includes('JSON Schema') ? JSON.stringify({ answer, changes: {
        name: null, language: null, background: null, jobDescription: null, customInstructions: null, skills: null,
      }, skillScope: null }) : answer;
      const chunks = text.match(/[\s\S]{1,8}/gu);
      const responseId = 'gemini-' + randomUUID();
      const events = chunks.map((delta, index) => ({
        responseId, candidates: [{ index: 0, content: { role: 'model', parts: [{ text: delta }] },
          ...(index === chunks.length - 1 ? { finishReason: 'STOP' } : {}),
          ...(index === chunks.length - 1 && body.tools?.some(tool => tool.google_search) ? {
            groundingMetadata: {
              webSearchQueries: ['voxcue synthetic'],
              groundingChunks: [{ web: { uri: googleSearch.source.url, title: googleSearch.source.title } }],
              searchEntryPoint: { renderedContent: googleSearch.html },
            },
          } : {}),
        }],
        ...(index === chunks.length - 1 ? {
          usageMetadata: { promptTokenCount: 48, candidatesTokenCount: 24, totalTokenCount: 72 },
        } : {}),
      }));
      const encoder = new TextEncoder();
      let index = 0;
      return new Response(new ReadableStream({
        async pull(controller) {
          await require('node:timers/promises').setTimeout(36);
          if (options.signal?.aborted || index >= events.length) return controller.close();
          controller.enqueue(encoder.encode('data: ' + JSON.stringify(events[index++]) + '\n\n'));
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    }
    if (method === 'GET' && provider === 'kimi' && url.pathname === balance)
      return Response.json({ code: 0, data: { available_balance: 12.5, voucher_balance: 2.5, cash_balance: 10 } });
    if (method === 'GET' && provider === 'deepseek' && url.pathname === balance)
      return Response.json({
        balance_infos: [
          {
            currency: 'CNY',
            total_balance: '28.50',
            granted_balance: '3.50',
            topped_up_balance: '25.00',
          },
        ],
      });
    const deepSeekResponses = provider === 'deepseek' && url.pathname === '/responses';
    if (method !== 'POST' || (url.pathname !== chat && !deepSeekResponses))
      throw Error('此操作未包含在离线预览中。');
    const body = JSON.parse(options.body);
    const model = body.model;
    const responses = provider === 'openai' || provider === 'kimi' || deepSeekResponses;
    const messages = responses ? body.input : body.messages;
    if (body.stream !== true || typeof model !== 'string' || !Array.isArray(messages) ||
        !messages.some(message => message.role === 'user') || headers.get('content-type') !== 'application/json')
      throw Error('模拟请求缺少流式对话所需的字段。');
    const declaredEffort = responses ? body.reasoning?.effort : body.reasoning_effort;
    const effort = declaredEffort ?? (body.enable_thinking === true || body.thinking?.type === 'enabled'
        ? 'on'
        : body.enable_thinking === false || body.thinking?.type === 'disabled'
          ? 'none'
          : 'auto');
    const answer = '当前模型为 ' + model + '，思考设置为 ' + effort + '。这是模拟回答。';
    const system =
      body.instructions ??
      body.messages?.find((m) => m.role === 'system')?.content ??
      '';
    const format = responses ? body.text?.format?.type : body.response_format?.type;
    const json = !deepSeekResponses && responses && (format === 'json_schema' || system.includes('JSON Schema'));
    // DeepSeek preparation uses its text protocol: intent line, visible answer, optional proposal.
    const deepSeekProfile = provider === 'deepseek' && system.includes(intent('none'));
    if (deepSeekProfile && (format || body.response_format))
      throw Error('模拟 DeepSeek 资料请求不应启用 JSON 输出格式。');
    const lastUser = messages.findLast(message => message.role === 'user')?.content;
    const prompt = typeof lastUser === 'string' ? lastUser : '';
    const probe = provider === 'deepseek' && prompt.includes(profilePreview.request);
    if (probe && !deepSeekProfile) throw Error('模拟资料请求缺少 DeepSeek 资料协议。');
    const role = deepSeekProfile ? deepSeekPreparation.role.exec(prompt)?.[1] : undefined;
    if (role && prompt.startsWith('不对') && !messages.some(message => message.role === 'assistant' &&
        String(message.content).includes(deepSeekPreparation.retained)))
      throw Error('模拟请求缺少上一份提案已保留原资料的本机状态。');
    const answerProbe = deepSeekProfile && prompt === deepSeekPreparation.answer.request;
    const unlabeled = deepSeekProfile && prompt === deepSeekPreparation.unlabeled.request;
    if (unlabeled && !body.tools?.length) throw Error('模拟联网请求缺少搜索工具。');
    const followUp = deepSeekProfile && prompt.startsWith(deepSeekPreparation.followUp);
    if (followUp) {
      if (body.tools || messages.at(-2)?.role !== 'assistant') throw Error('模拟结构补问的请求不完整。');
      globalThis.apiStructureFollowUps = (globalThis.apiStructureFollowUps ?? 0) + 1;
    }
    const text = followUp
      ? intent('none')
      : unlabeled
        ? deepSeekPreparation.unlabeled.answer
        : probe
          ? proposal(answer, { background: profilePreview.prefix + profilePreview.suffix })
          : role
            ? proposal('已生成职位描述的修改提案，确认保存前资料保持原值。', { jobDescription: role })
            : answerProbe
              ? intent('none') + '\n' + deepSeekPreparation.answer.first + deepSeekPreparation.answer.rest
              : deepSeekProfile
                ? intent('none') + '\n' + answer
                : json ? JSON.stringify({ answer, changes: {
                  name: null, language: null, background: null, jobDescription: null, customInstructions: null, skills: null,
                }, skillScope: null }) : answer;
    const gate = probe || answerProbe ? Promise.withResolvers() : undefined;
    if (gate) globalThis[probe ? 'finishApiProfilePreview' : 'finishApiAnswerStream'] = gate.resolve;
    const id = 'demo-' + randomUUID();
    const boundary = probe
      ? text.indexOf(profilePreview.prefix) + profilePreview.prefix.length
      : text.indexOf(deepSeekPreparation.answer.first) + deepSeekPreparation.answer.first.length;
    const chunks = gate
      ? [text.slice(0, boundary), text.slice(boundary)]
      : text.match(/[\s\S]{1,8}/gu);
    const itemId = 'message-' + id;
    const events =
      responses
        ? [
            ...chunks.map((delta) => ({
              type: 'response.output_text.delta',
              delta,
              ...(deepSeekResponses ? { item_id: itemId, output_index: 0, content_index: 0 } : {}),
            })),
            {
              type: 'response.completed',
              response: {
                id,
                status: 'completed',
                output: deepSeekResponses ? [{
                  id: itemId, type: 'message', role: 'assistant', phase: 'final_answer',
                  content: [{ type: 'output_text', text }],
                }] : [],
                usage: { input_tokens: 48, output_tokens: 24, total_tokens: 72 },
              },
            },
          ]
        : [
              ...chunks.map((content) => ({ id, choices: [{ delta: { content } }] })),
              { id, choices: [{ delta: {}, finish_reason: 'stop' }], usage },
            ];
    const pause = require('node:timers/promises').setTimeout;
    const encoder = new TextEncoder();
    let index = 0,
      closed = false;
    return new Response(
      new ReadableStream({
        async pull(controller) {
          await pause(36);
          if (index === 1) await gate?.promise;
          if (closed) return;
          if (options.signal?.aborted || index >= events.length) return controller.close();
          controller.enqueue(encoder.encode('data: ' + JSON.stringify(events[index++]) + '\n\n'));
        },
        cancel() {
          closed = true;
          gate?.resolve();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  };
}

// Executed only in an explicitly launched development Electron with a new,
// verified test owner. No real key, device, account, or balance is used.
function install(root, profile) {
  const { app, BrowserWindow, shell, dialog, desktopCapturer } = require('electron');
  const fs = require('node:fs');
  if (
    app.isPackaged ||
    app.getPath('userData') !== profile ||
    !fs.existsSync(path.join(path.dirname(profile), '.voxcue-test-owner.json'))
  )
    throw Error('An owned temporary preview profile is required.');
  const load = (name) => require(path.join(root, 'dist-electron/shared/electron', name + '.js'));
  const { apiProviderIds } = load('contracts/apiConnections');
  const { ApiCredentialStore } = load('backend/api/credentials');
  const configs = new Map(apiProviderIds.map(provider => [provider, { provider }]));
  Object.assign(ApiCredentialStore.prototype, {
    async list() {
      return [...configs.values()].map((entry) => ({ ...entry }));
    },
    async read(provider) {
      const entry = configs.get(provider);
      return entry ? { key: 'preview-only' } : null;
    },
    async save(provider, _credential, signal) {
      signal?.throwIfAborted();
      configs.set(provider, { provider });
    },
    async remove(provider) {
      configs.delete(provider);
    },
    async dispose() {},
  });
  const service = load('backend/api/service');
  const chat = service.createApiChatService,
    balance = service.readApiBalance;
  // Keep API instances on the real Responses implementation when the subscription
  // fixture subsequently replaces its prototype methods.
  const { ChatGPTService } = load('backend/chat/service');
  const { models, stream, usage } = ChatGPTService.prototype;
  service.createApiChatService = (provider, access, ledger) => {
    const instance = chat(provider, access, ledger, transport(provider));
    return instance instanceof ChatGPTService ? Object.assign(instance, { models, stream, usage }) : instance;
  };
  service.readApiBalance = (provider, secret, signal) =>
    balance(provider, secret, signal, transport(provider));
  // The visible React modal, config validation, and save/cancel IPC remain
  // production code. Only the native field is substituted in this isolated host.
  const ipc = load('ipc/apiConnections'),
    register = ipc.registerApiConnectionIpc;
  let pending;
  ipc.registerApiConnectionIpc = (ports) => {
    if (typeof ports.control !== 'function')
      throw Error('请先构建带有 API 密钥输入弹窗的当前桌面代码。');
    register({
      ...ports,
      prompt(_provider, signal) {
        const owner =
          BrowserWindow.getFocusedWindow() ??
          BrowserWindow.getAllWindows().find((w) => w.isVisible());
        if (pending || !owner) throw Error('模拟输入框未就绪。');
        signal.throwIfAborted();
        return new Promise((resolve, reject) => {
          const done = (key) => {
            signal.removeEventListener('abort', cancel);
            pending = undefined;
            resolve(key);
          };
          const cancel = () => done(null);
          pending = { owner, done };
          signal.addEventListener('abort', cancel, { once: true });
          owner.webContents
            .executeJavaScript(
              `(() => {
            const field=document.querySelector('[data-api-key-field]');
            if(!field) throw Error('Missing preview key field');
            const input=document.createElement('input');
            input.type='password';input.autocomplete='off';input.required=true;input.spellcheck=false;
            input.setAttribute('aria-labelledby',field.getAttribute('aria-labelledby'));
            input.style.cssText='display:block;box-sizing:border-box;width:100%;height:100%;border:0;outline:0;padding:0;color:inherit;background:transparent;font:inherit;';
            input.addEventListener('keydown',event=>{
              if (event.key!=='Enter'||event.isComposing) return;
              event.preventDefault();
              [...input.closest('dialog').querySelectorAll('button')].at(-1)?.click();
            });
            field.replaceChildren(input);input.focus();
          })()`,
            )
            .catch((e) => {
              if (pending?.owner === owner) {
                signal.removeEventListener('abort', cancel);
                pending = undefined;
                reject(e);
              }
            });
        });
      },
      async control(command) {
        const entry = pending;
        if (!entry) return;
        const web = entry.owner.webContents;
        if (command.action === 'cancel') return entry.done(null);
        if (command.action === 'visibility') {
          const type = command.visible ? 'text' : 'password';
          return web.executeJavaScript(
            "document.querySelector('[data-api-key-field] input')?.setAttribute('type', '" + type + "')",
          );
        }
        if (command.action === 'focus')
          return web.executeJavaScript(
            "document.querySelector('[data-api-key-field] input')?.focus()",
          );
        if (command.action === 'submit') {
          // Only required/empty crosses the fixture boundary. Discard the input.
          const valid = await web.executeJavaScript(`(() => {
            const input=document.querySelector('[data-api-key-field] input');
            if(!input || input.validity.valueMissing) { input?.focus();return false; }
            input.value='';return true;
          })()`);
          if (pending === entry) entry.done(valid ? 'preview-only' : '');
        }
      },
    });
  };
  shell.openExternal = async url => {
    if (url === googleSearch.link) { globalThis.previewGoogleLink = url; return; }
    throw Error('模拟预览已关闭外部链接。');
  };
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  dialog.showSaveDialog = async () => ({ canceled: true });
  desktopCapturer.getSources = async () => [];
  const platform = load('platform/index'),
    originalPlatform = platform.selectDesktopPlatform;
  platform.selectDesktopPlatform = (...args) => ({
    ...originalPlatform(...args),
    captureScreen: async () => {
      throw Error('模拟预览不采集实际屏幕。');
    },
  });
  const { CopilotAuthService } = load('backend/copilot/auth');
  const { CopilotRuntime } = load('backend/copilot/runtime');
  const unavailable = async () => {
    throw Error('模拟预览仅提供 API 密钥服务。');
  };
  Object.assign(CopilotAuthService.prototype, {
    session: async () => null,
    verifiedSession: async () => null,
    signIn: unavailable,
  });
  Object.assign(CopilotRuntime.prototype, { control: unavailable, client: unavailable });
}

module.exports = { install, profilePreview, deepSeekPreparation, googleSearch, transport };
