// Browser document identity and original-file storage contracts.
export interface KnowledgeBase {
  id: string;
  name: string;
  createdAt: number;
  modifiedAt?: number;
  localRevision?: string;
}
export interface LocalDocument {
  id: string;
  baseId: string;
  name: string;
  size: number;
  type: string;
  createdAt: number;
  modifiedAt?: number;
  blob: Blob;
  localRevision?: string;
}
export interface KnowledgeManagementService {
  listBases(): Promise<KnowledgeBase[]>;
  createBase(name: string): Promise<KnowledgeBase>;
  saveBase(base: KnowledgeBase): Promise<void>;
  deleteBase(id: string): Promise<void>;
  listDocuments(baseId: string): Promise<LocalDocument[]>;
  importDocuments(baseId: string, files: File[]): Promise<void>;
  deleteDocument(id: string): Promise<void>;
}
