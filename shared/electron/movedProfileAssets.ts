import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { profileDirectory } from './accountProfilePaths';
import type { SourceRemovalResult } from './contracts/accountData';
import { InterviewImageStore } from './backend/interview/images';
import type { RecordingLibrary } from './backend/interview/recordings';
import { KnowledgeHost } from './backend/knowledge/host';
import type { PrepareKnowledgeDatabase } from './platform/types';
import type { ProfileMoveReceipt } from './backend/profileMoveReceipt';
import { checkMovedRecordings, removeMovedRecordings } from './backend/profileRecordingTransfer';

async function existsAtExpectedPath(file: string) {
  try {
    if ((await realpath(file)) !== file) throw Error('来源资料存储目录不可用。');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function checkOrRemoveMovedProfileAssets(
  userData: string,
  model: string,
  recordings: RecordingLibrary,
  receipt: ProfileMoveReceipt,
  removed: SourceRemovalResult | undefined,
  signal: AbortSignal,
  prepareKnowledgeDatabase?: PrepareKnowledgeDatabase,
) {
  if (removed) {
    const recordIds = new Set(removed.recordIds);
    await removeMovedRecordings(
      recordings,
      receipt.source,
      receipt.clips.filter((c) => recordIds.has(c.recordId)),
      signal,
    );
  } else {
    const records = receipt.plan.items
      .filter((i) => i.key.startsWith('record:'))
      .map((i) => i.key.slice(7));
    await checkMovedRecordings(recordings, receipt.source, records, receipt.clips, signal);
  }
  const root = profileDirectory(await realpath(userData), receipt.source);
  const directory = path.join(root, 'interview-images-v1');
  if (receipt.images.length && (await existsAtExpectedPath(directory))) {
    const images = new InterviewImageStore(directory);
    const ids = removed && new Set(removed.imageIds);
    try {
      for (const i of receipt.images) {
        signal.throwIfAborted();
        if (!ids || ids.has(i.id))
          await images.checkOrRemoveMoved(i.id, i.hash, i.previewHash, !!removed);
      }
    } finally {
      await images.dispose();
    }
  }
  const index = path.join(root, 'knowledge-v1');
  if (
    removed?.documentIds.length &&
    (await existsAtExpectedPath(path.join(index, 'catalog.json')))
  ) {
    const host = new KnowledgeHost(index, model, undefined, prepareKnowledgeDatabase);
    try {
      for (const id of removed.documentIds) await host.removeDocument(id, signal);
    } finally {
      await host.close();
    }
  }
}
