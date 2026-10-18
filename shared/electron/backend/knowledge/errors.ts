// The utility-process boundary carries codes, never native errors or local paths.
export const knowledgeErrorCodes = [
  'unavailable',
  'invalid_request',
  'configuration',
  'integrity',
  'not_ready',
  'cancelled',
  'closed',
] as const;
export type KnowledgeErrorCode = (typeof knowledgeErrorCodes)[number];

export class KnowledgeError extends Error {
  constructor(
    public readonly code: KnowledgeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'KnowledgeError';
  }
}

export function knowledgeErrorFromWire(message: string, code: unknown) {
  return new KnowledgeError(
    knowledgeErrorCodes.includes(code as KnowledgeErrorCode)
      ? (code as KnowledgeErrorCode)
      : 'integrity',
    message,
  );
}

export function knowledgeUnavailable(error: unknown) {
  return error instanceof KnowledgeError && error.code === 'unavailable';
}
