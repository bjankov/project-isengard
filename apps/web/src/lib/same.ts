/** JSON with object keys sorted, so key order never affects comparisons. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, stable((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** Deep equality for plain JSON-like data, ignoring key order and undefined fields. */
export function sameData(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
