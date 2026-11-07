/**
 * M7: demo content and the demo workspace (PLAN.md 9.6), and Restore defaults bringing them
 * back (PLAN.md 8.4).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILTIN_PATTERN_IDS,
  DEMO_IDS,
  collectRefs,
  type EntityListItem,
  type Project,
  type RestoreDefaultsResponse,
} from '@app/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from './app.js';
import { loadConfig, type AppConfig } from './config.js';

let home: string;
let config: AppConfig;
let built: BuiltApp | undefined;

async function start(env: Record<string, string> = {}): Promise<BuiltApp> {
  await built?.app.close();
  config = loadConfig({ APP_HOME: home, ...env });
  built = await buildApp(config, { logger: false });
  return built;
}

async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) {
  if (!built) throw new Error('not started');
  const res = await built.app.inject({
    method,
    url,
    ...(body === undefined ? {} : { payload: body as object }),
  });
  if (res.statusCode >= 300) throw new Error(`${method} ${url}: ${res.statusCode} ${res.body}`);
  return (res.body ? res.json() : undefined) as T;
}

const names = async (plural: string) =>
  (await api<{ items: EntityListItem[] }>('GET', `/api/${plural}`)).items.map((i) => i.name);

function gitIn(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
}

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'app-m7-')));
  built = undefined;
});

afterEach(async () => {
  await built?.app.close();
  rmSync(home, { recursive: true, force: true });
});

describe('first launch', () => {
  it('adds the demo content and creates the demo workspace', async () => {
    await start();
    expect(await names('projects')).toEqual(
      expect.arrayContaining(['Plan, build, test', 'Ticket router']),
    );
    expect(await names('agents')).toEqual(
      expect.arrayContaining(['Planner', 'Executor', 'Tester', 'Reviewer', 'Router']),
    );
    expect((await names('skills')).length).toBeGreaterThanOrEqual(2);
    expect(await names('tools')).toEqual(expect.arrayContaining(['Run tests', 'Web search']));
    expect(await names('patterns')).toHaveLength(10);

    const demoWorkspace = join(home, 'demo-workspace');
    expect(config.demoWorkspace).toBe(demoWorkspace);
    expect(existsSync(join(demoWorkspace, 'README.md'))).toBe(true);
    expect(gitIn(demoWorkspace, 'log', '--oneline').trim().split('\n')).toHaveLength(1);
    expect(gitIn(demoWorkspace, 'status', '--porcelain')).toBe('');

    const entity = await api<Project>('GET', `/api/projects/${DEMO_IDS.projects.planBuildTest}`);
    expect(entity.workspacePath).toBe(demoWorkspace);
    expect(gitIn(config.libraryDir, 'log', '--format=%s')).toContain('Add the demo content');
  });

  it('example projects pass the save and merge checks', async () => {
    await start();
    for (const id of Object.values(DEMO_IDS.projects)) {
      const entity = await api<Project>('GET', `/api/projects/${id}`);
      await api('PUT', `/api/projects/${id}`, { ...entity, description: 'Changed' });
      const merged = await api<{ version: string }>('POST', `/api/projects/${id}/merge`, {});
      expect(merged.version).toBe('v2');
    }
  });

  it('happens once: a later start adds nothing, and deleted demo content stays deleted', async () => {
    await start();
    await api('DELETE', `/api/projects/${DEMO_IDS.projects.ticketRouter}`);
    await api('DELETE', `/api/agents/${DEMO_IDS.agents.router}`);
    const head = gitIn(config.libraryDir, 'rev-parse', 'main');
    await start();
    expect(gitIn(config.libraryDir, 'rev-parse', 'main')).toBe(head);
    expect(await names('projects')).toEqual(['Plan, build, test']);
  });

  it('is skipped with APP_DEMO=0', async () => {
    await start({ APP_DEMO: '0' });
    expect(await names('projects')).toEqual([]);
    expect(await names('agents')).toEqual([]);
    expect(config.demoWorkspace).toBeNull();
    expect(existsSync(join(home, 'demo-workspace'))).toBe(false);
  });
});

describe('restore defaults', () => {
  it('adds back missing demo content and the workspace, pinning current versions', async () => {
    await start();
    // Maker-checker gets a v2; the restored router project must pin it, not v1.
    const mc = BUILTIN_PATTERN_IDS.makerChecker;
    const pattern = await api<{ description: string }>('GET', `/api/patterns/${mc}`);
    await api('PUT', `/api/patterns/${mc}`, { ...pattern, description: 'Edited' });
    await api('POST', `/api/patterns/${mc}/merge`, {});

    await api('DELETE', `/api/projects/${DEMO_IDS.projects.ticketRouter}`);
    await api('DELETE', `/api/agents/${DEMO_IDS.agents.router}`);
    rmSync(join(home, 'demo-workspace'), { recursive: true, force: true });

    const res = await api<RestoreDefaultsResponse>('POST', '/api/settings/restore-defaults');
    expect(res.restored).toEqual([
      { kind: 'agent', id: DEMO_IDS.agents.router, name: 'Router', version: 'v2' },
      { kind: 'project', id: DEMO_IDS.projects.ticketRouter, name: 'Ticket router', version: 'v2' },
    ]);
    expect(existsSync(join(home, 'demo-workspace', '.git'))).toBe(true);

    const entity = await api<Project>('GET', `/api/projects/${DEMO_IDS.projects.ticketRouter}`);
    const pins = Object.fromEntries(collectRefs('project', entity).map((r) => [r.id, r.version]));
    expect(pins[DEMO_IDS.agents.router]).toBe('v2');
    expect(pins[mc]).toBe('v2');
    expect(pins[DEMO_IDS.agents.executor]).toBe('v1');

    const again = await api<RestoreDefaultsResponse>('POST', '/api/settings/restore-defaults');
    expect(again.restored).toEqual([]);
  });

  it('leaves an edited demo entity alone', async () => {
    await start();
    const id = DEMO_IDS.agents.planner;
    const entity = await api<{ prompt: string }>('GET', `/api/agents/${id}`);
    await api('PUT', `/api/agents/${id}`, { ...entity, prompt: 'Mine now' });
    await api('POST', `/api/agents/${id}/merge`, {});
    const res = await api<RestoreDefaultsResponse>('POST', '/api/settings/restore-defaults');
    expect(res.restored).toEqual([]);
    const after = await api<{ prompt: string }>('GET', `/api/agents/${id}`);
    expect(after.prompt).toBe('Mine now');
  });
});
