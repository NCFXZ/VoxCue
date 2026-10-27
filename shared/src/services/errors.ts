/** Remove Electron transport wrappers while preserving the actionable service message. */
export function userError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  let message = error.message;
  for (let count = 0; count < 8; count++) {
    const next = message.replace(/^(?:Error invoking remote method '[^']+':\s*|Error:\s*)/, '');
    if (next === message) break;
    message = next;
  }
  return message.trim() || fallback;
}
