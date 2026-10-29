// Only fixed categories and numeric summaries cross this boundary. Never add content here.
export const telemetryFeatures = [
  'chat_send',
  'file_import',
  'profile_edit',
  'history_view',
  'knowledge_view',
  'interview',
  'history_export',
  'data_export',
] as const;
export type TelemetryFeature = (typeof telemetryFeatures)[number];
export type TelemetrySignal =
  | { type: 'ready' }
  | { type: 'feature'; feature: TelemetryFeature }
  | { type: 'manual_question' }
  | { type: 'interview_saved'; saved: boolean };
export type TelemetryStage =
  'preflight' | 'model' | 'permission' | 'audio' | 'window' | 'storage' | 'process';
export type TelemetryIdentity = {
  accountMode: 'signed_out' | 'local' | 'account';
  userId?: string;
};
export interface InterviewMetrics {
  interviewId: string;
  startedAt: number | null;
  activeMs: number;
  transcriptCount: number;
  manualQuestionCount: number;
  answerCount: number;
  effective: boolean;
  sequence: number;
}
export type TelemetryData =
  | { type: 'app_ready' }
  | {
      type: 'account_entry';
      method: 'login' | 'register' | 'restore' | 'local';
      userCreatedAt?: number;
    }
  | { type: 'feature'; feature: TelemetryFeature }
  | { type: 'interview_attempt'; interviewId: string }
  | { type: 'interview_started'; interviewId: string; startedAt: number }
  | ({ type: 'interview_progress' } & InterviewMetrics)
  | ({
      type: 'interview_ended';
      outcome: 'completed' | 'failed' | 'interrupted';
      stage?: TelemetryStage;
    } & InterviewMetrics)
  | {
      type: 'ai_request';
      requestId: string;
      context: 'chat' | 'interview';
      interviewId?: string;
      outcome: 'success' | 'failure' | 'cancelled';
      elapsedMs: number;
      firstAnswerMs?: number;
    };
export interface TelemetryEvent extends TelemetryIdentity {
  schemaVersion: 1;
  id: string;
  installationId: string;
  firstSeenAt: number;
  runId: string;
  occurredAt: number;
  version: string;
  platform: 'macos' | 'windows';
  data: TelemetryData;
}
export const telemetryUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) =>
  Object.keys(v).every((k) => names.includes(k));
const number = (v: unknown) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
export function validTelemetrySignal(v: unknown): v is TelemetrySignal {
  if (!object(v)) return false;
  if (v.type === 'ready' || v.type === 'manual_question') return keys(v, ['type']);
  if (v.type === 'feature')
    return (
      keys(v, ['type', 'feature']) && telemetryFeatures.includes(v.feature as TelemetryFeature)
    );
  return v.type === 'interview_saved' && keys(v, ['type', 'saved']) && typeof v.saved === 'boolean';
}
export function validTelemetryEvent(v: unknown): v is TelemetryEvent {
  if (
    !object(v) ||
    !keys(v, [
      'schemaVersion',
      'id',
      'installationId',
      'firstSeenAt',
      'runId',
      'occurredAt',
      'version',
      'platform',
      'accountMode',
      'userId',
      'data',
    ]) ||
    v.schemaVersion !== 1 ||
    ![v.id, v.installationId, v.runId].every(telemetryUuid) ||
    !number(v.occurredAt) ||
    !number(v.firstSeenAt) ||
    typeof v.version !== 'string' ||
    v.version.length > 64 ||
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(v.version) ||
    !['macos', 'windows'].includes(String(v.platform)) ||
    !['signed_out', 'local', 'account'].includes(String(v.accountMode)) ||
    (v.accountMode === 'account' ? !telemetryUuid(v.userId) : v.userId !== undefined) ||
    !object(v.data)
  )
    return false;
  const d = v.data;
  if (d.type === 'app_ready') return keys(d, ['type']);
  if (d.type === 'feature')
    return (
      keys(d, ['type', 'feature']) && telemetryFeatures.includes(d.feature as TelemetryFeature)
    );
  if (d.type === 'account_entry')
    return (
      keys(d, ['type', 'method', 'userCreatedAt']) &&
      ['login', 'register', 'restore', 'local'].includes(String(d.method)) &&
      (d.userCreatedAt === undefined || number(d.userCreatedAt))
    );
  if (d.type === 'interview_attempt')
    return keys(d, ['type', 'interviewId']) && telemetryUuid(d.interviewId);
  if (d.type === 'interview_started')
    return (
      keys(d, ['type', 'interviewId', 'startedAt']) &&
      telemetryUuid(d.interviewId) &&
      number(d.startedAt)
    );
  if (d.type === 'ai_request')
    return (
      keys(d, [
        'type',
        'requestId',
        'context',
        'interviewId',
        'outcome',
        'elapsedMs',
        'firstAnswerMs',
      ]) &&
      telemetryUuid(d.requestId) &&
      ['chat', 'interview'].includes(String(d.context)) &&
      (d.interviewId === undefined || telemetryUuid(d.interviewId)) &&
      ['success', 'failure', 'cancelled'].includes(String(d.outcome)) &&
      number(d.elapsedMs) &&
      (d.firstAnswerMs === undefined ||
        (number(d.firstAnswerMs) && (d.firstAnswerMs as number) <= (d.elapsedMs as number)))
    );
  return (
    ['interview_progress', 'interview_ended'].includes(String(d.type)) &&
    keys(d, [
      'type',
      'interviewId',
      'startedAt',
      'activeMs',
      'transcriptCount',
      'manualQuestionCount',
      'answerCount',
      'effective',
      'sequence',
      ...(d.type === 'interview_ended' ? ['outcome', 'stage'] : []),
    ]) &&
    telemetryUuid(d.interviewId) &&
    (d.startedAt === null || number(d.startedAt)) &&
    [d.activeMs, d.transcriptCount, d.manualQuestionCount, d.answerCount, d.sequence].every(
      number,
    ) &&
    typeof d.effective === 'boolean' &&
    (d.type !== 'interview_ended' ||
      (['completed', 'failed', 'interrupted'].includes(String(d.outcome)) &&
        (d.stage === undefined ||
          ['preflight', 'model', 'permission', 'audio', 'window', 'storage', 'process'].includes(
            String(d.stage),
          ))))
  );
}
