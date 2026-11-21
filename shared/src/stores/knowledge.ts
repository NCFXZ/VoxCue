import { componentPresentation } from '../../electron/contracts/components';
import { useKnowledgeIndex } from './knowledgeIndex';
import { recordFeature } from '../services/telemetry';
import { create } from 'zustand';
import { componentReady } from './components';
import {
  localKnowledge,
  validateFiles,
  type KnowledgeBase,
  type LocalDocument,
} from '../services/knowledge';
interface KnowledgeState {
  bases: KnowledgeBase[];
  documents: LocalDocument[];
  selectedId: string | null;
  busy: boolean;
  loading: boolean;
  error: string | null;
  errorBaseId: string | null;
  editorError: string | null;
  dismissError(): void;
  dismissEditorError(): void;
  load(): Promise<void>;
  open(id: string | null): Promise<void>;
  create(name: string): Promise<boolean>;
  rename(name: string): Promise<boolean>;
  removeBase(): Promise<boolean>;
  importFiles(files: File[]): Promise<void>;
  removeDocument(id: string): Promise<boolean>;
}
const message = (error: unknown) => (error instanceof Error ? error.message : '操作失败，请重试。');
let documentRequest = 0;
let selectionRevision = 0;
let basesRequest = 0;
export const useKnowledge = create<KnowledgeState>((set, get) => ({
  bases: [],
  documents: [],
  selectedId: null,
  busy: false,
  loading: false,
  error: null,
  errorBaseId: null,
  editorError: null,
  dismissError() {
    set({ error: null, errorBaseId: null });
  },
  dismissEditorError() {
    set({ editorError: null });
  },
  async load() {
    const request = ++basesRequest;
    try {
      const bases = await localKnowledge.listBases();
      if (request === basesRequest) set({ bases });
    } catch (error) {
      if (request === basesRequest) set({ error: message(error), errorBaseId: null });
    }
  },
  async open(id) {
    const request = ++documentRequest;
    // A cloud download refreshes the selected library after each restored item.
    // Keep the current rows mounted until their replacements have been read.
    if (id !== get().selectedId) {
      selectionRevision++;
      useKnowledgeIndex.getState().dismissError();
      set({
        selectedId: id,
        documents: [],
        loading: !!id,
        error: null,
        errorBaseId: null,
        editorError: null,
      });
    }
    if (!id) return;
    try {
      const documents = await localKnowledge.listDocuments(id);
      if (request === documentRequest) {
        set({ documents, loading: false });
        void useKnowledgeIndex.getState().reconcile(id);
      }
    } catch (error) {
      if (request === documentRequest)
        set({ error: message(error), errorBaseId: id, loading: false });
    }
  },
  async create(name) {
    if (!componentReady('rag')) {
      set({
        editorError: `请先下载并准备${componentPresentation.rag.label}，再创建知识库。`,
      });
      return false;
    }
    if (get().busy) return false;
    set({ busy: true, editorError: null });
    try {
      const base = { id: crypto.randomUUID(), name: name.trim(), createdAt: Date.now() };
      await localKnowledge.saveBase(base);
      const listing = ++basesRequest;
      const bases = await localKnowledge.listBases();
      if (listing === basesRequest) set({ bases });
      await get().open(base.id);
      return true;
    } catch (error) {
      set({ editorError: message(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },
  async rename(name) {
    if (get().busy) return false;
    const base = get().bases.find((b) => b.id === get().selectedId);
    if (!base) return false;
    const selection = selectionRevision;
    set({ busy: true, editorError: null });
    try {
      await localKnowledge.saveBase({ ...base, name });
      const listing = ++basesRequest;
      const bases = await localKnowledge.listBases();
      if (listing === basesRequest) set({ bases });
      return true;
    } catch (error) {
      if (selection === selectionRevision && get().selectedId === base.id)
        set({ editorError: message(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },
  async removeBase() {
    if (get().busy) return false;
    const id = get().selectedId;
    if (!id) return false;
    const selection = selectionRevision;
    set({ busy: true, error: null, errorBaseId: null });
    try {
      await localKnowledge.deleteBase(id);
      if (get().selectedId === id && selection === selectionRevision) await get().open(null);
      await get().load();
      return true;
    } catch (error) {
      if (selection === selectionRevision && get().selectedId === id)
        set({ error: message(error), errorBaseId: id });
      return false;
    } finally {
      set({ busy: false });
    }
  },
  async importFiles(files) {
    if (get().busy) return;
    if (!files.length) return;
    const id = get().selectedId;
    if (!id) return;
    const selection = selectionRevision;
    set({ error: null, errorBaseId: null });
    try {
      validateFiles(files);
    } catch (error) {
      set({ error: message(error), errorBaseId: id });
      return;
    }
    set({ busy: true, error: null, errorBaseId: null });
    try {
      await localKnowledge.importDocuments(id, files);
      if (files.length) recordFeature('file_import');
      const imported = await localKnowledge.listDocuments(id);
      const selected = imported.filter(doc => files.some(file => file.name === doc.name));
      void useKnowledgeIndex.getState().indexSelection(selected);
      if (get().selectedId === id && selection === selectionRevision) await get().open(id);
    } catch (error) {
      if (get().selectedId === id && selection === selectionRevision) {
        await get().open(id);
        if (get().selectedId === id && selection === selectionRevision)
          set({ error: message(error), errorBaseId: id });
      }
    } finally {
      set({ busy: false });
    }
  },
  async removeDocument(id) {
    if (get().busy) return false;
    const baseId = get().selectedId;
    const selection = selectionRevision;
    set({ busy: true, error: null, errorBaseId: null });
    try {
      await localKnowledge.deleteDocument(id);
      if (baseId && get().selectedId === baseId && selection === selectionRevision)
        await get().open(baseId);
      return true;
    } catch (error) {
      if (selection === selectionRevision && get().selectedId === baseId)
        set({ error: message(error), errorBaseId: baseId });
      return false;
    } finally {
      set({ busy: false });
    }
  },
}));
