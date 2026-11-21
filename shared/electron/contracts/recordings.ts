export interface PlayableRecording {
  id: string;
  startedAt: number;
  durationMs: number;
  url: string;
}
export interface UnavailableRecording {
  id: string;
  startedAt: number;
  unavailable: true;
}
export type RecordingSegment = PlayableRecording | UnavailableRecording;
export const playableRecording = (clip: RecordingSegment): clip is PlayableRecording => 'url' in clip;

export type RecordingCall =
  | { op: 'list' | 'remove' | 'stage-remove' | 'restore-remove' | 'finish-remove'; recordId: string }
  | { op: 'export'; recordId: string; ids: string[]; title: string };

export const recordingRecordId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
