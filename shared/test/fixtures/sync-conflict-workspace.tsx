import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsDialog } from '../../src/components/SettingsDialog';
import { SyncBadge } from '../../src/components/SyncBadge';
import { SyncConflictNotice } from '../../src/components/SyncConflictNotice';
import { ConflictSettingsContext, type SettingsTarget } from '../../src/components/ui/useSettingsTarget';
import { installPlatformMaterials } from '../../src/platform/materials';
import { historyStoreNames, openDocumentsDatabase } from '../../src/services/documentsDatabase';
import { defaultSyncPreferences, type SyncMark, type SyncStatus } from '../../src/services/cloudSync';
import { useCloudAccount } from '../../src/stores/cloudAccount';
import { useCloudSync } from '../../src/stores/cloudSync';
import { useGeneralSettings } from '../../src/stores/generalSettings';
import '../../src/styles.css';

document.documentElement.classList.add('desktop-ui');
installPlatformMaterials();
const db = await openDocumentsDatabase();
const tx = db.transaction(['bases', 'documents', historyStoreNames[1]], 'readwrite');
const saved = new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error);
});
tx.objectStore('bases').put({ id: 'review', name: 'Dispatch', createdAt: 1 });
tx.objectStore('documents').put({ id: 'invoice', baseId: 'review', name: 'invoice.txt', createdAt: 1, blob: new Blob(['Synthetic invoice']) });
tx.objectStore(historyStoreNames[1]).put({ id: 'session', title: 'Planning', startedAt: 1, imageIds: ['preview'] });
await saved;
db.close();

const owner = { id: 'fixture-user', email: 'fixture@example.test', createdAt: 1 };
const roots = ['profile:main', 'record:session', 'base:review'];
const children = ['resume:main', 'image:preview', 'file:invoice'];
const marks: Record<string, SyncMark> = {};
for (const [index, key] of roots.entries()) {
  marks[key] = { status: 'conflict', groupVersion: key + '/1', conflictVersion: key + '/1' };
  marks[children[index]] = { status: 'conflict', parentKey: key, conflictVersion: children[index] + '/1' };
}
marks['base:review'].groupPresence = { local: true, cloud: false };
const choices: string[] = [];
const pending = new Map<string, SyncMark>();
const preferences = defaultSyncPreferences();
preferences.enabled = { profile: true, history: true, knowledgebase: true };
const theme = document.documentElement;

function configure(language: 'zh-CN' | 'en', dark: boolean) {
  theme.lang = language;
  theme.classList.toggle('dark', dark);
  useGeneralSettings.setState({ language });
  useCloudAccount.setState({ loaded: true, state: { configured: true, verified: true, user: owner } });
  useCloudSync.setState({ marks: { ...marks }, ready: true, busy: false, preferences });
  choices.length = 0;
  pending.clear();
}
configure('zh-CN', false);

// The production renderer and IndexedDB metadata are real. Only the cloud outcome
// is supplied by a test port so transfer timing can be controlled independently.
useCloudSync.setState({
  submitResolutions(user, selected) {
    if (user !== owner.id) throw Error('Unexpected synthetic owner');
    const current = { ...useCloudSync.getState().marks };
    for (const { key, side, version } of selected) {
      const mark = current[key];
      if ((mark?.groupVersion ?? mark?.conflictVersion) !== version || mark.resolving)
        throw Error('Stale synthetic choice');
      choices.push(key + '/' + side);
      for (const [member, source] of Object.entries(current)) {
        if (member !== key && source.parentKey !== key) continue;
        pending.set(member, source);
        current[member] = { ...source, status: 'syncing', resolving: true };
      }
    }
    useCloudSync.setState({ marks: current, busy: true });
    return true;
  },
});
Object.assign(window, { conflictFixture: {
  configure,
  choices,
  settle(failed?: string) {
    const current = { ...useCloudSync.getState().marks };
    for (const [key, mark] of pending) {
      current[key] = failed && (failed === key || failed === mark.parentKey)
        ? { ...mark, error: '资料已变化，请重新选择要保留的版本。' }
        : { status: 'synced' };
    }
    pending.clear();
    useCloudSync.setState({ marks: current, busy: false });
  },
  badge(status: SyncStatus) {
    useCloudSync.setState(state => ({ marks: { ...state.marks, 'file:invoice': { status } } }));
  },
  changeRecordVersion() {
    useCloudSync.setState(state => ({
      marks: { ...state.marks, 'record:session': { ...marks['record:session'],
        conflictVersion: 'record:session/2', groupVersion: 'record:session/2' } },
    }));
  },
  changeOwner() {
    useCloudAccount.setState(({ state }) => ({ state: { ...state, user: { ...owner, id: 'other-user' } } }));
    useCloudSync.setState({ marks: {} });
  },
  localMode() {
    useCloudAccount.setState(({ state }) => ({ state: { ...state, user: null, localMode: true } }));
  },
} });

const targets: SettingsTarget[] = ['sync-conflicts'];
function ConflictWorkspace() {
  const [open, setOpen] = useState(false);
  const language = useGeneralSettings(state => state.language);
  return <ConflictSettingsContext.Provider value={() => setOpen(true)}>
    <SyncConflictNotice key={language} />
    <SyncBadge key={language + '/badge'} itemKey="file:invoice" label="invoice.txt" />
    {open && <SettingsDialog theme={theme.classList.contains('dark') ? 'dark' : 'light'}
      initialTargets={targets} onThemeChange={() => {}} onClose={() => setOpen(false)} />}
  </ConflictSettingsContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<ConflictWorkspace />);
