import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { profileDirectory } from './accountProfilePaths';
import type { SourceRemovalResult } from './contracts/accountData';
import { InterviewImageStore } from './backend/interview/images';
import type { RecordingLibrary } from './backend/interview/recordings';
import { KnowledgeHost } from './backend/knowledge/host';
import { readLayout } from './backend/knowledge/libraryLayout';
import { LibraryKnowledgeHost } from './backend/knowledge/workerHost';
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
  if (!removed) return;
  const bases = receipt.plan.items.filter(item => item.key.startsWith('base:'));
  const resume = receipt.plan.items.find(item => item.key === 'resume:main')?.documentId;
  const removeResume = !!resume && removed.documentIds.includes(resume);
  const index = path.join(root, 'knowledge-v1');
  if ((!bases.length && !removeResume) || !(await existsAtExpectedPath(index))) return;
  // Removing selected assets from an inactive older profile is not a request
  // to rebuild its entire index. Keep that cleanup scoped to the moved data.
  const Host = await readLayout(index) ? KnowledgeHost : LibraryKnowledgeHost;
  const host = new Host(index, model, undefined, prepareKnowledgeDatabase);
  try {
    // A moved library can have searchable recovery versions even after its last original is gone.
    for (const item of bases) {
      signal.throwIfAborted();
      await host.removeBase(item.key.slice(5), signal);
    }
    if (removeResume) {
      const documents = await host.listDocuments();
      if (host.indexCleanupError) throw Error(host.indexCleanupError);
      if (documents.some(doc => doc.documentId === resume && doc.baseId === 'personal-resume'))
        await host.removeDocument(resume, signal);
    }
  } finally {
    await host.close();
  }
}
