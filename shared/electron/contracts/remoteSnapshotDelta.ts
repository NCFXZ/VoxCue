import { REMOTE_SNAPSHOT_MAX_BYTES } from './remoteConnection';
import type {
  RemoteInterviewSnapshot,
  RemoteRowDelta,
  RemoteSnapshotControls,
  RemoteSnapshotDelta,
} from './remoteConnection';
import { record, revision, validRemoteSnapshot } from './remoteSnapshotValidation';

const controls = {
  status: true,
  inputMode: true,
  pendingQuestion: true,
  pendingQuestionRevision: true,
  inputDraft: true,
  omitted: true,
  generating: true,
  aiEnabled: true,
  microphoneMuted: true,
  microphoneToggling: true,
  micRevision: true,
  autoAnswer: true,
  autoAnswerRevision: true,
  capabilities: true,
} satisfies Record<keyof RemoteSnapshotControls, true>;
const bounded = (value: unknown, max: number): value is number => revision(value) && value <= max;

function sameMetadata<Row extends { id: string }>(old: Row, row: Row, textKey: keyof Row) {
  for (const key in old) if (key !== textKey && old[key] !== row[key]) return false;
  for (const key in row) if (key !== textKey && old[key] !== row[key]) return false;
  return true;
}

function differRows<Row extends { id: string }>(before: Row[], after: Row[], textKey: keyof Row) {
  const first = after.length ? before.findIndex((row) => row.id === after[0].id) : before.length;
  const drop = Math.max(0, first);
  const changes: RemoteRowDelta<Row>['changes'] = [];
  for (const [at, row] of after.entries()) {
    const old = before[drop + at];
    if (old === row) continue;
    if (old && sameMetadata(old, row, textKey)) {
      const oldText = old[textKey],
        newText = row[textKey];
      if (oldText === newText) continue;
      if (
        typeof oldText === 'string' &&
        typeof newText === 'string' &&
        newText.startsWith(oldText)
      ) {
        changes.push({ at, id: row.id, append: newText.slice(oldText.length) });
        continue;
      }
    }
    changes.push({ at, row });
  }
  return drop || before.length !== after.length || changes.length
    ? { drop, length: after.length, changes }
    : undefined;
}

export function createSnapshotDelta(
  before: RemoteInterviewSnapshot,
  after: RemoteInterviewSnapshot,
): RemoteSnapshotDelta | null {
  if (
    !before.sessionId ||
    before.sessionId !== after.sessionId ||
    before.sessionEpoch !== after.sessionEpoch ||
    after.revision <= before.revision
  )
    return null;
  const changed = (Object.keys(controls) as (keyof RemoteSnapshotControls)[]).filter((key) =>
    typeof after[key] === 'object'
      ? JSON.stringify(before[key]) !== JSON.stringify(after[key])
      : before[key] !== after[key],
  );
  const transcripts = differRows(before.transcripts, after.transcripts, 'text');
  const answers = differRows(before.answers, after.answers, 'content');
  return {
    sessionId: before.sessionId,
    sessionEpoch: before.sessionEpoch,
    baseRevision: before.revision,
    revision: after.revision,
    ...(changed.length
      ? { controls: Object.fromEntries(changed.map((key) => [key, after[key]])) }
      : {}),
    ...(transcripts ? { transcripts } : {}),
    ...(answers ? { answers } : {}),
  };
}

function restoreRows<Row extends { id: string }>(
  previous: Row[],
  delta: unknown,
  limit: number,
  textKey: keyof Row,
  textLimit: number,
): Row[] | null {
  if (delta === undefined) return previous;
  if (
    !record(delta) ||
    !bounded(delta.drop, previous.length) ||
    !bounded(delta.length, limit) ||
    !Array.isArray(delta.changes) ||
    delta.changes.length > delta.length
  )
    return null;
  const rows = previous.slice(delta.drop, delta.drop + delta.length);
  let last = -1;
  for (const change of delta.changes) {
    if (
      !record(change) ||
      !bounded(change.at, delta.length - 1) ||
      change.at <= last ||
      change.at > rows.length
    )
      return null;
    last = change.at;
    if ('row' in change) {
      if (!record(change.row) || Object.keys(change).length !== 2) return null;
      rows[change.at] = change.row as Row;
    } else {
      const old = rows[change.at];
      const text = old?.[textKey];
      if (
        Object.keys(change).length !== 3 ||
        !old ||
        old.id !== change.id ||
        typeof text !== 'string' ||
        typeof change.append !== 'string' ||
        text.length + change.append.length > textLimit
      )
        return null;
      rows[change.at] = { ...old, [textKey]: text + change.append };
    }
  }
  return rows.length === delta.length ? rows : null;
}

const utf8 = new TextEncoder();
const encodedRowBytes = new WeakMap<object, number>();
const jsonBytes = (value: unknown) => utf8.encode(JSON.stringify(value)).byteLength;

function fitsSnapshotBudget(snapshot: RemoteInterviewSnapshot) {
  // Rows are immutable across applied deltas; only count a changed or inserted row again.
  try {
    let size = jsonBytes({ ...snapshot, transcripts: [], answers: [] });
    for (const rows of [snapshot.transcripts, snapshot.answers]) {
      size += Math.max(0, rows.length - 1);
      for (const row of rows) {
        let bytes = encodedRowBytes.get(row);
        if (bytes === undefined) {
          bytes = jsonBytes(row);
          encodedRowBytes.set(row, bytes);
        }
        size += bytes;
        if (size > REMOTE_SNAPSHOT_MAX_BYTES) return false;
      }
    }
    return size <= REMOTE_SNAPSHOT_MAX_BYTES;
  } catch {
    return false;
  }
}

/** Apply only to the exact confirmed session revision. The previous snapshot stays untouched on failure. */
export function applySnapshotDelta(
  previous: RemoteInterviewSnapshot,
  delta: unknown,
): RemoteInterviewSnapshot | null {
  if (
    !record(delta) ||
    !previous.sessionId ||
    delta.sessionId !== previous.sessionId ||
    delta.sessionEpoch !== previous.sessionEpoch ||
    delta.baseRevision !== previous.revision ||
    !bounded(delta.revision, Number.MAX_SAFE_INTEGER) ||
    delta.revision <= previous.revision
  )
    return null;
  const update = delta.controls === undefined ? {} : delta.controls;
  if (!record(update) || Object.keys(update).some((key) => !Object.hasOwn(controls, key)))
    return null;
  const transcripts = restoreRows(previous.transcripts, delta.transcripts, 200, 'text', 16_000);
  const answers = restoreRows(previous.answers, delta.answers, 40, 'content', 128_000);
  if (!transcripts || !answers) return null;
  const result = { ...previous, ...update, revision: delta.revision, transcripts, answers };
  return validRemoteSnapshot(result) && fitsSnapshotBudget(result) ? result : null;
}
