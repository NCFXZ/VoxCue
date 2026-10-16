// Validate data read from local stores before it reaches React. Unknown metadata
// may be retained by callers, but never becomes application state or an action.
export const storedObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const optionalString = (value: unknown) => value === undefined || typeof value === 'string';
export const optionalNumber = (value: unknown) => value === undefined || Number.isFinite(value);
export const optionalBoolean = (value: unknown) =>
  value === undefined || typeof value === 'boolean';
export function storedProvider(value: unknown) {
  return (
    value === undefined ||
    typeof value === 'string' ||
    (storedObject(value) &&
      ['id', 'name', 'dataRecipient'].every((key) => typeof value[key] === 'string') &&
      optionalString(value.modelName) &&
      optionalString(value.modelVendor))
  );
}
export function storedActivity(value: unknown) {
  return (
    value === undefined ||
    (storedObject(value) &&
      [
        'waiting',
        'thinking',
        'searching',
        'reading',
        'writing',
        'processing',
        'organizing',
      ].includes(value.phase) &&
      ['detail', 'id', 'url'].every((key) => optionalString(value[key])) &&
      (value.kind === undefined ||
        [
          'web_search',
          'open_page',
          'find_in_page',
          'commentary',
          'knowledge',
          'reasoning',
          'status',
        ].includes(value.kind)) &&
      (value.status === undefined || ['in_progress', 'completed', 'failed'].includes(value.status)))
  );
}
export function storedSources(value: unknown) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (source) =>
          storedObject(source) &&
          typeof source.title === 'string' &&
          typeof source.url === 'string',
      ))
  );
}
