import type { ChatEvent } from '../../contracts/chat';
import type { ProfileGeneration, ProfilePreview } from '../../contracts/profile';

/** A streamed proposal parser; previews stay read-only until its own final validation. */
export interface ProfilePreviewSource {
  readonly previewReady: boolean;
  readonly generation?: ProfileGeneration;
  preview(): ProfilePreview | undefined;
}

// Each request owns one pending preview. Answer text and final validation stay synchronous.
export class ProfilePreviews {
  private pending?: ProfilePreviewSource;
  private timer?: ReturnType<typeof setTimeout>;
  private previous = '';
  private failure?: { error: unknown };

  constructor(
    private readonly id: string,
    private readonly emit: (event: ChatEvent) => void,
    private readonly signal: AbortSignal,
  ) {}

  update(stream?: ProfilePreviewSource) {
    if (!stream?.previewReady || this.signal.aborted) return;
    if (this.failure) throw this.failure.error;
    this.pending = stream;
    this.timer ??= setTimeout(() => {
      try {
        this.flush();
      } catch (error) {
        // Surface a closed/failed receiver through the request, never the timer callback.
        this.failure = { error };
      }
    }, 60);
  }

  flush() {
    const stream = this.pending;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    if (this.signal.aborted) return;
    if (this.failure) throw this.failure.error;
    const preview = stream?.preview();
    if (!stream || !preview) return;
    const state = JSON.stringify([preview, stream.generation]);
    if (state === this.previous) return;
    this.previous = state;
    this.emit({ id: this.id, type: 'profile-preview', preview, generation: stream.generation });
  }

  reset() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
    this.previous = '';
  }

  [Symbol.dispose]() {
    // On a stream error the caller still records its last partial preview.
    // An aborted request cannot publish into its successor.
    if (this.pending) this.flush();
  }
}
