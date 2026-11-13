import {
  CopilotClient,
  RuntimeConnection,
  type CopilotSession,
  type SessionConfig,
} from '@github/copilot-sdk';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { abortable } from '../cancellable';
import type { ProviderCredentialAccess } from '../auth/providerCredentialAccess';

const requirePackage = createRequire(__filename);
// The official subprocess must run from the package's physical unpacked tree.
// SDK auto-discovery can stat/chmod an ASAR virtual path, which cannot execute.
export function copilotRuntimeConnection() {
  const target =
    process.platform === 'darwin' && process.arch === 'arm64'
      ? 'darwin-arm64'
      : process.platform === 'win32' && process.arch === 'x64'
        ? 'win32-x64'
        : null;
  if (!target) throw Error('当前平台无法启动固定 Copilot 运行时。');
  const manifest = requirePackage.resolve(`@github/copilot-sdk-${target}/package.json`);
  if (requirePackage(manifest).version !== '1.0.21')
    throw Error('固定 Copilot 运行时不可用，请重新安装软件。');
  const binary = path.join(
    path.dirname(manifest),
    'prebuilds',
    target,
    process.platform === 'win32' ? 'copilot-runtime.exe' : 'copilot-runtime',
  );
  return RuntimeConnection.forStdio({
    path: binary.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2'),
  });
}

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
  private clientValue?: CopilotClient;
  private generation = 0;
  private stopping?: Promise<void>;
  private interruptStop?: () => void;
  constructor(
    private directory: string,
    private credentialAccess?: ProviderCredentialAccess,
  ) {}
  client() {
    if (this.credentialAccess?.denied) return Promise.reject(this.credentialAccess.block());
    if (this.stopping) return Promise.reject(Error('Copilot runtime is stopping'));
    if (!this.clientPromise) {
      const generation = this.generation;
      const pending = (async () => {
        const workingDirectory = path.join(this.directory, 'workspace');
        await mkdir(workingDirectory, { recursive: true });
        this.credentialAccess?.check();
        if (generation !== this.generation) throw Error('Copilot runtime stopped');
        const env = { ...process.env };
        // A login chosen in VoxCue must never inherit gh, PAT, BYOK, remote,
        // telemetry or another application's Copilot authentication/configuration.
        for (const key of Object.keys(env))
          if (/^(?:COPILOT_|GITHUB_|GH_|OTEL_)/i.test(key)) delete env[key];
        env.GH_CONFIG_DIR = path.join(this.directory, 'gh-unused');
        const client = new CopilotClient({
          connection: copilotRuntimeConnection(),
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
        this.clientValue = client;
        try {
          await client.start();
          if (generation !== this.generation) throw Error('Copilot runtime stopped');
          return client;
        } catch (error) {
          if (!this.credentialAccess?.denied) await client.forceStop().catch(() => {});
          if (this.clientValue === client) this.clientValue = undefined;
          throw error;
        }
      })().catch((error) => {
        if (this.clientPromise === pending) this.clientPromise = undefined;
        throw error;
      });
      this.clientPromise = pending;
    }
    return this.clientPromise;
  }
  control() {
    if (this.credentialAccess?.denied) return Promise.reject(this.credentialAccess.block());
    if (this.stopping) return Promise.reject(Error('Copilot runtime is stopping'));
    if (this.controlPromise) return this.controlPromise;
    const generation = this.generation;
    const pending = this.client()
      .then(async (client) => {
        if (generation !== this.generation) throw Error('Copilot runtime stopped');
        const session = await client.createSession({ ...isolatedSession });
        if (generation !== this.generation) {
          if (!this.credentialAccess?.denied) await client.forceStop().catch(() => {});
          throw Error('Copilot runtime stopped');
        }
        return session;
      })
      .catch((error) => {
        if (this.controlPromise === pending) this.controlPromise = undefined;
        throw error;
      });
    this.controlPromise = pending;
    return pending;
  }
  stop(force = false) {
    if (this.stopping) {
      if (force || this.credentialAccess?.denied) this.interruptStop?.();
      return this.stopping;
    }
    ++this.generation;
    const client = this.clientValue;
    const control = this.controlPromise;
    this.clientPromise = undefined;
    this.controlPromise = undefined;
    this.clientValue = undefined;
    const work = (async () => {
      if (!client) return;
      if (force || this.credentialAccess?.denied) {
        await client.forceStop();
        return;
      }
      const timeout = new AbortController();
      this.interruptStop = () => timeout.abort();
      const timer = setTimeout(() => timeout.abort(), 5000);
      try {
        await abortable(
          (async () => {
            const session = await control?.catch(() => undefined);
            timeout.signal.throwIfAborted();
            if (session) await client.deleteSession(session.sessionId).catch(() => {});
            timeout.signal.throwIfAborted();
            await client.stop();
          })(),
          timeout.signal,
        );
      } catch {
        await client.forceStop().catch(() => {});
      } finally {
        clearTimeout(timer);
        this.interruptStop = undefined;
      }
    })().finally(() => {
      if (this.stopping === work) this.stopping = undefined;
    });
    this.stopping = work;
    return work;
  }
}
