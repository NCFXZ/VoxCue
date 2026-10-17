import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { installUiAccount, closeUiApp } from '../../../shared/test/scripts/install-ui-account.mjs';
await mkdir('test/results', { recursive: true });
const profile = await mkdtemp(path.resolve('test/results/copilot-ui-'));
const packaged = process.argv.includes('--installer-stage');
const env = { ...process.env, COPILOT_TEST_USER_DATA: profile, VITE_DEV_SERVER_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  ...(packaged
    ? { executablePath: path.resolve('release/installer-stage/VoxCue-win32-x64/VoxCue.exe') }
    : {}),
  args: packaged ? [] : ['.'],
  env,
});
const errors = [],
  checks = [];
try {
  const native = await app.evaluate(async ({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const path = require('node:path');
    const { CopilotRuntime } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/copilot/runtime.js',
    );
    const { copilotAuthorizationUrl } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/copilot/auth.js',
    );
    const childProcess = require('node:child_process');
    const spawn = childProcess.spawn;
    let keychainEnabled = false;
    childProcess.spawn = function (file, args, options) {
      if (path.basename(file) === 'copilot-runtime.exe') {
        if (options.env.COPILOT_DISABLE_KEYTAR === '1')
          throw Error('Browser login must retain the system credential store');
        if (
          Object.keys(options.env).some((key) =>
            /^(?:COPILOT_.*TOKEN|GITHUB_.*TOKEN|GH_TOKEN)$/i.test(key),
          )
        )
          throw Error('Runtime inherited authentication from the host');
        keychainEnabled = true;
      }
      return spawn.call(this, file, args, options);
    };
    const executable = app.isPackaged
      ? path.join(
          process.resourcesPath,
          'app.asar.unpacked/node_modules/@github/copilot-sdk-win32-x64/prebuilds/win32-x64/copilot-runtime.exe',
        )
      : undefined;
    const runtime = new CopilotRuntime(
      path.join(app.getPath('userData'), 'native-probe'),
      executable,
    );
    let control, flow;
    try {
      const client = await runtime.client();
      if (!keychainEnabled) throw Error('Expected native runtime with OS credential storage');
      let sessionIsolated = false;
      const sendRequest = client.connection.sendRequest.bind(client.connection);
      client.connection.sendRequest = (method, params, ...rest) => {
        if (method === 'session.create') {
          const disabled = [
            'enableConfigDiscovery',
            'enableOnDemandInstructionDiscovery',
            'enableFileHooks',
            'enableHostGitOperations',
            'enableSessionStore',
            'enableSkills',
            'enableSessionTelemetry',
            'isExperimentalMode',
          ];
          if (
            disabled.some((key) => params[key] !== false) ||
            params.availableTools?.length !== 0 ||
            params.memory?.enabled !== false ||
            params.remoteSession !== 'off' ||
            params.mcpOAuthTokenStorage !== 'in-memory' ||
            params.embeddingCacheStorage !== 'in-memory' ||
            params.skipEmbeddingRetrieval !== true ||
            params.pluginDirectories?.length !== 0
          )
            throw Error('OS credential storage must not enable ambient session capabilities');
          sessionIsolated = true;
        }
        return sendRequest(method, params, ...rest);
      };
      const version = await client.getStatus();
      control = await runtime.control();
      if (!sessionIsolated) throw Error('Expected explicitly isolated native session');
      const status = await control.rpc.accounts.get({ query: { kind: 'status' } });
      if (status.kind !== 'status' || status.status.isAuthenticated)
        throw Error('Probe must be unauthenticated');
      flow = await control.rpc.accounts.login.begin({ kind: 'githubDotCom' });
      if (flow.step.kind !== 'open-url') throw Error('Expected official browser authorization');
      copilotAuthorizationUrl(flow.step.url);
      return {
        version: version.version,
        protocol: version.protocolVersion,
        pkceBrowserFlow: true,
        keychainEnabled,
        sessionIsolated,
        accounts: status.status.accountCount,
      };
    } finally {
      if (flow) await control.rpc.accounts.login.cancel({ flowId: flow.flowId });
      await runtime.stop();
      childProcess.spawn = spawn;
    }
  });
  assert.equal(native.pkceBrowserFlow, true);
  assert.equal(native.keychainEnabled, true);
  assert.equal(native.sessionIsolated, true);
  checks.push(
    'official Windows runtime: OS credential store enabled, unauthenticated startup, browser PKCE and cancel',
  );
  await app.evaluate(({ app, shell }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { CopilotRuntime } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/copilot/runtime.js',
    );
    let listener = () => {},
      serial = 0;
    const event = (type, data) => listener({ type, data, id: `synthetic-${++serial}` });
    const session = {
      sessionId: 'synthetic-only-session',
      on(callback) {
        listener = callback;
        return () => {
          listener = () => {};
        };
      },
      async send() {
        event('assistant.reasoning_delta', {
          reasoningId: 'private',
          deltaContent: 'PRIVATE_REASONING_NOT_FOR_UI',
        });
        const changes = Object.fromEntries(
          ['name', 'language', 'background', 'jobDescription', 'customInstructions', 'skills'].map(
            (key) => [key, null],
          ),
        );
        const final = JSON.stringify({ answer: '合成 Copilot 回答', changes });
        globalThis.beginCopilotReply = () =>
          event('assistant.message_delta', {
            messageId: 'answer',
            deltaContent: '{"answer":"合成 Copilot 回答',
          });
        globalThis.finishCopilotReply = () => {
          event('assistant.message', { messageId: 'answer', content: final });
          event('assistant.usage', {
            apiCallId: 'synthetic-call',
            inputTokens: 10,
            outputTokens: 5,
          });
          event('session.idle', {});
        };
        return 'synthetic-user';
      },
      async abort() {},
    };
    const control = {
      rpc: {
        accounts: {
          async get() {
            return {
              kind: 'activeAccount',
              authInfo: { type: 'user', host: 'https://github.com', login: 'SyntheticCopilot' },
            };
          },
          async set() {
            return { ok: true };
          },
          login: {
            async begin() {
              return {
                flowId: 'synthetic-flow',
                step: {
                  kind: 'open-url',
                  url: 'https://github.com/login/oauth/authorize?client_id=synthetic&state=synthetic&code_challenge=synthetic&code_challenge_method=S256&redirect_uri=http%3A%2F%2F127.0.0.1%3A12345%2Fcallback',
                },
              };
            },
            async advance() {
              if (!globalThis.copilotStorageFailureChecked) {
                globalThis.copilotStorageFailureChecked = true;
                return { kind: 'completed', result: { status: 'needs-plaintext-consent' } };
              }
              return {
                kind: 'completed',
                result: {
                  status: 'completed',
                  host: 'https://github.com',
                  login: 'SyntheticCopilot',
                },
              };
            },
            async cancel() {},
          },
        },
      },
    };
    CopilotRuntime.prototype.control = async () => control;
    CopilotRuntime.prototype.client = async () => ({
      rpc: {
        models: {
          async list() {
            return {
              models: [
                {
                  id: 'synthetic-copilot',
                  name: 'Copilot Test Model',
                  vendor: 'Test Vendor',
                  capabilities: { supports: { reasoningEffort: true } },
                  supportedReasoningEfforts: ['low', 'high'],
                },
              ],
            };
          },
        },
      },
      async createSession() {
        return session;
      },
      async deleteSession() {},
    });
    shell.openExternal = async (url) => {
      globalThis.copilotBrowserOpened = new URL(url).origin === 'https://github.com';
    };
  });
  const login = await app.firstWindow();
  await login.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  await login.getByRole('button', { name: '使用 GitHub Copilot 继续', exact: true }).waitFor();
  for (const theme of ['light', 'dark']) {
    await login.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );
    await login.waitForFunction(() => {
      const background = getComputedStyle(document.querySelector('.login-preview')).backgroundColor;
      const foreground = getComputedStyle(document.querySelector('.login-form')).color;
      return [...document.querySelectorAll('.service-login')].every((node) => {
        const style = getComputedStyle(node);
        return style.backgroundColor === background && style.color === foreground;
      });
    });
    const buttons = await login.locator('.service-login').evaluateAll((nodes) =>
      nodes.map((node) => ({
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
        filter: getComputedStyle(node.querySelector('img')).filter,
      })),
    );
    assert.equal(buttons[0].height, buttons[1].height);
    assert.equal(buttons[0].width, buttons[1].width);
    assert.equal(buttons[0].filter, buttons[1].filter);
    if (theme === 'dark') assert.ok(buttons[0].filter.includes('invert(1)'));
    await login.screenshot({ path: path.join(profile, `login-${theme}.png`) });
  }
  await login.getByRole('button', { name: '使用 GitHub Copilot 继续', exact: true }).click();
  await login.getByRole('alert').filter({ hasText: '加密存储不可用' }).waitFor();
  assert.equal(await login.evaluate(() => window.desktop.authSession()), null);
  assert.equal(
    await login.getByRole('button', { name: '使用 GitHub Copilot 继续', exact: true }).isEnabled(),
    true,
  );
  checks.push('secure storage failure stays signed out, rejects plaintext and allows retry');
  const [page] = await Promise.all([
    app.waitForEvent('window'),
    login.getByRole('button', { name: '使用 GitHub Copilot 继续', exact: true }).click(),
  ]);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByText('GitHub Copilot 可用', { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.copilotBrowserOpened), true);
  assert.equal((await page.evaluate(() => window.desktop.authSession())).mode, 'copilot');
  assert.equal(/ChatGPT|OpenAI/.test(await page.locator('body').innerText()), false);
  checks.push(
    'login choice, native auth/session/selection, Copilot model and data-recipient branding',
  );
  await page.getByRole('textbox', { name: '聊天消息', exact: true }).fill('Copilot接入测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const reply = page.locator('.chat-message.assistant').last();
  await reply.getByText('正在思考', { exact: true }).waitFor();
  assert.equal((await reply.innerText()).includes('PRIVATE'), false);
  await app.evaluate(() => globalThis.beginCopilotReply());
  await reply.locator('.chat-answer').getByText('合成 Copilot 回答', { exact: true }).waitFor();
  assert.equal(await reply.locator('.duration-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await reply.locator('.response-progress-content').isVisible(), false);
  await page.getByRole('button', { name: '停止回复', exact: true }).waitFor();
  await reply.locator('.duration-toggle').click();
  assert.equal(await reply.locator('.response-progress-content').isVisible(), true);
  await app.evaluate(() => globalThis.finishCopilotReply());
  await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
  assert.ok(
    (await reply.locator('.answer-label').innerText()).includes(
      'GitHub Copilot · Copilot Test Model · Test Vendor',
    ),
  );
  await reply.screenshot({ path: path.join(profile, 'copilot-reply.png') });
  checks.push(
    'actual adapter events through IPC/preload, no raw reasoning, collapse during answer streaming, usage and identity',
  );
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '账户与用量', exact: true }).click();
  assert.ok((await settings.innerText()).includes('GitHub Copilot'));
  assert.equal(/ChatGPT|OpenAI/.test(await settings.innerText()), false);
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '用户菜单', exact: true }).click();
  await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
  const logout = page.getByRole('dialog', { name: '退出登录', exact: true });
  const [loginAgain] = await Promise.all([
    app.waitForEvent('window'),
    logout.getByRole('button', { name: '确认退出登录', exact: true }).click(),
  ]);
  await loginAgain.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).waitFor();
  await installUiAccount(app);
  const [chatGPT] = await Promise.all([
    app.waitForEvent('window'),
    loginAgain.getByRole('button', { name: '使用 ChatGPT 继续', exact: true }).click(),
  ]);
  await chatGPT.getByText('ChatGPT 可用', { exact: true }).waitFor();
  await chatGPT.getByText('合成 Copilot 回答', { exact: true }).waitFor();
  assert.ok(
    (
      await chatGPT.locator('.chat-message.assistant').last().locator('.answer-label').innerText()
    ).includes('GitHub Copilot'),
  );
  checks.push(
    'sign out and switch to ChatGPT; existing local conversation and original reply identity retained',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(profile, 'report.json'),
    JSON.stringify(
      { passed: true, packaged, native, checks, rendererErrors: errors.length },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, packaged, profile, checks: checks.length }));
} catch (error) {
  for (const [index, window] of app.windows().entries()) {
    if (window.isClosed()) continue;
    await window.screenshot({ path: path.join(profile, `failure-${index}.png`) }).catch(() => {});
    console.error(
      JSON.stringify({
        profile,
        window: index,
        alerts: await window.getByRole('alert').allTextContents(),
        body: (await window.locator('body').innerText()).slice(-1200),
      }),
    );
  }
  throw error;
} finally {
  await closeUiApp(app);
}
