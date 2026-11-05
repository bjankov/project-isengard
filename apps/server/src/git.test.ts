import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LibraryGit } from './git.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'app-git-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** `run` is private; the tests reach it to check the process handling directly. */
const run = (git: LibraryGit, args: string[], input?: string) =>
  (git as unknown as { run: (a: string[], o: { input?: string }) => Promise<string> }).run(
    args,
    input === undefined ? {} : { input },
  );

describe('running git', () => {
  it('survives git exiting before it reads its input (EPIPE)', async () => {
    const git = new LibraryGit(dir);
    // `git --version` never reads stdin and exits at once; 8 MB can't fit in the pipe buffer,
    // so writing it fails with EPIPE. That used to be an uncaught exception.
    const big = 'x'.repeat(8 * 1024 * 1024);
    for (let i = 0; i < 5; i++) {
      await expect(run(git, ['--version'], big)).resolves.toMatch(/^git version/);
    }
  });

  it('still reports failing commands', async () => {
    const git = new LibraryGit(dir);
    await expect(run(git, ['no-such-command'], 'input')).rejects.toThrow(
      /git no-such-command failed/,
    );
  });
});
