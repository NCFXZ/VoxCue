import { randomUUID } from 'node:crypto';
import type {
  RemoteCommand,
  RemoteCommandResult,
  RemoteConnectionCall,
  RemoteInterviewSnapshot,
} from '../contracts/remoteConnection';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const text = (value: unknown, maximum: number) =>
  typeof value === 'string' && value.length <= maximum;
const revision = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

export function validateRemoteConnectionCall(value: unknown): RemoteConnectionCall {
  if (!object(value) || typeof value.op !== 'string') throw Error('Invalid remote request');
  if (['status', 'start', 'pair', 'disconnect'].includes(value.op) && keys(value, ['op']))
    return value as unknown as RemoteConnectionCall;
  if (
    ['approve', 'reject'].includes(value.op) &&
    keys(value, ['op', 'id']) &&
    text(value.id, 128) &&
    value.id
  )
    return value as unknown as RemoteConnectionCall;
  throw Error('Invalid remote request');
}

export function validateRemoteSnapshot(value: unknown): RemoteInterviewSnapshot {
  if (
    !object(value) ||
    !keys(value, [
      'sessionId',
      'sessionEpoch',
      'revision',
      'status',
      'inputMode',
      'transcripts',
      'answers',
      'pendingQuestion',
      'pendingQuestionRevision',
      'inputDraft',
      'generating',
      'aiEnabled',
      'microphoneMuted',
      'microphoneToggling',
      'micRevision',
      'autoAnswer',
      'autoAnswerRevision',
      'capabilities',
      'omitted',
    ])
  )
    throw Error('Invalid remote snapshot');
  if (
    !(value.sessionId === null || (text(value.sessionId, 128) && value.sessionId)) ||
    !revision(value.sessionEpoch) ||
    !revision(value.revision) ||
    !['idle', 'running', 'paused', 'ended'].includes(value.status as string) ||
    !['remote', 'transcription'].includes(value.inputMode as string) ||
    !text(value.pendingQuestion, 6000) ||
    !revision(value.pendingQuestionRevision) ||
    !revision(value.micRevision) ||
    !revision(value.autoAnswerRevision) ||
    !['generating', 'aiEnabled', 'microphoneMuted', 'microphoneToggling', 'autoAnswer'].every(
      (key) => typeof value[key] === 'boolean',
    ) ||
    !Array.isArray(value.transcripts) ||
    value.transcripts.length > 200 ||
    !Array.isArray(value.answers) ||
    value.answers.length > 40
  )
    throw Error('Invalid remote snapshot');
  for (const row of value.transcripts) {
    if (
      !object(row) ||
      !keys(row, ['id', 'text', 'time', 'final', 'source', 'textTruncated']) ||
      !text(row.id, 128) ||
      !row.id ||
      !text(row.text, 16000) ||
      !text(row.time, 128) ||
      typeof row.final !== 'boolean' ||
      (row.source !== undefined && !['microphone', 'system'].includes(row.source as string)) ||
      (row.textTruncated !== undefined && typeof row.textTruncated !== 'boolean')
    )
      throw Error('Invalid remote transcript');
  }
  for (const row of value.answers) {
    if (
      !object(row) ||
      !keys(row, ['id', 'question', 'content', 'status', 'error', 'contentTruncated']) ||
      !text(row.id, 128) ||
      !row.id ||
      !text(row.question, 6000) ||
      !text(row.content, 128000) ||
      (row.status !== undefined &&
        !['streaming', 'completed', 'stopped', 'failed'].includes(row.status as string)) ||
      (row.error !== undefined && !text(row.error, 2000)) ||
      (row.contentTruncated !== undefined && typeof row.contentTruncated !== 'boolean')
    )
      throw Error('Invalid remote answer');
  }
  const capabilities = value.capabilities;
  const inputDraft = value.inputDraft;
  if (
    !object(inputDraft) ||
    !keys(inputDraft, ['text', 'revision', 'manual', 'truncated']) ||
    !text(inputDraft.text, 6000) ||
    !revision(inputDraft.revision) ||
    typeof inputDraft.manual !== 'boolean' ||
    (inputDraft.truncated !== undefined && typeof inputDraft.truncated !== 'boolean')
  )
    throw Error('Invalid remote input draft');
  if (
    !object(capabilities) ||
    !keys(capabilities, ['sendQuestion', 'setMicrophone', 'setAutoAnswer', 'stopAnswer']) ||
    !['sendQuestion', 'setMicrophone', 'setAutoAnswer', 'stopAnswer'].every(
      (key) => typeof capabilities[key] === 'boolean',
    )
  )
    throw Error('Invalid remote capabilities');
  if (
    !object(value.omitted) ||
    !keys(value.omitted, ['transcripts', 'answers']) ||
    !revision(value.omitted.transcripts) ||
    !revision(value.omitted.answers)
  )
    throw Error('Invalid remote limits');
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 1024 * 1024)
    throw Error('Remote snapshot exceeds limit');
  return value as unknown as RemoteInterviewSnapshot;
}

export function validateRemoteResult(value: unknown): RemoteCommandResult {
  if (
    !object(value) ||
    !keys(value, ['requestId', 'ok', 'error', 'answerId', 'inputDraftRevision']) ||
    !text(value.requestId, 128) ||
    !value.requestId ||
    typeof value.ok !== 'boolean' ||
    (value.error !== undefined && !text(value.error, 1000)) ||
    (value.answerId !== undefined && (!text(value.answerId, 128) || !value.answerId)) ||
    (value.inputDraftRevision !== undefined && !revision(value.inputDraftRevision))
  )
    throw Error('Invalid remote result');
  return value as unknown as RemoteCommandResult;
}

/** Main-process request ownership; business state remains in the interview store. */
export class RemoteInterviewCoordinator {
  private snapshot: RemoteInterviewSnapshot | null = null;
  private pending = new Map<
    string,
    { command: RemoteCommand; finish(result: RemoteCommandResult): void }
  >();
  constructor(private readonly send: (command: RemoteCommand) => boolean) {}

  publish(snapshot: RemoteInterviewSnapshot) {
    if (
      this.snapshot &&
      snapshot.sessionId === this.snapshot.sessionId &&
      snapshot.sessionEpoch === this.snapshot.sessionEpoch &&
      snapshot.revision <= this.snapshot.revision
    )
      return false;
    if (
      snapshot.sessionId !== this.snapshot?.sessionId ||
      snapshot.sessionEpoch !== this.snapshot?.sessionEpoch ||
      snapshot.status === 'ended'
    )
      this.cancelPending();
    this.snapshot = snapshot;
    return true;
  }

  dispatch(command: RemoteCommand, signal?: AbortSignal): Promise<RemoteCommandResult> {
    const snapshot = this.snapshot;
    if (
      !snapshot ||
      !['running', 'paused'].includes(snapshot.status) ||
      command.sessionId !== snapshot.sessionId ||
      command.sessionEpoch !== snapshot.sessionEpoch ||
      signal?.aborted
    )
      return Promise.resolve({
        requestId: command.requestId,
        ok: false,
        error: '当前面试不可远程操作。',
      });
    if (this.pending.size >= 32)
      return Promise.resolve({
        requestId: command.requestId,
        ok: false,
        error: '远程操作正在处理，请稍后重试。',
      });
    // Network request IDs may be reused after authorization changes. Renderer
    // acknowledgements must identify this dispatch, never an old phone request.
    const forwarded = { ...command, requestId: randomUUID() };
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const abort = () =>
        finish({ requestId: command.requestId, ok: false, error: '远程操作已取消。' });
      const finish = (result: RemoteCommandResult) => {
        if (!this.pending.delete(forwarded.requestId)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        resolve({ ...result, requestId: command.requestId });
      };
      this.pending.set(forwarded.requestId, { command: forwarded, finish });
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(
        () =>
          finish({
            requestId: command.requestId,
            ok: false,
            error: '远程操作结果未确认，请同步状态后检查。',
          }),
        10000,
      );
      timer.unref?.();
      try {
        if (!this.send(forwarded)) abort();
      } catch {
        abort();
      }
    });
  }

  complete(result: RemoteCommandResult) {
    const pending = this.pending.get(result.requestId);
    if (!pending) return;
    if (
      pending.command.sessionId !== this.snapshot?.sessionId ||
      pending.command.sessionEpoch !== this.snapshot?.sessionEpoch
    )
      pending.finish({
        requestId: result.requestId,
        ok: false,
        error: '面试已切换，远程操作已取消。',
      });
    else pending.finish(result);
  }

  private cancelPending() {
    for (const { command, finish } of [...this.pending.values()])
      finish({ requestId: command.requestId, ok: false, error: '面试已切换，远程操作已取消。' });
  }

  reset() {
    this.cancelPending();
    this.snapshot = null;
  }
}
