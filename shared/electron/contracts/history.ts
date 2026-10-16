export interface InterviewTitleRequest {
  recordId: string;
  modelId: string;
  questions: string[];
}
export interface InterviewTitleEvent {
  recordId: string;
  title?: string;
  error?: string;
}
export interface HistoryExportRequest {
  title: string;
  text: string;
}
