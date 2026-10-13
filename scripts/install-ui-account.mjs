// Called only by Playwright in an isolated test process. No real OAuth/AI/audio.
export async function installUiAccount(app, { speech = false } = {}) {
  await app.evaluate(
    ({ app }, { speech }) => {
      const require = process
        .getBuiltinModule('module')
        .createRequire(app.getAppPath() + '/package.json');
      const path = require('node:path');
      const root = app.getAppPath();
      const { ChatGPTAuthService } = require(
        path.join(root, 'dist-electron/backend/auth/service.js'),
      );
      const { ChatGPTService } = require(path.join(root, 'dist-electron/backend/chat/service.js'));
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
        const { InterviewAccess } = require(
          path.join(root, 'dist-electron/backend/speech/access.js'),
        );
        InterviewAccess.prototype.check = async (options) => ({
          ready: true,
          devices: [],
          checks: options.sources.map((source) => ({
            source,
            status: 'granted',
            message: 'Synthetic device check',
          })),
        });
        const { SpeechHost } = require(path.join(root, 'dist-electron/backend/speech/host.js'));
        SpeechHost.prototype.call = async function (call) {
          if (call.op === 'start')
            setTimeout(
              () =>
                this.emit({
                  type: 'segment',
                  segment: {
                    id: 'synthetic-system',
                    source: 'system',
                    text: 'Synthetic interviewer question',
                    final: true,
                    startMs: 0,
                    endMs: 1000,
                    reason: 'silence',
                  },
                }),
              50,
            );
          return {
            state: call.op === 'start' ? 'running' : 'idle',
            model: 'Synthetic speech port',
            devices: [],
          };
        };
        SpeechHost.prototype.stop = () => {};
      }
    },
    { speech },
  );
}
