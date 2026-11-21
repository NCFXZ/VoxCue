import {
  providerCredentialStatus,
  type AccountService,
  type ProviderCredentialReason,
} from '../../contracts/auth';

export class ProviderCredentialUnavailable extends Error {
  constructor(
    readonly service: AccountService,
    readonly reason: ProviderCredentialReason = 'unavailable',
  ) {
    super(providerCredentialStatus[service]);
  }
}

// Only inspect diagnostics from the local credential operation. A cancelled
// browser login, missing item or HTTP permission error has different semantics.
export function keychainFailureReason(error: unknown): ProviderCredentialReason | undefined {
  if (error && typeof error === 'object') {
    for (const field of ['statusCode', 'status']) {
      const status = Object.getOwnPropertyDescriptor(error, field)?.value;
      if (typeof status === 'number' && status >= 400 && status < 600) return;
    }
  }
  const diagnostic =
    typeof error === 'string' ? error : error instanceof Error ? error.message : undefined;
  const code =
    error && typeof error === 'object'
      ? Object.getOwnPropertyDescriptor(error, 'code')?.value
      : undefined;
  if (code === 'errSecUserCanceled' || code === 'errSecAuthFailed') return 'denied';
  if (code === 'errSecInteractionNotAllowed') return 'unavailable';
  if (typeof diagnostic !== 'string') return;
  const text = diagnostic.slice(0, 4096);
  if (/\bHTTP(?:\/[\d.]+)?\s+[45]\d\d\b/i.test(text)) return;
  if (/\berrSec(?:UserCanceled|AuthFailed)\b/.test(text)) return 'denied';
  if (/\berrSecInteractionNotAllowed\b/.test(text)) return 'unavailable';
  if (!/\b(?:keychain|keyring|keytar|OSStatus|NSOSStatusErrorDomain|secure storage)\b/i.test(text))
    return;
  if (/(?:^|[^\d])-25308\b|\buser interaction is not allowed\b/i.test(text)) return 'unavailable';
  if (
    /(?:^|[^\d])-(?:25293|128)\b|\b(?:denied|refused|user cancel(?:ed|led)|passphrase you entered is not correct)\b/i.test(
      text,
    )
  )
    return 'denied';
}

export function isKeychainDenial(error: unknown) {
  return keychainFailureReason(error) === 'denied';
}

// One instance per provider per main process. Retiring a child process or
// replacing a window must not reset the user's refusal.
export class ProviderCredentialAccess {
  private failure?: ProviderCredentialUnavailable;
  private tail = Promise.resolve();

  constructor(
    private service: AccountService,
    private onBlock?: () => void,
  ) {}

  get denied() {
    return !!this.failure;
  }

  block(reason: ProviderCredentialReason = 'unavailable') {
    if (!this.failure) {
      this.failure = new ProviderCredentialUnavailable(this.service, reason);
      this.onBlock?.();
    }
    return this.failure;
  }

  check() {
    if (this.failure) throw this.failure;
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      this.check();
      try {
        const value = await operation();
        this.check();
        return value;
      } catch (error) {
        this.check();
        const reason = keychainFailureReason(error);
        if (reason) throw this.block(reason);
        throw error;
      }
    });
    this.tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
}
