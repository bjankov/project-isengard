import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ENTITY_KINDS,
  KIND_PLURALS,
  type EntityKind,
  type EntitySummary,
  type ReferencesResponse,
} from '@app/schema';
import {
  SAMPLE_INPUTS,
  sampleAgent,
  sampleProject,
  sampleReadTool,
  sampleSkill,
} from '@app/schema/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from './app.js';
import { loadConfig, type AppConfig } from './config.js';
import { GitMissingError, checkGitInstalled } from './git.js';

let home: string;
let config: AppConfig;
let built: BuiltApp | undefined;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: config.libraryDir, encoding: 'utf8' });
}

async function start(): Promise<BuiltApp> {
  built = await buildApp(config, { logger: false });
  return built;
}

async function stop(): Promise<void> {
  await built?.app.close();
  built = undefined;
}

async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
) {
  const res = await built!.app.inject({
    method,
    url,
    ...(body === undefined ? {} : { payload: body as object }),
  });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

function listAll(): Promise<Record<EntityKind, EntitySummary[]>> {
  return Promise.all(
    ENTITY_KINDS.map(async (k) => [
      k,
      (await api<{ items: EntitySummary[] }>('GET', `/api/${KIND_PLURALS[k]}`)).body.items,
    ]),
  ).then(Object.fromEntries);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'app-test-'));
  config = loadConfig({ APP_HOME: home });
});

afterEach(async () => {
  await stop();
  rmSync(home, { recursive: true, force: true });
});

describe('startup', () => {
  it('initializes the library store as a git repo with one commit per kind folder', async () => {
    await start();
    expect(git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    expect(git('log', '--format=%s').trim()).toBe('Initialize library store');
    for (const dir of ['skills', 'tools', 'agents', 'patterns', 'templates', 'projects']) {
      expect(existsSync(join(config.libraryDir, dir, '.gitkeep'))).toBe(true);
    }
    const health = await api<{ ok: boolean; libraryHead: string }>('GET', '/api/health');
    expect(health.body.ok).toBe(true);
    expect(health.body.libraryHead).toBe(git('rev-parse', 'HEAD').trim());
  });

  it('reopens an existing library without new commits', async () => {
    await start();
    await stop();
    await start();
    expect(git('rev-list', '--count', 'HEAD').trim()).toBe('1');
  });

  it('reports a clear error when git is missing', async () => {
    const path = process.env.PATH;
    process.env.PATH = '';
    try {
      await expect(checkGitInstalled()).rejects.toBeInstanceOf(GitMissingError);
      await expect(checkGitInstalled()).rejects.toThrow(/git was not found/);
    } finally {
      process.env.PATH = path;
    }
  });
});

const EXPECTED_FILES: Record<EntityKind, (id: string) => string[]> = {
  skill: (id) => [`skills/${id}/SKILL.md`],
  tool: (id) => [`tools/${id}.yaml`],
  agent: (id) => [`agents/${id}.yaml`],
  pattern: (id) => [`patterns/${id}/pattern.yaml`, `patterns/${id}/layout.json`],
  template: (id) => [`templates/${id}/workflow.yaml`, `templates/${id}/layout.json`],
  project: (id) => [
    `projects/${id}/project.yaml`,
    `projects/${id}/workflow.yaml`,
    `projects/${id}/layout.json`,
  ],
};

describe.each(ENTITY_KINDS)('CRUD for %s', (kind) => {
  const plural = KIND_PLURALS[kind];
  const input = SAMPLE_INPUTS[kind] as Record<string, unknown>;

  it('creates, reads, updates and deletes, committing each change as files', async () => {
    await start();

    // create
    const created = await api<{ entity: { id: string; name: string }; commit: { hash: string } }>(
      'POST',
      `/api/${plural}`,
      input,
    );
    expect(created.status).toBe(201);
    const { id } = created.body.entity;
    const files = EXPECTED_FILES[kind](id);
    for (const f of files) expect(existsSync(join(config.libraryDir, f)), f).toBe(true);
    expect(git('show', '--name-only', '--format=%s', 'HEAD').trim().split('\n').sort()).toEqual(
      [`Create ${kind} ${id} (${created.body.entity.name})`, '', ...files].sort(),
    );
    expect(git('status', '--porcelain').trim()).toBe('');

    // read
    const read = await api('GET', `/api/${plural}/${id}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(created.body.entity);
    expect((await listAll())[kind].map((s) => s.id)).toEqual([id]);

    // update
    const renamed = kind === 'skill' ? 'renamed-skill' : 'Renamed';
    const updated = await api<{
      entity: { id: string; name: string };
      commit: { message: string };
    }>('PUT', `/api/${plural}/${id}`, { ...input, name: renamed });
    expect(updated.status).toBe(200);
    expect(updated.body.entity).toMatchObject({ id, name: renamed });
    expect(updated.body.commit.message).toBe(`Update ${kind} ${id} (${renamed})`);
    expect((await api<{ name: string }>('GET', `/api/${plural}/${id}`)).body.name).toBe(renamed);
    expect((await listAll())[kind][0]!.name).toBe(renamed);

    // no-op update makes no commit
    const head = git('rev-parse', 'HEAD').trim();
    const noop = await api<{ commit: unknown }>('PUT', `/api/${plural}/${id}`, {
      ...input,
      name: renamed,
    });
    expect(noop.body.commit).toBeNull();
    expect(git('rev-parse', 'HEAD').trim()).toBe(head);

    // delete
    const deleted = await api<{ commit: { message: string } }>('DELETE', `/api/${plural}/${id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.commit.message).toBe(`Delete ${kind} ${id} (${renamed})`);
    for (const f of files) expect(existsSync(join(config.libraryDir, f)), f).toBe(false);
    expect((await api('GET', `/api/${plural}/${id}`)).status).toBe(404);
    expect((await listAll())[kind]).toEqual([]);
    expect(git('status', '--porcelain').trim()).toBe('');
    // init + create + update + delete
    expect(git('rev-list', '--count', 'HEAD').trim()).toBe('4');
  });
});

describe('API errors', () => {
  it('rejects invalid entities with field-level issues and writes nothing', async () => {
    await start();
    const res = await api<{ error: string; issues: { path: unknown[] }[] }>('POST', '/api/agents', {
      ...sampleAgent,
      defaults: { ...sampleAgent.defaults, effort: 'extreme' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation');
    expect(res.body.issues.map((i) => i.path.join('.'))).toContain('defaults.effort');
    expect(git('rev-list', '--count', 'HEAD').trim()).toBe('1');
    expect(git('status', '--porcelain').trim()).toBe('');
  });

  it('404s on unknown kinds and ids', async () => {
    await start();
    expect((await api('GET', '/api/widgets')).status).toBe(404);
    expect((await api('GET', '/api/agents/nope-aaaaaa')).status).toBe(404);
    expect((await api('PUT', '/api/agents/nope-aaaaaa', sampleAgent)).status).toBe(404);
    expect((await api('DELETE', '/api/agents/nope-aaaaaa')).status).toBe(404);
  });

  it('ignores an id in the body; the path id wins', async () => {
    await start();
    const { body } = await api<{ entity: { id: string } }>('POST', '/api/tools', {
      ...sampleReadTool,
      id: 'evil-aaaaaa',
    });
    expect(body.entity.id).not.toBe('evil-aaaaaa');
    const upd = await api<{ entity: { id: string } }>('PUT', `/api/tools/${body.entity.id}`, {
      ...sampleReadTool,
      id: 'evil-aaaaaa',
    });
    expect(upd.body.entity.id).toBe(body.entity.id);
  });

  it('serializes concurrent writes', async () => {
    await start();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        api('POST', '/api/tools', { ...sampleReadTool, name: `Tool ${i}` }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(git('rev-list', '--count', 'HEAD').trim()).toBe('9');
    expect((await listAll()).tool).toHaveLength(8);
  });
});

describe('files', () => {
  it('stores skills as SKILL.md with Agent Skills frontmatter', async () => {
    await start();
    const { body } = await api<{ entity: { id: string } }>('POST', '/api/skills', sampleSkill);
    const text = readFileSync(
      join(config.libraryDir, 'skills', body.entity.id, 'SKILL.md'),
      'utf8',
    );
    expect(text).toBe(
      '---\nname: write-unit-tests\ndescription: Write focused unit tests for changed code.\n---\n\n' +
        sampleSkill.body,
    );
  });

  it('keeps layout separate: moving nodes only touches layout.json', async () => {
    await start();
    const { body } = await api<{ entity: { id: string } }>('POST', '/api/projects', sampleProject);
    const moved = { ...sampleProject, layout: { nodes: { in: { x: 500, y: 500 } } } };
    await api('PUT', `/api/projects/${body.entity.id}`, moved);
    expect(git('show', '--name-only', '--format=', 'HEAD').trim()).toBe(
      `projects/${body.entity.id}/layout.json`,
    );
  });
});

describe('index', () => {
  async function seed() {
    const skill = await api<{ entity: { id: string } }>('POST', '/api/skills', sampleSkill);
    const tool = await api<{ entity: { id: string } }>('POST', '/api/tools', sampleReadTool);
    const agent = await api<{ entity: { id: string } }>('POST', '/api/agents', {
      ...sampleAgent,
      skills: [{ kind: 'skill', id: skill.body.entity.id, version: 'v1' }],
      tools: [{ kind: 'tool', id: tool.body.entity.id, version: 'v1' }],
    });
    for (const kind of ['pattern', 'template', 'project'] as const) {
      await api('POST', `/api/${KIND_PLURALS[kind]}`, SAMPLE_INPUTS[kind]);
    }
    return {
      skillId: skill.body.entity.id,
      toolId: tool.body.entity.id,
      agentId: agent.body.entity.id,
    };
  }

  it('answers reference lookups in both directions', async () => {
    await start();
    const { skillId, agentId } = await seed();
    const out = await api<ReferencesResponse>('GET', `/api/agents/${agentId}/references`);
    expect(out.body.outgoing.map((r) => r.kind)).toEqual(['skill', 'tool']);
    const inc = await api<ReferencesResponse>('GET', `/api/skills/${skillId}/references`);
    expect(inc.body.incoming).toEqual([{ kind: 'agent', id: agentId, version: 'v1' }]);
  });

  it('searches by name and description', async () => {
    await start();
    await seed();
    const res = await api<{ items: EntitySummary[] }>('GET', '/api/agents?q=plan');
    expect(res.body.items.map((i) => i.name)).toEqual(['Planner']);
    expect((await api<{ items: unknown[] }>('GET', '/api/agents?q=zzz')).body.items).toEqual([]);
  });

  it('is rebuilt from git on startup after the index file is deleted', async () => {
    await start();
    const { agentId } = await seed();
    const before = await listAll();
    const refsBefore = (await api('GET', `/api/agents/${agentId}/references`)).body;
    await stop();

    rmSync(config.indexPath);
    for (const suffix of ['-wal', '-shm']) rmSync(`${config.indexPath}${suffix}`, { force: true });
    expect(existsSync(config.indexPath)).toBe(false);

    await start();
    expect(existsSync(config.indexPath)).toBe(true);
    expect(await listAll()).toEqual(before);
    expect((await api('GET', `/api/agents/${agentId}/references`)).body).toEqual(refsBefore);
  });

  it('is rebuilt on demand, even if the file was deleted while running', async () => {
    await start();
    await seed();
    const before = await listAll();
    rmSync(config.indexPath, { force: true });
    const res = await api<{ entities: number; references: number; invalid: unknown[] }>(
      'POST',
      '/api/index/rebuild',
    );
    expect(res.status).toBe(200);
    expect(res.body.entities).toBe(6);
    expect(res.body.invalid).toEqual([]);
    expect(await listAll()).toEqual(before);
  });

  it('catches up with commits made outside the app', async () => {
    await start();
    await seed();
    await stop();
    writeFileSync(
      join(config.libraryDir, 'tools', 'hand-made-aaaaaa.yaml'),
      'name: Hand made\ndescription: ""\nbuiltin: web_search\nscope: {}\n',
    );
    git('add', '-A');
    git('commit', '-qm', 'manual');
    await start();
    expect((await listAll()).tool.map((t) => t.name)).toContain('Hand made');
  });

  it('reports invalid stored entities instead of failing the rebuild', async () => {
    await start();
    await seed();
    writeFileSync(join(config.libraryDir, 'agents', 'broken-aaaaaa.yaml'), 'name: Broken\n');
    git('add', '-A');
    git('commit', '-qm', 'broken');
    const res = await api<{ entities: number; invalid: { kind: string; id: string }[] }>(
      'POST',
      '/api/index/rebuild',
    );
    expect(res.body.entities).toBe(6);
    expect(res.body.invalid).toMatchObject([{ kind: 'agent', id: 'broken-aaaaaa' }]);
  });
});
