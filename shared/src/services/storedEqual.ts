/** Object-key order carries no meaning in stored JSON. Array order does. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((value, i) => sameValue(value, b[i]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  // IndexedDB preserves explicit undefined fields, while legacy JSON and the cloud omit them.
  const keys = Object.keys(left).filter(key => left[key] !== undefined);
  return keys.length === Object.keys(right).filter(key => right[key] !== undefined).length &&
    keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}
