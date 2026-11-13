// Fixed internal maintenance metadata only. No key material or paths.
export const credentialRetainedItemIds = [
  'storage-key',
  'safe-key',
  'safe-default',
] as const;
export type CredentialRetainedItemId = (typeof credentialRetainedItemIds)[number];

export interface CredentialCleanup {
  cleanup: 'complete' | 'partial' | 'deferred';
  removed: number;
  /** null means enumeration was not completed; it must not be displayed as zero. */
  retained: number | null;
  retainedItems: CredentialRetainedItemId[];
  reason: 'none' | 'current' | 'authorization' | 'failed';
}

export const credentialRetainedItemNames: Readonly<Record<CredentialRetainedItemId, string>> = {
  'storage-key': 'VoxCue Credential Storage / VoxCue Key',
  'safe-key': 'VoxCue Safe Storage / VoxCue Key',
  'safe-default': 'VoxCue Safe Storage / VoxCue',
};
