/** Main chooses every filesystem path. Renderer sends bounded original-file chunks only. */
export type AccountDataCall =
  | { action: 'begin'; files: number }
  | { action: 'base'; token: string; baseId: string; baseName: string }
  | {
      action: 'file';
      token: string;
      kind: 'personal' | 'record' | 'document';
      name: string;
      size: number;
      baseId?: string;
      baseName?: string;
      images?: string[];
    }
  | { action: 'chunk'; token: string; bytes: Uint8Array }
  | { action: 'end' | 'finish' | 'cancel'; token: string };
export type AccountDataResult =
  { ok: true; token?: string; canceled?: boolean; saved?: boolean } | { ok: false; error: string };
