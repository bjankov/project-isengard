/**
 * Workspace folders (PLAN.md 5.3): the user's product repo, chosen per project. The app only
 * validates it and stores its path; it never reads or writes the user's code. The one
 * exception is `git init`, run only after the user confirms.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import type { WorkspaceCheck, WorkspaceSuggestions } from '@app/schema';

const execFileAsync = promisify(execFile);

/** Expand `~` and normalize; keeps relative paths relative (they are rejected later). */
export function expandPath(input: string): string {
  let p = input.trim();
  if (p === '~') p = homedir();
  else if (p.startsWith('~/')) p = join(homedir(), p.slice(2));
  p = normalize(p);
  if (p.length > 1 && p.endsWith(sep)) p = p.slice(0, -1);
  return p;
}

function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function repoRootOf(dir: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function checkWorkspace(input: string, libraryDir: string): Promise<WorkspaceCheck> {
  const path = expandPath(input);
  if (!isAbsolute(path)) {
    return {
      path,
      status: 'not-absolute',
      message: 'Use a full path, e.g. /home/you/code/app or ~/code/app.',
    };
  }
  let info;
  try {
    info = await stat(path);
  } catch {
    return { path, status: 'not-found', message: 'This folder does not exist.' };
  }
  if (!info.isDirectory()) {
    return { path, status: 'not-a-directory', message: 'This is a file, not a folder.' };
  }
  const real = await realpath(path);
  const library = existsSync(libraryDir) ? await realpath(libraryDir) : libraryDir;
  if (isWithin(real, library) || isWithin(library, real)) {
    return {
      path,
      status: 'is-library',
      message: 'This is (or contains) the app’s own library store. Choose your product’s repo.',
    };
  }
  const root = await repoRootOf(path);
  if (!root) {
    return {
      path,
      status: 'not-a-repo',
      message: 'This folder is not a git repo. The workspace must be one.',
    };
  }
  if ((await realpath(root)) !== real) {
    return {
      path,
      status: 'inside-repo',
      repoRoot: root,
      message: `This folder is inside the git repo at ${root}. Use the repo’s root folder.`,
    };
  }
  return { path, status: 'ok' };
}

/** Run `git init` in an existing folder that is not in a git repo yet. */
export async function initWorkspace(input: string, libraryDir: string): Promise<WorkspaceCheck> {
  const before = await checkWorkspace(input, libraryDir);
  if (before.status !== 'not-a-repo') return before;
  await execFileAsync('git', ['-C', before.path, 'init', '--quiet']);
  return checkWorkspace(before.path, libraryDir);
}

/** Folders whose path starts with what was typed so far. */
export async function suggestWorkspaces(input: string): Promise<WorkspaceSuggestions> {
  const typed = expandPath(input || '~/');
  if (!isAbsolute(typed)) return { items: [] };
  const listChildren = input.endsWith('/') || input === '~';
  const dir = listChildren ? typed : dirname(typed);
  const prefix = listChildren ? '' : basename(typed).toLowerCase();
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { items: [] };
  }
  const items = entries
    .filter((e) => e.isDirectory())
    .filter((e) => (prefix.startsWith('.') ? true : !e.name.startsWith('.')))
    .filter((e) => e.name.toLowerCase().startsWith(prefix))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 20)
    .map((e) => {
      const path = join(dir, e.name);
      return { path, isGitRepo: existsSync(join(path, '.git')) };
    });
  return { items };
}
