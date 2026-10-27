import type { SyncKind } from '../../electron/contracts/cloudSync';
export function localChanged(kind: SyncKind) {
  if (
    typeof window !== 'undefined' &&
    typeof window.dispatchEvent === 'function' &&
    typeof CustomEvent === 'function'
  )
    window.dispatchEvent(new CustomEvent('voxcue-local-change', { detail: kind }));
}
