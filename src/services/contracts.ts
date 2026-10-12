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
export interface KnowledgeBaseService {
  search(query: string, signal?: AbortSignal): Promise<Array<{ id: string; content: string }>>;
}
export interface Transcript {
  id: string;
  text: string;
  time: string;
  final: boolean;
}
export interface Answer {
  id: string;
  question: string;
  content: string;
}
