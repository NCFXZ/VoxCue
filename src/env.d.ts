interface Window {
  desktop?: {
    windowAction(action: 'minimize' | 'maximize' | 'close'): void;
    openInterview(): Promise<void>;
    interviewState(): Promise<{ protected: boolean; pinned: boolean; supported: boolean }>;
    allowCapture(allowed: boolean): Promise<boolean>;
    togglePin(): Promise<boolean>;
  };
}
