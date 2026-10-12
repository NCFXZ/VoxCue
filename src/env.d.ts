interface Window {
  desktop?: {
    authSession(): Promise<import('../electron/contracts/auth').AuthSession | null>;
    signInWithChatGPT(): Promise<import('../electron/contracts/auth').AuthSession>;
    cancelSignIn(): Promise<void>;
    enterDemo(): Promise<import('../electron/contracts/auth').AuthSession>;
    signOut(): Promise<import('../electron/contracts/auth').SignOutResult>;
    chatModels(
      force?: boolean,
    ): Promise<
      | { ok: true; models: import('../electron/contracts/chat').ChatModel[] }
      | { ok: false; error: import('../electron/contracts/chat').ChatFailure }
    >;
    chatUsage(): Promise<
      | { ok: true; usage: import('../electron/contracts/chat').AppUsage }
      | { ok: false; error: import('../electron/contracts/chat').ChatFailure }
    >;
    chatSend(
      request: import('../electron/contracts/chat').ChatRequest,
    ): Promise<import('../electron/contracts/chat').ChatResult>;
    chatCancel(id: string): Promise<void>;
    chatOpenLink(url: string): Promise<void>;
    onChatEvent(
      callback: (event: import('../electron/contracts/chat').ChatEvent) => void,
    ): () => void;
    windowAction(action: 'minimize' | 'maximize' | 'close'): void;
    openInterview(): Promise<void>;
    interviewState(): Promise<{ protected: boolean; pinned: boolean; supported: boolean }>;
    allowCapture(allowed: boolean): Promise<boolean>;
    togglePin(): Promise<boolean>;
  };
}
