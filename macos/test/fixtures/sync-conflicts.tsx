import { useState } from 'react';
import { SyncBadge } from '../../../shared/src/components/SyncBadge';
import { SyncConflictNotice } from '../../../shared/src/components/SyncConflictNotice';
import { ConflictSettingsContext, type SettingsTarget } from '../../../shared/src/components/ui/useSettingsTarget';
import { createRoot } from 'react-dom/client';
import { SettingsDialog } from '../../../shared/src/components/SettingsDialog';
import { historyStoreNames, openDocumentsDatabase } from '../../../shared/src/services/documentsDatabase';
import { useGeneralSettings } from '../../../shared/src/stores/generalSettings';
import { useCloudAccount } from '../../../shared/src/stores/cloudAccount';
import { useCloudSync } from '../../../shared/src/stores/cloudSync';
import type { SyncMark } from '../../../shared/src/services/cloudSync';
import '../../../shared/src/styles.css';
import { installPlatformMaterials } from '../../../shared/src/platform/materials';

// The renderer and its metadata reads are real. This isolated store supplies
// the conflict notifications and records version choices without a cloud copy.
const db = await openDocumentsDatabase();
document.documentElement.classList.add('desktop-ui');
installPlatformMaterials();
const tx = db.transaction(['bases', 'documents', historyStoreNames[1]], 'readwrite');
const done = new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error);
});
tx.objectStore('bases').put({ id: 'base', name: '合成面试库', createdAt: 1 });
tx.objectStore('bases').put({ id: 'aggregate', name: '汇总资料库', createdAt: 1 });
for (const [id, baseId, name] of [['file', 'aggregate', '设计文档.txt'], ['second', 'aggregate', '实现说明.txt'],
  ['cv', 'personal-resume', '简历.pdf']])
  tx.objectStore('documents').put({ id, baseId, name, createdAt: 1, blob: new Blob(['fixture']) });
tx.objectStore(historyStoreNames[1]).put({
  id: 'interview', title: '系统设计面试', startedAt: 4, imageIds: ['capture'],
});
await done;
db.close();
useGeneralSettings.setState({ language: 'zh-CN' });
useCloudAccount.setState({ loaded: true, state: {
  configured: true, verified: true, user: { id: 'synthetic', email: 'owner@example.test', createdAt: 1 },
} });
const keys = ['profile:main', 'resume:main', 'base:base', 'file:file', 'file:second', 'image:capture', 'record:interview'];
const choices: string[] = [];
const pending = new Map<string, SyncMark>();
let rejectNext = false;
function reset() {
  choices.length = 0;
  pending.clear();
  rejectNext = false;
  useCloudSync.setState({ ready: true, busy: false, marks: {
    ...Object.fromEntries(keys.map(key => [key, { status: 'conflict', conflictVersion: key + '-v1', cloudPresent: true }])),
    'profile:main': { status: 'conflict', groupVersion: 'profile-v1', itemStatus: 'synced' },
    'resume:main': { status: 'conflict', parentKey: 'profile:main', conflictVersion: 'resume-v1' },
    'record:interview': { status: 'conflict', groupVersion: 'record-v1', conflictVersion: 'record-v1' },
    'image:capture': { status: 'conflict', parentKey: 'record:interview', conflictVersion: 'image-v1' },
    'base:base': { status: 'conflict', groupVersion: 'base:base-library-v1', conflictVersion: 'base:base-v1',
      groupPresence: { local: true, cloud: false } },
    'file:file': { status: 'conflict', parentKey: 'base:aggregate', conflictVersion: 'file:file-v1' },
    'file:second': { status: 'conflict', parentKey: 'base:aggregate', conflictVersion: 'file:second-v1' },
    'base:aggregate': { status: 'conflict', itemStatus: 'synced', cloudPresent: true,
      groupVersion: 'base:aggregate-library-v1' },
    'record:unreadable': { status: 'error', error: '云端数据大小无效。' },
  } });
}
reset();
useCloudSync.setState({
  submitResolutions(owner, items) {
    if (owner !== useCloudAccount.getState().state.user?.id) throw Error('Wrong owner');
    if (rejectNext) { rejectNext = false; return false; }
    const marks = { ...useCloudSync.getState().marks };
    for (const {key, side, version} of items) {
      const mark = marks[key];
      if (mark?.resolving) throw Error('Duplicate submission');
      if ((mark?.groupVersion ?? mark?.conflictVersion) !== version) throw Error('Stale choice');
      choices.push(key + '/' + side);
      for (const [member, value] of Object.entries(marks)) {
        if (member !== key && value.parentKey !== key) continue;
        pending.set(member, value);
        marks[member] = { ...value, status: 'syncing', resolving: true };
      }
    }
    useCloudSync.setState({ marks, busy: true });
    return true;
  },
});
Object.assign(window, { fixtureChoices: choices, conflictTest: {
  reset, rejectNext() { rejectNext = true; },
  finish(failed?: string) {
    const marks = { ...useCloudSync.getState().marks };
    for (const [key, original] of pending)
      marks[key] = failed && (key === failed || original.parentKey === failed)
        ? { ...original, error: '资料已变化，请重新选择要保留的版本。' }
        : { status: 'synced' };
    pending.clear();
    useCloudSync.setState({ marks, busy: false });
  },
  replace(key: string) {
    useCloudSync.setState(state => ({
      marks: { ...state.marks, [key]: { status: 'conflict', groupVersion: key + '-v2', conflictVersion: key + '-v2' } },
    }));
  },
  switchOwner() {
    useCloudAccount.setState(({ state }) => ({ state: { ...state, user: { ...state.user!, id: 'second' } } }));
    useCloudSync.setState({ marks: {} });
  },
} });
const targets: SettingsTarget[] = ['sync-conflicts'];
function Fixture() {
  const [open, setOpen] = useState(false);
  return <ConflictSettingsContext.Provider value={() => setOpen(true)}>
    <SyncConflictNotice />
    <SyncBadge itemKey="file:file" label="合成文件" />
    <SyncBadge itemKey="base:aggregate" label="汇总资料库" />
    {open && <SettingsDialog theme="light" initialTargets={targets}
      onThemeChange={() => {}} onClose={() => setOpen(false)} />}
  </ConflictSettingsContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
