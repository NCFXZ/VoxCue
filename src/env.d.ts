interface Window {
  desktop?: {
    authSession(): Promise<import('../electron/contracts/auth').AuthSession | null>;
    signInWithChatGPT(): Promise<import('../electron/contracts/auth').AuthSession>;
    cancelSignIn(): Promise<void>;
    enterDemo(): Promise<import('../electron/contracts/auth').AuthSession>;
    signOut(): Promise<import('../electron/contracts/auth').SignOutResult>;
    windowAction(action: 'minimize' | 'maximize' | 'close'): void;
    openInterview(): Promise<void>;
    interviewState(): Promise<{ protected: boolean; pinned: boolean; supported: boolean }>;
    allowCapture(allowed: boolean): Promise<boolean>;
    togglePin(): Promise<boolean>;
  };
}
