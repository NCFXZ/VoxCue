/** A reference to a sent screenshot. Original bytes live in the main-process store. */
export interface InterviewImage {
  id: string;
  preview?: string;
}

export type InterviewImageCall =
  | { op: 'read' | 'preview' | 'save'; id: string }
  | { op: 'syncDigest' | 'syncBytes'; id: string; preview?: string }
  | { op: 'remove'; ids: string[] };

/** Native originals use UUIDs. Older history can also contain display-only references. */
export const validImageId = (id: unknown): id is string =>
  typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id);

export function validImagePreview(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 128 * 1024 &&
    /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

export function validInterviewImage(value: unknown): value is InterviewImage {
  if (!value || typeof value !== 'object') return false;
  const image = value as InterviewImage;
  return (
    typeof image.id === 'string' &&
    /^[\w-]{1,100}$/.test(image.id) &&
    (image.preview === undefined || validImagePreview(image.preview))
  );
}

export function validInterviewImages(value: unknown): value is InterviewImage[] {
  return (
    Array.isArray(value) &&
    value.length <= 5 &&
    value.every(validInterviewImage) &&
    new Set(value.map((image) => image.id)).size === value.length
  );
}
