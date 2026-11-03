import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { CommitInfo } from '@app/schema';
import { simpleGit, type SimpleGit } from 'simple-git';

const execFileAsync = promisify(execFile);

export const MAIN_BRANCH = 'main';

export class GitMissingError extends Error {
  constructor(cause?: unknown) {
    super(
      'git was not found. The app stores everything in git, so it needs the `git` command.\n' +
        'Install git (https://git-scm.com/downloads), make sure it is on your PATH, then start the app again.',
      { cause },
    );
    this.name = 'GitMissingError';
  }
}

/** Returns the installed git version string, or throws GitMissingError. */
export async function checkGitInstalled(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['--version']);
    return stdout.trim();
  } catch (err) {
    throw new GitMissingError(err);
  }
}

const FALLBACK_AUTHOR = { name: 'app', email: 'app@localhost' };

/**
 * Wrapper around the library store repo. All operations are serialized through a queue so
 * concurrent API requests never interleave git commands.
 *
 * Reads go through git objects at a ref (`git show <ref>:<path>`), never through the working
 * tree, so other refs/versions can be read the same way later.
 */
export class LibraryGit {
  readonly dir: string;
  private readonly git: SimpleGit;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dir: string) {
    this.dir = dir;
    this.git = simpleGit({ baseDir: dir });
  }

  /** Run `fn` exclusively (after every previously queued operation). */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  isRepo(): boolean {
    return existsSync(join(this.dir, '.git'));
  }

  async init(): Promise<void> {
    await this.git.raw(['init', '--quiet', '-b', MAIN_BRANCH]);
    await this.configure();
  }

  /**
   * Repo-local settings for the app-managed library store:
   * - the user's git identity when configured, otherwise a local fallback;
   * - no commit/tag signing, since the app commits on every save and signing (e.g. with a
   *   hardware key) would block each one. The user's global config is never touched.
   */
  async configure(): Promise<void> {
    await this.git.raw(['config', '--local', 'commit.gpgsign', 'false']);
    await this.git.raw(['config', '--local', 'tag.gpgsign', 'false']);
    for (const key of ['name', 'email'] as const) {
      const current = await this.git.raw(['config', '--get', `user.${key}`]).catch(() => '');
      if (!current.trim()) await this.git.raw(['config', '--local', `user.${key}`, FALLBACK_AUTHOR[key]]);
    }
  }

  async head(ref = MAIN_BRANCH): Promise<string | undefined> {
    try {
      return (await this.git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /** Names of the direct children of `dir` at `ref` (files and directories), without the prefix. */
  async listDir(dir: string, ref = MAIN_BRANCH): Promise<string[]> {
    const out = await this.git.raw(['ls-tree', '--name-only', '-z', ref, `${dir}/`]);
    return out
      .split('\0')
      .filter(Boolean)
      .map((p) => p.slice(dir.length + 1));
  }

  /** All file paths under `path` at `ref`. Empty when the path does not exist. */
  async listFiles(path: string, ref = MAIN_BRANCH): Promise<string[]> {
    const out = await this.git.raw(['ls-tree', '-r', '--name-only', '-z', ref, '--', path]);
    return out.split('\0').filter(Boolean);
  }

  /** File content at `ref`, or undefined when the file does not exist there. */
  async readFile(path: string, ref = MAIN_BRANCH): Promise<string | undefined> {
    const exists = await this.listFiles(path, ref);
    if (!exists.includes(path)) return undefined;
    return this.git.raw(['show', `${ref}:${path}`]);
  }

  /**
   * Stage the given paths (additions, modifications and deletions) and commit them.
   * Returns null when the paths have no changes.
   */
  async commitPaths(paths: string[], message: string): Promise<CommitInfo | null> {
    await this.git.raw(['add', '-A', '--', ...paths]);
    const staged = await this.git.raw(['diff', '--cached', '--name-only', '--', ...paths]);
    if (!staged.trim()) return null;
    await this.git.raw(['commit', '--quiet', '-m', message, '--', ...paths]);
    const hash = (await this.head('HEAD'))!;
    return { hash, message };
  }

  /** Discard uncommitted changes to `paths` (restore tracked files, remove untracked ones). */
  async discard(paths: string[]): Promise<void> {
    await this.git.raw(['reset', '--quiet', '--', ...paths]).catch(() => undefined);
    // Per path: checkout fails as a whole if any one path is missing from HEAD.
    for (const p of paths) {
      await this.git.raw(['checkout', '--quiet', 'HEAD', '--', p]).catch(() => undefined);
    }
    await this.git.raw(['clean', '-fdq', '--', ...paths]).catch(() => undefined);
  }
}
