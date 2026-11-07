import { describe, expect, it } from 'vitest';
import { domainAllows, shellAllows, toolStepArgProblems, type ToolPreset } from './index.js';

const preset = (p: Omit<ToolPreset, 'id' | 'name' | 'description'>): ToolPreset =>
  ({ id: 'p-aaaaaa', name: 'Preset', description: '', ...p }) as ToolPreset;

describe('shellAllows', () => {
  const scope = {
    commands: [
      { match: 'exact' as const, command: 'npm test' },
      { match: 'prefix' as const, command: 'git log' },
    ],
  };
  it('matches exact and prefix rules', () => {
    expect(shellAllows(scope, 'npm test')).toBe(true);
    expect(shellAllows(scope, ' npm   test ')).toBe(true);
    expect(shellAllows(scope, 'npm test --watch')).toBe(false);
    expect(shellAllows(scope, 'git log --oneline')).toBe(true);
    expect(shellAllows(scope, 'git log')).toBe(true);
    expect(shellAllows(scope, 'git logx')).toBe(false);
  });
  it('never allows chaining or redirecting in a restricted shell', () => {
    for (const c of [
      'git log; rm -rf .',
      'git log && rm x',
      'git log | sh',
      'git log > f',
      'git log $(rm x)',
      'git log `rm x`',
    ]) {
      expect(shellAllows(scope, c), c).toBe(false);
    }
  });
  it('an unrestricted shell allows anything', () => {
    expect(shellAllows({ commands: [] }, 'a && b')).toBe(true);
  });
});

describe('domainAllows', () => {
  it('uses allow and deny lists', () => {
    expect(domainAllows({ allow: [], deny: [] }, 'any.org')).toBe(true);
    expect(domainAllows({ allow: ['docs.python.org'], deny: [] }, 'docs.python.org')).toBe(true);
    expect(domainAllows({ allow: ['docs.python.org'], deny: [] }, 'python.org')).toBe(false);
    expect(domainAllows({ allow: ['*.example.com'], deny: [] }, 'a.b.example.com')).toBe(true);
    expect(domainAllows({ allow: ['*.example.com'], deny: [] }, 'example.com')).toBe(false);
    expect(domainAllows({ allow: [], deny: ['*.ads.net'] }, 'x.ads.net')).toBe(false);
  });
});

describe('toolStepArgProblems', () => {
  it('needs the required arguments', () => {
    const p = preset({ builtin: 'search_files', scope: { paths: ['src/**'] } });
    expect(toolStepArgProblems(p, {}, 'Search')).toEqual(['Search has no pattern yet.']);
    expect(toolStepArgProblems(p, { pattern: 'TODO' }, 'Search')).toEqual([]);
  });
  it('checks paths against the preset', () => {
    const read = preset({ builtin: 'read_file', scope: { paths: ['src/**'] } });
    expect(toolStepArgProblems(read, { path: 'src/a.ts' }, 'S')).toEqual([]);
    expect(toolStepArgProblems(read, { path: 'docs/a.md' }, 'S')[0]).toMatch(/doesn’t cover/);
    expect(toolStepArgProblems(read, { path: '../x' }, 'S')[0]).toMatch(/inside the workspace/);
    const search = preset({ builtin: 'search_files', scope: { paths: ['src/**'] } });
    expect(toolStepArgProblems(search, { pattern: 'x', path: 'src/' }, 'S')).toEqual([]);
    expect(toolStepArgProblems(search, { pattern: 'x', path: 'lib' }, 'S')).toHaveLength(1);
  });
  it('checks URLs against the domain lists', () => {
    const fetch = preset({ builtin: 'web_fetch', scope: { allow: ['example.com'], deny: [] } });
    expect(toolStepArgProblems(fetch, { url: 'https://example.com/a' }, 'F')).toEqual([]);
    expect(toolStepArgProblems(fetch, { url: 'https://evil.com' }, 'F')[0]).toMatch(/evil\.com/);
    expect(toolStepArgProblems(fetch, { url: 'ftp://example.com' }, 'F')[0]).toMatch(/http/);
    expect(toolStepArgProblems(fetch, { url: 'not a url' }, 'F')[0]).toMatch(/http/);
  });
});
