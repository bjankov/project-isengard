/** A path with the home folder shown as `~`, as on project cards. Other paths are unchanged. */
export function tildePath(path: string, home: string | undefined): string {
  const h = home?.replace(/\/+$/, '');
  if (!h) return path;
  if (path === h) return '~';
  return path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path;
}
