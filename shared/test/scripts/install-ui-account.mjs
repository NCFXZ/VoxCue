import path from 'node:path';
// Called only by Playwright in an isolated test process. No real OAuth/AI/audio.
export async function closeUiApp(app) {
  await app.evaluate(({ app, dialog }) => {
    const path = process.getBuiltinModule('path');
    const root = process
      .getBuiltinModule('fs')
      .realpathSync(process.getBuiltinModule('os').tmpdir());
    const profile = path.resolve(app.getPath('userData'));
    const relative = path.relative(root, profile);
    if (
      !relative.startsWith('voxcue-test-run-') ||
      relative.startsWith('..') ||
      path.isAbsolute(relative)
    )
      throw Error('UI teardown requires isolated temporary userData');
    const original = dialog.showMessageBox.bind(dialog);
    dialog.showMessageBox = (...args) =>
      args.at(-1)?.title === '关闭 VoxCue'
        ? Promise.resolve({ response: 1, checkboxChecked: false })
        : original(...args);
  });
  if (process.platform === 'darwin') {
    // macOS intentionally remains in the Dock after its last window closes.
    // Finish the normal save/close handshake before asking Playwright to quit.
    const closed = app.windows().map((window) => window.waitForEvent('close', { timeout: 20000 }));
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.close();
    });
    await Promise.all(closed);
  }
  let timer;
  try {
    await Promise.race([
      app.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          app.process().kill();
          reject(Error('Isolated Electron teardown timed out; test process terminated.'));
        }, 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function installUiAccount(app, { speech = false } = {}) {
  const speechPorts = {
    win32: 'test/fixtures/install-speech-port.cjs',
    darwin: 'test/fixtures/install-speech-port.cjs',
  };
  if (speech && !speechPorts[process.platform])
    throw Error('No native speech fixture for this platform');
  const speechFixture = speech ? path.resolve(speechPorts[process.platform]) : undefined;
  await app.evaluate(
    ({ app }, { speech, speechFixture }) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const path = require('node:path');
      const root = app.getAppPath();
      const { ChatGPTAuthService } = require(
        path.join(root, 'dist-electron/shared/electron/backend/auth/service.js'),
      );
      const { ChatGPTService } = require(
        path.join(root, 'dist-electron/shared/electron/backend/chat/service.js'),
      );
      const session = () =>
        globalThis.uiAccountActive
          ? {
              mode: 'chatgpt',
              user: { id: 'synthetic-account', name: 'Test', email: '' },
              expiresAt: Date.now() + 3600000,
            }
          : null;
      ChatGPTAuthService.prototype.session = async () => session();
      ChatGPTAuthService.prototype.signIn = async () => {
        globalThis.uiAccountActive = true;
        return session();
      };
      ChatGPTAuthService.prototype.signOut = async () => {
        globalThis.uiAccountActive = false;
        return { warning: null };
      };
      ChatGPTService.prototype.models = async () => [
        {
          id: 'test-model',
          label: 'Test Model',
          description: '',
          provider: { id: 'chatgpt', name: 'ChatGPT', dataRecipient: 'OpenAI' },
          reasoningEfforts: ['low', 'high'],
        },
      ];
      ChatGPTService.prototype.usage = async () => ({
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        updatedAt: null,
      });
      ChatGPTService.prototype.stream = async (request, emit) => {
        emit({ id: request.id, type: 'delta', text: 'Synthetic interview answer' });
        return { answerText: 'Synthetic interview answer', usage: null, sources: [] };
      };
      if (speech) {
        require(speechFixture)(root);
      }
    },
    { speech, speechFixture },
  );
}
