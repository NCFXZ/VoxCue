import type { ProviderCredentialAccess } from '../auth/providerCredentialAccess';
import { abortable } from '../cancellable';

/** An expired queued call never starts. An active call releases the credential queue
 * only after its login flow is cancelled or its owned runtime is retired. */
export function copilotRequest<T>(
  gate: ProviderCredentialAccess | undefined,
  operation: () => Promise<T>,
  signal?: AbortSignal,
  retire?: () => Promise<void>,
): Promise<T> {
  let started = false;
  const execute = async () => {
    signal?.throwIfAborted();
    if (!signal) return operation();
    started = true;
    try {
      return await abortable(operation(), signal);
    } catch (error) {
      if (signal.aborted) await retire?.();
      throw error;
    }
  };
  const work = gate?.run(execute) ?? execute();
  if (!signal) return work;
  return abortable(work, signal).catch((error: unknown) => {
    if (started && signal.aborted) return work;
    throw error;
  });
}

// A conversation can stop waiting for a shared runtime RPC without retiring other
// sessions. Keep the credential gate until the RPC settles or its own deadline expires.
export function sharedCopilotRequest<T>(
  gate: ProviderCredentialAccess | undefined,
  operation: () => Promise<T>,
  caller: AbortSignal | undefined,
  retire: (() => Promise<void>) | undefined,
  timeoutMs: number,
): Promise<T> {
  const execute = async () => {
    caller?.throwIfAborted();
    return copilotRequest(undefined, operation, AbortSignal.timeout(timeoutMs), retire);
  };
  return gate?.run(execute) ?? execute();
}
