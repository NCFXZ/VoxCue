// Each cloud account keeps its own reminder preference in its Chromium partition.
const key = 'voxcue-handled-local-import-v1';
const event = 'voxcue-local-import-handled';
const dismissed = 'dismissed';
let handledInWindow: string | null = null;

function handledLocalImport() {
  try {
    return handledInWindow ?? localStorage.getItem(key);
  } catch {
    return handledInWindow;
  }
}
function saveHandled(value: string) {
  handledInWindow = value;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Keep it dismissed for this window. */
  }
  window.dispatchEvent(new Event(event));
}
export function shouldShowLocalImport(revision?: string) {
  const handled = handledLocalImport();
  return !!revision && handled !== dismissed && revision !== handled;
}
export function dismissLocalImportNotice() {
  saveHandled(dismissed);
}
export function markLocalImportHandled(revision: string) {
  if (shouldShowLocalImport(revision)) saveHandled(revision);
}
export function subscribeLocalImport(update: () => void) {
  window.addEventListener(event, update);
  return () => window.removeEventListener(event, update);
}
