import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { simpleGit, type SimpleGit } from 'simple-git';

const execFileAsync = promisify(execFile);

export const MAIN_BRANCH = 'main';
export const MAIN_REF = `refs/heads/${MAIN_BRANCH}`;

/** A change to a tree, applied on top of a base commit. */
export type TreeOp =
  | { op: 'write'; path: string; content: string }
  /** Remove a file, or every file under a folder. */
  | { op: 'remove'; path: string }
  /** Copy a file or folder as it is at another commit. */
  | { op: 'copy'; path: string; from: string };

/** One step of an atomic ref transaction (`git update-ref --stdin`). */
export type RefOp =
  | { op: 'update'; ref: string; value: string; old: string }
  | { op: 'create'; ref: string; value: string }
  | { op: 'delete'; ref: string; old?: string };

export interface RefEntry {
  /** Full ref name, e.g. `refs/tags/agent/x/v2`. */
  ref: string;
  /** Commit the ref points to. */
  oid: string;
  /** Commit date (ISO 8601). */
  date: string;
}

export interface LogEntry {
  hash: string;
  date: string;
  message: string;
}

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
 * tree. Writes never go through the working tree either: commits are built with plumbing
 * (a temporary index, `write-tree`, `commit-tree`) and refs move with `update-ref`, so a
 * branch of one entity can be written without checking anything out (DECISIONS.md, M2).
 * After `main` moves, the touched paths of the working tree are synced so the folder stays a
 * readable mirror of `main`.
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
      if (!current.trim())
        await this.git.raw(['config', '--local', `user.${key}`, FALLBACK_AUTHOR[key]]);
    }
  }

  async head(ref = MAIN_BRANCH): Promise<string | undefined> {
    try {
      return (
        (await this.git.raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim() ||
        undefined
      );
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

  /** Run git directly, for plumbing that needs stdin or a custom environment. */
  private run(
    args: string[],
    opts: { input?: string; env?: Record<string, string> } = {},
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: this.dir,
        env: { ...process.env, ...opts.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on('data', (d: Buffer) => out.push(d));
      child.stderr.on('data', (d: Buffer) => err.push(d));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
        else
          reject(
            new Error(
              `git ${args[0]} failed (${code}): ${Buffer.concat(err).toString('utf8').trim()}`,
            ),
          );
      });
      child.stdin.end(opts.input ?? '');
    });
  }

  /** Object id of `spec` (e.g. `main:agents/x.yaml`), or undefined when it does not exist. */
  async revParse(spec: string): Promise<string | undefined> {
    try {
      return (await this.run(['rev-parse', '--verify', '--quiet', spec])).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /** Object id of a file or folder at a commit; undefined when it does not exist there. */
  objectAt(ref: string, path: string): Promise<string | undefined> {
    return this.revParse(`${ref}:${path}`);
  }

  async mergeBase(a: string, b: string): Promise<string | undefined> {
    try {
      return (await this.run(['merge-base', a, b])).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /** Number of commits reachable from `to` but not from `from`. */
  async countBetween(from: string, to: string): Promise<number> {
    return Number((await this.run(['rev-list', '--count', `${from}..${to}`])).trim());
  }

  /**
   * Build a tree from `base` with `ops` applied, using a temporary index. The working tree and
   * the real index are never touched. Without a base, the tree starts empty.
   */
  async writeTree(base: string | undefined, ops: TreeOp[]): Promise<string> {
    const indexFile = join(this.dir, '.git', `app-index-${randomUUID()}`);
    const env = { GIT_INDEX_FILE: indexFile };
    try {
      await this.run(base ? ['read-tree', base] : ['read-tree', '--empty'], { env });
      for (const op of ops) {
        if (op.op === 'write') {
          const blob = (
            await this.run(['hash-object', '-w', '--stdin'], { input: op.content })
          ).trim();
          await this.run(['update-index', '--add', '--cacheinfo', `100644,${blob},${op.path}`], {
            env,
          });
        } else if (op.op === 'remove') {
          const files = await this.run(['ls-files', '-z', '--', op.path], { env });
          if (files) {
            await this.run(['update-index', '--force-remove', '-z', '--stdin'], {
              env,
              input: files,
            });
          }
        } else {
          const entries = await this.run(['ls-tree', '-r', '-z', op.from, '--', op.path]);
          if (entries) {
            await this.run(['update-index', '-z', '--index-info'], { env, input: entries });
          }
        }
      }
      return (await this.run(['write-tree'], { env })).trim();
    } finally {
      await rm(indexFile, { force: true });
    }
  }

  async treeOf(commit: string): Promise<string> {
    const tree = await this.revParse(`${commit}^{tree}`);
    if (!tree) throw new Error(`no tree for ${commit}`);
    return tree;
  }

  /** Create a commit object (no ref moves). */
  async commitTree(tree: string, parents: string[], message: string): Promise<string> {
    const args = ['commit-tree', '--no-gpg-sign', tree];
    for (const p of parents) args.push('-p', p);
    return (await this.run(args, { input: message })).trim();
  }

  /** Apply ref changes atomically: either all of them happen or none. */
  async updateRefs(ops: RefOp[]): Promise<void> {
    const lines = ops.map((o) => {
      if (o.op === 'update') return `update ${o.ref} ${o.value} ${o.old}`;
      if (o.op === 'create') return `create ${o.ref} ${o.value}`;
      return o.old ? `delete ${o.ref} ${o.old}` : `delete ${o.ref}`;
    });
    await this.run(['update-ref', '--stdin'], { input: `${lines.join('\n')}\n` });
  }

  /** Refs under the given prefixes (each matched as a whole path segment). */
  async listRefs(...prefixes: string[]): Promise<RefEntry[]> {
    const out = await this.run([
      'for-each-ref',
      '--format=%(refname)%00%(objectname)%00%(creatordate:iso-strict)',
      ...prefixes,
    ]);
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [ref = '', oid = '', date = ''] = line.split('\0');
        return { ref, oid, date };
      });
  }

  /** Commits, newest first. `args` are revisions/ranges and options for `git log`. */
  async log(args: string[], path?: string): Promise<LogEntry[]> {
    const out = await this.run([
      'log',
      '--format=%H%x00%cI%x00%s%x1e',
      ...args,
      ...(path ? ['--', path] : []),
    ]);
    return out
      .split('\x1e')
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        const [hash = '', date = '', message = ''] = r.split('\0');
        return { hash, date, message };
      });
  }

  /**
   * Make `paths` in the working tree and the real index match HEAD (`main`) again, after
   * `main` was moved with plumbing. Files that no longer exist on main are removed.
   */
  async syncWorkingTree(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.git.raw(['reset', '--quiet', '--', ...paths]).catch(() => undefined);
    // Per path: checkout fails as a whole if any one path is missing from HEAD.
    for (const p of paths) {
      await this.git.raw(['checkout', '--quiet', 'HEAD', '--', p]).catch(() => undefined);
    }
    await this.git.raw(['clean', '-fdq', '--', ...paths]).catch(() => undefined);
  }
}
