import { useKnowledgeIndex } from './knowledgeIndex';
import { create } from 'zustand';
import { componentReady } from './components';
import { localKnowledge, type KnowledgeBase, type LocalDocument } from '../services/knowledge';
interface KnowledgeState {
  bases: KnowledgeBase[];
  documents: LocalDocument[];
  selectedId: string | null;
  busy: boolean;
  loading: boolean;
  error: string | null;
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
let basesRequest = 0;
export const useKnowledge = create<KnowledgeState>((set, get) => ({
  bases: [],
  documents: [],
  selectedId: null,
  busy: false,
  loading: false,
  error: null,
  async load() {
    const request = ++basesRequest;
    try {
      const bases = await localKnowledge.listBases();
      if (request === basesRequest) set({ bases });
    } catch (error) {
      if (request === basesRequest) set({ error: message(error) });
    }
  },
  async open(id) {
    const request = ++documentRequest;
    set({ selectedId: id, documents: [], loading: !!id });
    if (!id) return;
    try {
      const documents = await localKnowledge.listDocuments(id);
      if (request === documentRequest) set({ documents, loading: false });
    } catch (error) {
      if (request === documentRequest) set({ error: message(error), loading: false });
    }
  },
  async create(name) {
    if (!componentReady('rag')) {
      set({ error: '请先下载并准备知识库模型，再创建知识库。' });
      return false;
    }
    if (get().busy) return false;
    set({ busy: true, error: null });
    try {
      const base = { id: crypto.randomUUID(), name: name.trim(), createdAt: Date.now() };
      await localKnowledge.saveBase(base);
      await get().load();
      await get().open(base.id);
      return true;
    } catch (error) {
      set({ error: message(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },
  async rename(name) {
    if (get().busy) return false;
    const base = get().bases.find((b) => b.id === get().selectedId);
    if (!base) return false;
    set({ busy: true, error: null });
    try {
      await localKnowledge.saveBase({ ...base, name });
      await get().load();
      return true;
    } catch (error) {
      set({ error: message(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },
  async removeBase() {
    if (get().busy) return false;
    const id = get().selectedId;
    if (!id) return false;
    set({ busy: true, error: null });
    try {
      await localKnowledge.deleteBase(id);
      if (get().selectedId === id) await get().open(null);
      await get().load();
      return true;
    } catch (error) {
      set({ error: message(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },
  async importFiles(files) {
    if (get().busy) return;
    const id = get().selectedId;
    if (!id) return;
    set({ busy: true, error: null });
    try {
      await localKnowledge.importDocuments(id, files);
      if (get().selectedId === id) await get().open(id);
      const imported = await localKnowledge.listDocuments(id);
      for (const doc of imported.filter((doc) => files.some((file) => file.name === doc.name)))
        void useKnowledgeIndex.getState().index(doc);
    } catch (error) {
      if (get().selectedId === id) await get().open(id);
      set({ error: message(error) });
    } finally {
      set({ busy: false });
    }
  },
  async removeDocument(id) {
    if (get().busy) return false;
    const baseId = get().selectedId;
    set({ busy: true, error: null });
    try {
      await localKnowledge.deleteDocument(id);
      if (baseId && get().selectedId === baseId) await get().open(baseId);
      return true;
    } catch (error) {
      set({ error: message(error) });
      return false;
    } finally {
      set({ busy: false });
    }
  },
}));
