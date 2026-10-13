export interface SpeechRecognitionService {
  start(onTranscript: (text: string, final: boolean) => void, signal: AbortSignal): Promise<void>;
}
export interface AIModelService {
  streamAnswer(
    question: string,
    onChunk: (chunk: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
}
export interface Transcript {
  source?: 'microphone' | 'system';
  startMs?: number;
  endMs?: number;
  id: string;
  text: string;
  time: string;
  final: boolean;
}
export interface Answer {
  sourceTranscriptIds?: string[];
  createdAt?: number;
  reasoningSummary?: string;
  activity?: import('../../electron/contracts/chat').ChatActivity;
  provider?: 'mock' | 'chatgpt';
  id: string;
  question: string;
  content: string;
}
