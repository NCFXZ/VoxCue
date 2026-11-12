import type { InterviewInputMode } from './speech';

export const REMOTE_PROTOCOL_VERSION = 2;

export interface RemoteConnectionState {
  presentationOwner?: 'main' | 'interview';
  status: 'off' | 'waiting' | 'connected' | 'reconnecting' | 'error';
  revision: number;
  addresses: string[];
  clientName: string | null;
  pending: { id: string; name: string; code: string } | null;
  error: string | null;
}
export interface RemotePairing {
  url: string;
  expiresAt: number;
}
export type RemoteConnectionCall =
  { op: 'status' | 'start' | 'pair' | 'disconnect' } | { op: 'approve' | 'reject'; id: string };
export interface RemoteConnectionResult {
  state: RemoteConnectionState;
  pairing?: RemotePairing;
}
export interface RemoteInterviewSnapshot {
  sessionId: string | null;
  sessionEpoch: number;
  revision: number;
  status: 'idle' | 'running' | 'paused' | 'ended';
  inputMode: InterviewInputMode;
  transcripts: Array<{
    id: string;
    text: string;
    time: string;
    final: boolean;
    source?: 'microphone' | 'system';
    textTruncated?: boolean;
  }>;
  answers: Array<{
    id: string;
    question: string;
    content: string;
    status?: 'streaming' | 'completed' | 'stopped' | 'failed';
    error?: string;
    contentTruncated?: boolean;
  }>;
  pendingQuestion: string;
  pendingQuestionRevision: number;
  inputDraft: { text: string; revision: number; manual: boolean; truncated?: boolean };
  omitted: { transcripts: number; answers: number };
  generating: boolean;
  aiEnabled: boolean;
  microphoneMuted: boolean;
  microphoneToggling: boolean;
  micRevision: number;
  autoAnswer: boolean;
  autoAnswerRevision: number;
  capabilities: {
    sendQuestion: boolean;
    setMicrophone: boolean;
    setAutoAnswer: boolean;
    stopAnswer: boolean;
  };
}
export type RemoteCommand = {
  requestId: string;
  sessionId: string;
  sessionEpoch: number;
} & (
  | { action: 'set-microphone'; muted: boolean; expectedRevision: number }
  | { action: 'set-auto-answer'; enabled: boolean; expectedRevision: number }
  | { action: 'set-draft'; text: string; expectedRevision: number }
  | { action: 'ask'; text: string; pendingQuestionRevision?: number; inputDraftRevision?: number }
  | { action: 'stop-answer'; answerId: string }
);
export interface RemoteCommandResult {
  requestId: string;
  ok: boolean;
  error?: string;
  answerId?: string;
  inputDraftRevision?: number;
}
export type RemoteClientMessage =
  | { type: 'authenticate'; protocolVersion: typeof REMOTE_PROTOCOL_VERSION; pendingId: string }
  | { type: 'resume'; protocolVersion: typeof REMOTE_PROTOCOL_VERSION; token: string }
  | { type: 'query-result'; requestId: string }
  | { type: 'snapshot-applied'; sequence: number; deliveryId: string }
  | { type: 'sync' }
  | { type: 'disconnect' }
  | { type: 'command'; command: RemoteCommand };
export type RemoteServerMessage =
  | { type: 'pending'; id: string; code: string }
  | {
      type: 'paired';
      protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
      token: string;
      sequence: number;
      deliveryId: string;
      snapshot: RemoteInterviewSnapshot | null;
    }
  | {
      type: 'snapshot';
      sequence: number;
      deliveryId: string;
      snapshot: RemoteInterviewSnapshot | null;
    }
  | {
      type: 'scroll';
      scrollId: number;
      sessionId: string;
      sessionEpoch: number;
      direction: 'up' | 'down';
    }
  | { type: 'result'; result: RemoteCommandResult }
  | { type: 'command-pending'; requestId: string }
  | { type: 'disconnected' }
  | { type: 'error'; error: string };
