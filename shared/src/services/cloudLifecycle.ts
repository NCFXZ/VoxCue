// Leave an automatic sync pass without marking the resource as failed.
export class SyncYield extends Error {}

let shutdown: (() => Promise<void>) | undefined;
export function registerCloudShutdown(callback: () => Promise<void>) {
  shutdown = callback;
  return () => {
    if (shutdown === callback) shutdown = undefined;
  };
}
export async function stopCloudWork() {
  await shutdown?.();
}
