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
  reason?: import('../../electron/contracts/speech').SpeechSegment['reason'];
  source?: 'microphone' | 'system';
  startMs?: number;
  endMs?: number;
  id: string;
  text: string;
  time: string;
  final: boolean;
}
export interface Answer {
  screenshot?: import('../../electron/contracts/speech').InterviewScreenshotMode;
  status?: 'streaming' | 'completed' | 'stopped' | 'failed';
  error?: string;
  sourceTranscriptIds?: string[];
  createdAt?: number;
  reasoningSummary?: string;
  activity?: import('../../electron/contracts/chat').ChatActivity;
  provider?: string | import('../../electron/contracts/chat').ModelProvider;
  id: string;
  question: string;
  content: string;
}
