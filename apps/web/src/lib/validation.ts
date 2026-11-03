/** Field errors keyed by dotted path, e.g. `defaults.limits.maxTokens` or `scope.paths.0`. */
export type FieldErrors = Record<string, string>;

export function issuesToErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.filter((p) => typeof p !== 'symbol').join('.');
    errors[key] ??= issue.message;
  }
  return errors;
}

/** First error at `path` or anywhere below it. */
export function errorAt(errors: FieldErrors, path: string): string | undefined {
  if (errors[path]) return errors[path];
  const prefix = `${path}.`;
  const key = Object.keys(errors).find((k) => k.startsWith(prefix));
  return key ? errors[key] : undefined;
}
