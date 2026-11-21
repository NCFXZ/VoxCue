const { randomUUID } = require('node:crypto');
const path = require('node:path');

// Representative public model records in each vendor's wire format. The
// real provider adapters determine names, eligibility and reasoning controls.
const openai = { data: ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-terra'].map((id) => ({ id })) };
const supported = { supported: true };
const anthropic = {
  data: [
    {
      id: 'claude-opus-5-5',
      display_name: 'Claude Opus 5.5',
      capabilities: {
        image_input: supported,
        pdf_input: supported,
        thinking: { types: { adaptive: supported, disabled: { supported: false } } },
        effort: Object.fromEntries(
          ['low', 'medium', 'high', 'xhigh', 'max'].map((level) => [level, supported]),
        ),
      },
    },
    {
      id: 'claude-haiku-4-5-20251001',
      display_name: 'Claude Haiku 4.5',
      capabilities: {
        image_input: supported,
        pdf_input: supported,
        thinking: { types: { enabled: supported, disabled: supported } },
      },
    },
  ],
  has_more: false,
};
const gemini = {
  models: [
    ['gemini-4-neon', 'Gemini 4 Neon'],
    ['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite'],
  ].map(([id, displayName]) => ({
    name: 'models/' + id,
    displayName,
    thinking: true,
    supportedGenerationMethods: ['generateContent'],
  })),
};
const qwen = {
  output: {
    total: 2,
    models: ['qwen4-max', 'qwen-plus'].map((model) => ({
      model,
      name: model,
      provider: 'qwen',
      capabilities: ['TG', 'Reasoning'],
      inference_metadata: {
        request_modality: model === 'qwen4-max' ? ['Text', 'Image'] : ['Text'],
        response_modality: ['Text'],
      },
    })),
  },
};
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
const kimi = { data: ['kimi-k3.1-pro', 'kimi-k2.6'].map((id) => ({ id })) };
const glm = { data: ['glm-5.3', 'glm-5.2'].map((id) => ({ id })) };
const doubao = {
  data: [
    {
      id: 'doubao-seed-2-1-pro-260628',
      modalities: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      features: { thinking: { type: 'enabled' } },
      effort: { supported_levels: ['minimal', 'low', 'medium', 'high'] },
    },
    {
      id: 'doubao-seed-character-251128',
      modalities: { input_modalities: ['text'], output_modalities: ['text'] },
    },
  ],
};
const catalogs = { openai, anthropic, gemini, qwen, deepseek, kimi, glm, doubao };
const usage = { prompt_tokens: 48, completion_tokens: 24, total_tokens: 72 };
const routes = {
  openai: ['api.openai.com', '/v1/models', '/v1/responses'],
  anthropic: ['api.anthropic.com', '/v1/models', '/v1/messages'],
  gemini: ['generativelanguage.googleapis.com', '/v1beta/models', '/v1beta/openai/chat/completions'],
  qwen: [null, '/api/v1/models', '/compatible-mode/v1/chat/completions'],
  deepseek: ['api.deepseek.com', '/models', '/chat/completions', '/user/balance'],
  kimi: ['api.moonshot.cn', '/v1/models', '/v1/chat/completions', '/v1/users/me/balance'],
  glm: ['open.bigmodel.cn', '/api/paas/v4/models', '/api/paas/v4/chat/completions'],
  doubao: ['ark.cn-beijing.volces.com', '/api/v3/models', '/api/v3/chat/completions'],
};
const qwenHost = /^(?:dashscope(?:-intl|-us)?\.aliyuncs\.com|cn-hongkong\.dashscope\.aliyuncs\.com|[a-z0-9-]+\.(?:cn-beijing|ap-southeast-1|us-east-1|ap-northeast-1|cn-hongkong|eu-central-1)\.maas\.aliyuncs\.com)$/;

function transport(provider, key = 'preview-only') {
  // No external transport exists in this function, including for unexpected routes.
  return async (input, options = {}) => {
    options.signal?.throwIfAborted();
    const url = new URL(String(input));
    const [host, models, chat, balance] = routes[provider];
    const method = options.method ?? 'GET';
    if (url.protocol !== 'https:' || url.port || url.username || url.password ||
        (provider === 'qwen' ? !qwenHost.test(url.hostname) : url.hostname !== host))
      throw Error('模拟请求的服务地址与所选厂商不符。');
    const headers = new Headers(options.headers);
    const googleCatalog = provider === 'gemini' && url.pathname === models;
    const authorized = googleCatalog ? headers.get('x-goog-api-key') === key && !headers.has('authorization') :
      headers.get('authorization') === 'Bearer ' + key;
    if (!authorized || (provider === 'anthropic' && headers.get('anthropic-version') !== '2026-10-21'))
      throw Error('模拟请求未使用所选厂商的鉴权方式。');
    if (method === 'GET' && url.pathname === models) return Response.json(catalogs[provider]);
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
    if (method === 'GET' && provider === 'kimi' && url.pathname === balance)
      return Response.json({
        code: 0,
        data: { available_balance: 32.8, voucher_balance: 2.8, cash_balance: 30 },
      });
    if (method !== 'POST' || url.pathname !== chat)
      throw Error('此操作未包含在离线预览中。');
    const body = JSON.parse(options.body);
    const messages = provider === 'openai' ? body.input : body.messages;
    if (body.stream !== true || typeof body.model !== 'string' || !Array.isArray(messages) ||
        !messages.some(message => message.role === 'user') || headers.get('content-type') !== 'application/json')
      throw Error('模拟请求缺少流式对话所需的字段。');
    const declaredEffort = provider === 'openai' ? body.reasoning?.effort :
      provider === 'anthropic' ? body.output_config?.effort : body.reasoning_effort;
    const effort = declaredEffort ?? (body.enable_thinking === true || body.thinking?.type === 'enabled'
        ? 'on'
        : body.enable_thinking === false || body.thinking?.type === 'disabled'
          ? 'none'
          : 'auto');
    const answer = '当前模型为 ' + body.model + '，思考设置为 ' + effort + '。这是模拟回答。';
    const system =
      body.instructions ??
      body.system ??
      body.messages?.find((m) => m.role === 'system')?.content ??
      '';
    const text =
      body.text?.format?.type === 'json_schema' || system.includes('JSON Schema')
        ? JSON.stringify({ answer, changes: {}, skillScope: null })
        : answer;
    const id = 'demo-' + randomUUID();
    const chunks = text.match(/[\s\S]{1,8}/gu);
    const events =
      provider === 'openai'
        ? [
            ...chunks.map((delta) => ({ type: 'response.output_text.delta', delta })),
            {
              type: 'response.completed',
              response: {
                id,
                status: 'completed',
                output: [],
                usage: { input_tokens: 48, output_tokens: 24, total_tokens: 72 },
              },
            },
          ]
        : provider === 'anthropic'
          ? [
              { type: 'message_start', message: { id, usage: { input_tokens: 48 } } },
              ...chunks.map((text) => ({
                type: 'content_block_delta',
                delta: { type: 'text_delta', text },
              })),
              {
                type: 'message_delta',
                delta: { stop_reason: 'end_turn' },
                usage: { output_tokens: 24 },
              },
              { type: 'message_stop' },
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
          if (closed) return;
          if (options.signal?.aborted || index >= events.length) return controller.close();
          controller.enqueue(encoder.encode('data: ' + JSON.stringify(events[index++]) + '\n\n'));
        },
        cancel() {
          closed = true;
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
  const configs = new Map(
    apiProviderIds.map((provider) => [
      provider,
      provider === 'qwen' ? { provider, region: 'beijing' } : { provider },
    ]),
  );
  Object.assign(ApiCredentialStore.prototype, {
    async list() {
      return [...configs.values()].map((entry) => ({ ...entry }));
    },
    async read(provider) {
      const entry = configs.get(provider);
      return entry ? { ...entry, key: 'preview-only' } : null;
    },
    async save(provider, { region, workspace }, signal) {
      signal?.throwIfAborted();
      configs.set(provider, { provider, region, workspace });
    },
    async remove(provider) {
      configs.delete(provider);
    },
    async dispose() {},
  });
  const service = load('backend/api/service');
  const chat = service.createApiChatService,
    balance = service.readApiBalance;
  // OpenAI API and the subscription share an implementation. The synthetic
  // subscription installed later must not override this offline API transport.
  const { models, stream, usage } = load('backend/chat/service').ChatGPTService.prototype;
  service.createApiChatService = (provider, access, ledger) => {
    const instance = chat(provider, access, ledger, transport(provider));
    return provider === 'openai' ? Object.assign(instance, { models, stream, usage }) : instance;
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
  shell.openExternal = async () => {
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

module.exports = { install, transport };
