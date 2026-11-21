import path from 'node:path';
import { KnowledgeCoordinator } from './application/knowledge';
import { SelectedChatService } from './application/providers';
import { RagChatService } from './application/rag';
import { ProfileApiConnections } from './application/apiConnections';
import { ApiCredentialStore } from './backend/api/credentials';
import { createApiChatService, readApiBalance } from './backend/api/service';
import { isApiProvider } from './contracts/apiConnections';
import type { AIService } from './contracts/auth';
import type { CredentialEncryption } from './backend/auth/storage';
import { profileDirectory } from './accountProfilePaths';
import { ProviderCredentialAccess } from './backend/auth/providerCredentialAccess';
import { ChatGPTAuthService } from './backend/auth/service';
import { ChatGPTAccountUsage } from './backend/chat/accountUsage';
import { CodexUsageRuntime } from './backend/chat/codexUsage';
import { ChatGPTService } from './backend/chat/service';
import { UsageLedger } from './backend/chat/usage';
import { CopilotAuthService } from './backend/copilot/auth';
import { CopilotRuntime } from './backend/copilot/runtime';
import { CopilotChatService } from './backend/copilot/service';
import { createCopilotLoginStorage, createServiceSelection } from './backend/copilot/storage';
import { InterviewImageStore } from './backend/interview/images';
import { KnowledgeHost } from './backend/knowledge/host';
import type { PrepareKnowledgeDatabase } from './platform/types';
import type { KnowledgeEvent } from './contracts/knowledge';

// Surface a failure only after every independent writer or runtime has settled.
export async function waitForProfileCleanup(jobs: (Promise<unknown> | undefined)[]) {
  const results = await Promise.allSettled(jobs);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
}

/** Every asynchronous request retains the same stores, credential runtime and data root. */
export function createAccountProfile(
  owner: string,
  ports: {
    root: string;
    version: string;
    ragModel: string;
    prepareKnowledgeDatabase?: PrepareKnowledgeDatabase;
    codexLoginStatus: ConstructorParameters<typeof CodexUsageRuntime>[3];
    credentialLabel?: string;
    credentialEncryption?: CredentialEncryption;
    openBrowser(url: string): Promise<void>;
    emit(status: KnowledgeEvent): void;
    interviewActive(): boolean;
    changing(): boolean;
    requireModel(): void;
  },
) {
  const root = profileDirectory(ports.root, owner);
  const codex = new CodexUsageRuntime(
    path.join(root, 'chatgpt-usage'),
    undefined,
    ports.version,
    ports.codexLoginStatus,
  );
  const auth = new ChatGPTAuthService(codex, ports.openBrowser);
  const ledger = new UsageLedger(path.join(root, 'chat-usage'));
  const api = new ProfileApiConnections(new ApiCredentialStore(root, ports.credentialEncryption), {
    chat: (provider, credential) => createApiChatService(provider, credential, ledger),
    balance: readApiBalance,
  });
  const chatGPT = new ChatGPTService({
    access: () => auth.access(),
    ledger,
    accountUsage: new ChatGPTAccountUsage({ runtime: codex, identity: () => auth.usageIdentity() }),
  });
  const credentialAccess = new ProviderCredentialAccess('copilot', () => {
    void copilotRuntime.stop().catch(() => {});
  });
  const copilotRuntime = new CopilotRuntime(path.join(root, 'copilot-runtime'), credentialAccess);
  const control = () => copilotRuntime.control();
  const retire = () => copilotRuntime.stop(true);
  const copilotAuth = new CopilotAuthService({
    credentialAccess,
    retire,
    control,
    credentialEncryptionLabel: ports.credentialLabel,
    storage: createCopilotLoginStorage(root),
    openBrowser: ports.openBrowser,
  });
  const copilot = new CopilotChatService({
    credentialAccess,
    retire,
    control,
    ledger,
    client: () => copilotRuntime.client(),
    access: (signal) => copilotAuth.access(signal),
  });
  const selection = createServiceSelection(root);
  // A bad preference can still be repaired by an explicit provider choice.
  void selection.ready.catch(() => {});
  let closed = false;
  const chat = new SelectedChatService(() => {
    if (closed || ports.changing()) throw Error('账户正在变更，请稍后重试。');
    if (isApiProvider(selection.service)) {
      if (!selection.connected) throw Error('请先连接 AI 服务。');
      return api.chat(selection.service);
    }
    return selection.service === 'copilot' ? copilot : chatGPT;
  });
  const knowledge = new KnowledgeHost(path.join(root, 'knowledge-v1'), ports.ragModel,
    (event) => coordinator.progress(event), ports.prepareKnowledgeDatabase);
  const coordinator = new KnowledgeCoordinator(
    knowledge,
    ports.ragModel,
    ports.emit,
    ports.interviewActive,
  );
  const images = new InterviewImageStore(path.join(root, 'interview-images-v1'));
  const invalidateModels = () => {
    api.invalidateModels();
    chatGPT.invalidateModels();
    copilot.invalidateModels();
  };
  return {
    owner,
    auth,
    copilotAuth,
    copilotRuntime,
    selection,
    api,
    session(service: AIService, verify = false) {
      if (isApiProvider(service)) return api.session(service);
      if (service === 'copilot') return verify ? copilotAuth.verifiedSession() : copilotAuth.session();
      return auth.session();
    },
    chat,
    knowledge,
    coordinator,
    images,
    ragChat: new RagChatService(chat, knowledge, ports.requireModel),
    invalidateModels,
    async dispose(erase = false) {
      closed = true;
      const selectionDone = selection.dispose();
      invalidateModels();
      auth.cancel();
      copilotAuth.cancel();
      coordinator.cancelAll();
      try {
        if (erase) await waitForProfileCleanup([
          auth.signOut(),
          copilotAuth.isPending() ? undefined : copilotAuth.signOut(),
        ]);
      } finally {
        await waitForProfileCleanup([
          api.dispose(),
          selectionDone,
          knowledge.close(),
          images.dispose(),
          ledger.dispose(),
          codex.stop(),
          copilotRuntime.stop(),
        ]);
      }
    },
  };
}
