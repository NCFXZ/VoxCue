import { abortable } from '../cancellable';
import { CHAT_MODEL_CATALOG_TTL_MS } from '../../contracts/chat';

/** Holds only the latest catalog for this provider in memory. */
export class ModelCatalog<T> {
  private lifetime = new AbortController();
  private current?: {
    account: string;
    value?: { models: T[]; expiresAt: number };
    pending?: { controller: AbortController; promise: Promise<T[]>; readers: number };
  };

  signal(signal?: AbortSignal) {
    return signal ? AbortSignal.any([this.lifetime.signal, signal]) : this.lifetime.signal;
  }

  clear() {
    this.lifetime.abort();
    this.lifetime = new AbortController();
    this.current = undefined;
  }

  // A rejected model should refresh discovery without cancelling another answer.
  expire() {
    if (this.current) this.current.value = undefined;
  }

  async read(
    account: string,
    force: boolean,
    signal: AbortSignal,
    load: (signal: AbortSignal) => Promise<T[]>,
  ): Promise<T[]> {
    signal.throwIfAborted();
    if (this.current?.account !== account) {
      this.current?.pending?.controller.abort();
      this.current = { account };
    }
    const current = this.current;
    if (!current.pending && !force && current.value && current.value.expiresAt > Date.now())
      return current.value.models;

    if (!current.pending) {
      // Pending entries already reach the provider, including when a manual refresh joins one.
      current.value = undefined;
      const controller = new AbortController();
      const deadline = AbortSignal.any([
        this.lifetime.signal,
        controller.signal,
        AbortSignal.timeout(20000),
      ]);
      const promise = abortable(
        Promise.resolve().then(() => {
          deadline.throwIfAborted();
          return load(deadline);
        }),
        deadline,
      )
        .then((models) => {
          deadline.throwIfAborted();
          current.value = { models, expiresAt: Date.now() + CHAT_MODEL_CATALOG_TTL_MS };
          return models;
        })
        .finally(() => {
          if (current.pending?.controller === controller) current.pending = undefined;
        });
      current.pending = { controller, promise, readers: 0 };
    }
    const pending = current.pending;
    pending.readers++;
    try {
      return await abortable(pending.promise, signal);
    } finally {
      if (--pending.readers === 0 && current.pending === pending) {
        current.pending = undefined;
        pending.controller.abort();
      }
    }
  }
}
