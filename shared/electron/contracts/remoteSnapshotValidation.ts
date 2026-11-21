import type { RemoteInterviewSnapshot } from './remoteConnection';

export const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const text = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.length <= maximum;
export const revision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

export function validRemoteSnapshot(value: unknown): value is RemoteInterviewSnapshot | null {
  if (value === null) return true;
  if (
    !record(value) ||
    !(value.sessionId === null || text(value.sessionId, 128)) ||
    !revision(value.sessionEpoch) ||
    !revision(value.revision) ||
    !revision(value.micRevision) ||
    !revision(value.autoAnswerRevision) ||
    !revision(value.pendingQuestionRevision) ||
    !record(value.inputDraft) ||
    !text(value.inputDraft.text, 6000) ||
    !revision(value.inputDraft.revision) ||
    typeof value.inputDraft.manual !== 'boolean' ||
    (value.inputDraft.truncated !== undefined && typeof value.inputDraft.truncated !== 'boolean') ||
    !text(value.pendingQuestion, 6000) ||
    !['idle', 'running', 'paused', 'ended'].includes(value.status as string) ||
    !['remote', 'transcription'].includes(value.inputMode as string) ||
    !['generating', 'aiEnabled', 'microphoneMuted', 'microphoneToggling', 'autoAnswer'].every(
      (key) => typeof value[key] === 'boolean',
    ) ||
    !record(value.capabilities) ||
    !['sendQuestion', 'setMicrophone', 'setAutoAnswer', 'stopAnswer'].every(
      (key) => typeof (value.capabilities as Record<string, unknown>)[key] === 'boolean',
    ) ||
    !record(value.omitted) ||
    !revision(value.omitted.transcripts) ||
    !revision(value.omitted.answers) ||
    !Array.isArray(value.transcripts) ||
    value.transcripts.length > 200 ||
    !Array.isArray(value.answers) ||
    value.answers.length > 40
  )
    return false;
  return (
    value.transcripts.every(
      (row) =>
        record(row) &&
        text(row.id, 128) &&
        text(row.text, 16000) &&
        text(row.time, 128) &&
        typeof row.final === 'boolean' &&
        (row.source === undefined || ['microphone', 'system'].includes(row.source as string)) &&
        (row.textTruncated === undefined || typeof row.textTruncated === 'boolean'),
    ) &&
    value.answers.every(
      (row) =>
        record(row) &&
        text(row.id, 128) &&
        text(row.question, 6000) &&
        text(row.content, 128000) &&
        (row.error === undefined || text(row.error, 2000)) &&
        (row.status === undefined ||
          ['streaming', 'completed', 'stopped', 'failed'].includes(row.status as string)) &&
        (row.contentTruncated === undefined || typeof row.contentTruncated === 'boolean'),
    )
  );
}
