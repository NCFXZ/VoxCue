import type { SyncKind } from '../../electron/contracts/cloudSync';
export class CloudDataConflict extends Error {}

export function localChanged(kind: SyncKind, keys: string[]) {
  if (
    typeof window !== 'undefined' &&
    typeof window.dispatchEvent === 'function' &&
    typeof CustomEvent === 'function'
  )
    window.dispatchEvent(new CustomEvent('voxcue-local-change', { detail: { kind, keys } }));
}
