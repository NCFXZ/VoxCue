import path from 'node:path';
import { Worker } from 'node:worker_threads';

// A damaged OLE chain can loop synchronously inside the legacy parser.
export function extractLegacyDoc(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (!bytes.length || bytes.length > 20 * 1024 * 1024)
    return Promise.reject(new Error('Invalid legacy Word input'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'legacyDocWorker.js'), {
      workerData: bytes,
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
      stdout: true,
      stderr: true,
    });
    // Discard worker output, including dependency diagnostics containing document data.
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const finish = async (text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      await worker.terminate().catch(() => {});
      if (signal?.aborted) reject(signal.reason);
      else if (text === undefined) reject(new Error('Legacy Word extraction failed'));
      else resolve(text);
    };
    const abort = () => void finish();
    const timer = setTimeout(() => void finish(), 15_000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once(
      'message',
      (value: unknown) =>
        void finish(
          typeof value === 'string' && value.length <= 8_000_000 && /[\p{L}\p{N}]/u.test(value)
            ? value
            : undefined,
        ),
    );
    worker.once('error', () => void finish());
    worker.once('exit', () => void finish());
  });
}
