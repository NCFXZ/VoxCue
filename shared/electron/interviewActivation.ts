/** Delegate to the owning interview's reveal gate; never create or reload a session. */
export function revealExistingInterview<T extends { isDestroyed(): boolean }>(
  window: T | null,
  callbacks: WeakMap<T, (focus: boolean) => void>,
): boolean {
  if (!window || window.isDestroyed()) return false;
  callbacks.get(window)?.(true);
  return true;
}
