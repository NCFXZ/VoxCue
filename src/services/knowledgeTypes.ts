// Browser document identity and original-file storage contracts.
export interface KnowledgeBase {
  id: string;
  name: string;
  createdAt: number;
}
export interface LocalDocument {
  id: string;
  baseId: string;
  name: string;
  size: number;
  type: string;
  createdAt: number;
  blob: Blob;
}
export interface KnowledgeManagementService {
  listBases(): Promise<KnowledgeBase[]>;
  saveBase(base: KnowledgeBase): Promise<void>;
  deleteBase(id: string): Promise<void>;
  listDocuments(baseId: string): Promise<LocalDocument[]>;
  importDocuments(baseId: string, files: File[]): Promise<void>;
  deleteDocument(id: string): Promise<void>;
}
