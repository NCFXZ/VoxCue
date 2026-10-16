import {
  CopilotClient,
  RuntimeConnection,
  type CopilotSession,
  type SessionConfig,
} from '@github/copilot-sdk';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export const isolatedSession: SessionConfig = {
  availableTools: [],
  systemMessage: { mode: 'replace', content: 'You are an assistant inside VoxCue.' },
  onPermissionRequest: () => ({ kind: 'reject' }),
  enableConfigDiscovery: false,
  enableOnDemandInstructionDiscovery: false,
  enableFileHooks: false,
  enableHostGitOperations: false,
  enableSessionStore: false,
  enableSkills: false,
  // Preserve empty-mode isolation explicitly while allowing OS-backed login.
  enableSessionTelemetry: false,
  mcpOAuthTokenStorage: 'in-memory',
  skipEmbeddingRetrieval: true,
  embeddingCacheStorage: 'in-memory',
  memory: { enabled: false },
  customAgentsLocalOnly: true,
  skipCustomInstructions: true,
  coauthorEnabled: false,
  manageScheduleEnabled: false,
  includedBuiltinSkills: [],
  pluginDirectories: [],
  enableExperimentalMode: false,
  remoteSession: 'off',
};

/** Only the official subprocess handles OAuth credentials. Nothing secret crosses IPC. */
export class CopilotRuntime {
  private clientPromise?: Promise<CopilotClient>;
  private controlPromise?: Promise<CopilotSession>;
  constructor(
    private directory: string,
    private executable?: string,
  ) {}
  client() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const workingDirectory = path.join(this.directory, 'workspace');
        await mkdir(workingDirectory, { recursive: true });
        const env = { ...process.env };
        // A login chosen in VoxCue must never inherit gh, PAT, BYOK, remote,
        // telemetry or another application's Copilot authentication/configuration.
        for (const key of Object.keys(env))
          if (/^(?:COPILOT_|GITHUB_|GH_|OTEL_)/i.test(key)) delete env[key];
        env.GH_CONFIG_DIR = path.join(this.directory, 'gh-unused');
        const client = new CopilotClient({
          ...(this.executable
            ? { connection: RuntimeConnection.forStdio({ path: this.executable }) }
            : {}),
          // SDK 1.0.21 forces COPILOT_DISABLE_KEYTAR=1 in empty mode,
          // which makes browser OAuth finish with needs-plaintext-consent.
          // This single-user desktop needs the OS vault; sessions stay isolated above.
          mode: 'copilot-cli',
          baseDirectory: this.directory,
          workingDirectory,
          env,
          logLevel: 'none',
          useLoggedInUser: true,
          enableRemoteSessions: false,
          clientInfo: { applicationName: 'VoxCue', integrationName: 'VoxCue Copilot' },
        });
        try {
          await client.start();
          return client;
        } catch (error) {
          await client.stop().catch(() => {});
          throw error;
        }
      })().catch((error) => {
        this.clientPromise = undefined;
        throw error;
      });
    }
    return this.clientPromise;
  }
  control() {
    return (this.controlPromise ??= this.client()
      .then((client) => client.createSession({ ...isolatedSession }))
      .catch((error) => {
        this.controlPromise = undefined;
        throw error;
      }));
  }
  async stop() {
    const client = this.clientPromise;
    const control = this.controlPromise;
    this.clientPromise = undefined;
    this.controlPromise = undefined;
    if (client)
      await client
        .then(async (value) => {
          const session = await control?.catch(() => undefined);
          if (session) await value.deleteSession(session.sessionId).catch(() => {});
          await value.stop();
        })
        .catch(() => {});
  }
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('操作已取消。'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
