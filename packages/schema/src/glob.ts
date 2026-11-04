import picomatch from 'picomatch';

/** Workspace-relative globs are compared without a leading `./`. */
function normalize(glob: string): string {
  return glob.trim().replace(/^(\.\/)+/, '');
}

/** Whether `pattern` contains glob syntax (`*`, `?`, `[…]`, `{…}`, …). */
export function isGlob(pattern: string): boolean {
  return picomatch.scan(normalize(pattern)).isGlob;
}

/**
 * Whether the tool glob `scope` covers every path `target` can mean.
 *
 * - A literal target path is covered when it matches the glob.
 * - A glob target (e.g. an artifact `src/**`) is covered only when containment is clear: the same
 *   glob, `**`, or a `dir/**` scope above the target's folder. Anything else counts as not
 *   covered, because glob containment can't be decided in general.
 */
export function globCovers(scope: string, target: string): boolean {
  const s = normalize(scope);
  const t = normalize(target);
  if (!isGlob(t)) return picomatch(s, { dot: true })(t);
  if (s === t || s === '**') return true;
  if (s.endsWith('/**')) {
    const base = s.slice(0, -3);
    if (!isGlob(base) && t.startsWith(`${base}/`)) return true;
  }
  return false;
}

/** Whether any of `scopes` covers `target`. */
export function anyGlobCovers(scopes: readonly string[], target: string): boolean {
  return scopes.some((s) => globCovers(s, target));
}
