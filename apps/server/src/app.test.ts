import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ENTITY_KINDS,
  KIND_PLURALS,
  type EntityKind,
  type EntityListItem,
  type EntitySummary,
  type DiffResponse,
  type HistoryResponse,
  type ReferencesResponse,
  type VersionStatus,
  type WorkspaceCheck,
  type WorkspaceSuggestions,
} from '@app/schema';
import { SAMPLE_INPUTS, sampleAgent, sampleReadTool, sampleSkill } from '@app/schema/testing';
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

function listAll(): Promise<Record<EntityKind, EntityListItem[]>> {
  return Promise.all(
    ENTITY_KINDS.map(async (k) => [
      k,
      (await api<{ items: EntityListItem[] }>('GET', `/api/${KIND_PLURALS[k]}`)).body.items,
    ]),
  ).then(Object.fromEntries);
}

let workspace: string;

beforeEach(() => {
  // Resolve symlinks (macOS: /var -> /private/var) so paths match what git reports.
  home = realpathSync(mkdtempSync(join(tmpdir(), 'app-test-')));
  config = loadConfig({ APP_HOME: home });
  workspace = join(home, 'workspace');
  mkdirSync(workspace);
  execFileSync('git', ['init', '-q'], { cwd: workspace });
});

/** Sample input of a kind; projects point at the test's workspace repo. */
function sampleInput(kind: EntityKind): Record<string, unknown> {
  const input = SAMPLE_INPUTS[kind] as Record<string, unknown>;
  return kind === 'project' ? { ...input, workspacePath: workspace } : input;
}

/** Input → Output: a workflow without problems. */
const MINIMAL_WORKFLOW = {
  nodes: [
    { id: 'in', type: 'input', name: 'Task', payloadType: 'text' },
    { id: 'out', type: 'output', name: 'Result', payloadType: 'text' },
  ],
  edges: [
    {
      id: 'e1',
      source: { node: 'in' },
      target: { node: 'out' },
      payload: 'text',
      context: { mode: 'full' },
    },
  ],
};

afterEach(async () => {
  await stop();
  rmSync(home, { recursive: true, force: true });
});

describe('startup', () => {
  it('initializes the library store as a git repo with one commit per kind folder', async () => {
    await start();
    expect(git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    expect(git('log', '--format=%s').trim()).toBe('Add default settings\nInitialize library store');
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
    expect(git('rev-list', '--count', 'HEAD').trim()).toBe('2');
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

  it('creates, reads, updates and deletes, committing each change as files', async () => {
    await start();
    // The sample workflows pin agents this library doesn't have, which would block merging.
    const input =
      kind === 'project' || kind === 'template'
        ? { ...sampleInput(kind), workflow: MINIMAL_WORKFLOW, layout: { nodes: {} } }
        : sampleInput(kind);

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

    // update: saved on the draft branch, main is unchanged
    const draftRef = `refs/heads/${kind}/${id}/draft`;
    const mainBefore = git('rev-parse', 'main').trim();
    const renamed = kind === 'skill' ? 'renamed-skill' : 'Renamed';
    const updated = await api<{
      entity: { id: string; name: string };
      commit: { message: string; hash: string };
      status: VersionStatus;
    }>('PUT', `/api/${plural}/${id}`, { ...input, name: renamed });
    expect(updated.status).toBe(200);
    expect(updated.body.entity).toMatchObject({ id, name: renamed });
    expect(updated.body.commit.message).toBe(`Update ${kind} ${id} (${renamed})`);
    expect(updated.body.status).toMatchObject({
      current: 'v1',
      versions: ['v1'],
      branches: [{ name: 'draft', commits: 1, changed: true, head: updated.body.commit.hash }],
    });
    expect(git('rev-parse', 'main').trim()).toBe(mainBefore);
    expect(git('rev-parse', draftRef).trim()).toBe(updated.body.commit.hash);
    expect(git('status', '--porcelain').trim()).toBe('');
    const original = created.body.entity.name;
    expect((await api<{ name: string }>('GET', `/api/${plural}/${id}`)).body.name).toBe(original);
    expect((await api<{ name: string }>('GET', `/api/${plural}/${id}?ref=draft`)).body.name).toBe(
      renamed,
    );
    expect((await listAll())[kind][0]).toMatchObject({
      name: original,
      version: 'v1',
      hasDraft: true,
    });

    // no-op update makes no commit
    const noop = await api<{ commit: unknown }>('PUT', `/api/${plural}/${id}`, {
      ...input,
      name: renamed,
    });
    expect(noop.body.commit).toBeNull();
    expect(git('rev-parse', draftRef).trim()).toBe(updated.body.commit.hash);

    // merge: main gets the draft as v2, the draft is gone
    const merged = await api<{
      entity: { name: string };
      commit: { message: string };
      version: string;
      status: VersionStatus;
    }>('POST', `/api/${plural}/${id}/merge`);
    expect(merged.status).toBe(200);
    expect(merged.body.version).toBe('v2');
    expect(merged.body.entity.name).toBe(renamed);
    expect(merged.body.commit.message).toBe(`Merge ${kind} ${id} (${renamed}) as v2`);
    expect(merged.body.status).toEqual({ current: 'v2', versions: ['v2', 'v1'], branches: [] });
    expect(git('rev-parse', `${kind}/${id}/v2`).trim()).toBe(git('rev-parse', 'main').trim());
    expect(git('branch', '--list', `${kind}/${id}/*`).trim()).toBe('');
    expect(git('status', '--porcelain').trim()).toBe('');
    expect((await api<{ name: string }>('GET', `/api/${plural}/${id}`)).body.name).toBe(renamed);
    expect((await api<{ name: string }>('GET', `/api/${plural}/${id}?ref=v1`)).body.name).toBe(
      original,
    );
    expect((await listAll())[kind][0]).toMatchObject({
      name: renamed,
      version: 'v2',
      hasDraft: false,
    });

    // delete
    const deleted = await api<{ commit: { message: string } }>('DELETE', `/api/${plural}/${id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.commit.message).toBe(`Delete ${kind} ${id} (${renamed})`);
    for (const f of files) expect(existsSync(join(config.libraryDir, f)), f).toBe(false);
    expect((await api('GET', `/api/${plural}/${id}`)).status).toBe(404);
    expect((await listAll())[kind]).toEqual([]);
    expect(git('status', '--porcelain').trim()).toBe('');
    // init + settings + create + draft update + merge + delete
    expect(git('rev-list', '--count', 'HEAD').trim()).toBe('6');
    // version tags stay in history
    expect(git('tag', '--list', `${kind}/${id}/*`).trim().split('\n')).toEqual([
      `${kind}/${id}/v1`,
      `${kind}/${id}/v2`,
    ]);
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
    expect(git('rev-list', '--count', 'HEAD').trim()).toBe('2');
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
    expect(git('rev-list', '--count', 'HEAD').trim()).toBe('10');
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

  it('preserves advanced and unknown frontmatter of hand-written skills when editing', async () => {
    await start();
    const id = 'pdf-tools-aaaaaa';
    mkdirSync(join(config.libraryDir, 'skills', id), { recursive: true });
    writeFileSync(
      join(config.libraryDir, 'skills', id, 'SKILL.md'),
      '---\nname: pdf-tools\ndescription: PDFs\nlicense: MIT\nmetadata:\n  version: 2\nx-team: docs\n---\nBody\n',
    );
    git('add', '-A');
    git('commit', '-qm', 'hand-written skill');
    await api('POST', '/api/index/rebuild');

    const { body: skill } = await api<Record<string, unknown>>('GET', `/api/skills/${id}`);
    expect(skill).toMatchObject({
      license: 'MIT',
      metadata: { version: '2' },
      extraFrontmatter: { 'x-team': 'docs' },
    });
    const { id: _id, ...input } = skill;
    await api('PUT', `/api/skills/${id}`, { ...input, description: 'PDF tools' });
    expect(git('show', `refs/heads/skill/${id}/draft:skills/${id}/SKILL.md`)).toBe(
      '---\nname: pdf-tools\ndescription: PDF tools\nlicense: MIT\nmetadata:\n  version: "2"\nx-team: docs\n---\n\nBody\n',
    );
  });

  it('keeps layout separate: moving nodes only touches layout.json', async () => {
    await start();
    const project = sampleInput('project');
    const { body } = await api<{ entity: { id: string } }>('POST', '/api/projects', project);
    const moved = { ...project, layout: { nodes: { in: { x: 500, y: 500 } } } };
    await api('PUT', `/api/projects/${body.entity.id}`, moved);
    const draft = `refs/heads/project/${body.entity.id}/draft`;
    expect(git('show', '--name-only', '--format=', draft).trim()).toBe(
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
      await api('POST', `/api/${KIND_PLURALS[kind]}`, sampleInput(kind));
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

describe('settings', () => {
  it('seeds default settings in a new library', async () => {
    await start();
    const res = await api<{ settings: { models: { model: string }[] }; libraryDir: string }>(
      'GET',
      '/api/settings',
    );
    expect(res.status).toBe(200);
    expect(res.body.libraryDir).toBe(config.libraryDir);
    expect(res.body.settings.models.map((m) => m.model)).toContain('claude-sonnet-5-5');
    expect(existsSync(join(config.libraryDir, 'settings.yaml'))).toBe(true);
  });

  it('adds default settings to an existing library that has none', async () => {
    await start();
    await stop();
    git('rm', '-q', 'settings.yaml');
    git('commit', '-qm', 'remove settings');
    await start();
    expect((await api('GET', '/api/settings')).status).toBe(200);
    expect(git('log', '-1', '--format=%s').trim()).toBe('Add default settings');
  });

  it('updates settings as a commit and validates them', async () => {
    await start();
    const { body } = await api<{ settings: Record<string, unknown> }>('GET', '/api/settings');
    const next = {
      ...body.settings,
      models: [{ provider: 'local', model: 'llama-4', label: 'Llama 4' }],
    };
    const res = await api<{ commit: { message: string } }>('PUT', '/api/settings', next);
    expect(res.status).toBe(200);
    expect(res.body.commit.message).toBe('Update settings');
    expect(readFileSync(join(config.libraryDir, 'settings.yaml'), 'utf8')).toContain('llama-4');
    const again = await api<{ commit: unknown }>('PUT', '/api/settings', next);
    expect(again.body.commit).toBeNull();

    const bad = await api<{ error: string }>('PUT', '/api/settings', { ...next, models: 'nope' });
    expect(bad.status).toBe(400);
    expect(git('status', '--porcelain').trim()).toBe('');
  });

  it('does not trigger an index rebuild on restart after a settings change', async () => {
    await start();
    const { body } = await api<{ settings: Record<string, unknown> }>('GET', '/api/settings');
    await api('PUT', '/api/settings', { ...body.settings, models: [] });
    const head = git('rev-parse', 'HEAD').trim();
    await stop();
    await start();
    const health = await api<{ libraryHead: string }>('GET', '/api/health');
    expect(health.body.libraryHead).toBe(head);
  });
});

describe('full lists', () => {
  it('returns complete entities with ?full=1', async () => {
    await start();
    await api('POST', '/api/tools', sampleReadTool);
    const res = await api<{ items: { builtin: string; scope: unknown }[] }>(
      'GET',
      '/api/tools?full=1',
    );
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ builtin: 'read_file', scope: { paths: ['src/**'] } });
  });
});

describe('deleting referenced entities', () => {
  it('is blocked with the list of users until the reference is removed', async () => {
    await start();
    const skill = await api<{ entity: { id: string } }>('POST', '/api/skills', sampleSkill);
    const skillRef = { kind: 'skill', id: skill.body.entity.id, version: 'v1' };
    const agent = await api<{ entity: { id: string } }>('POST', '/api/agents', {
      ...sampleAgent,
      skills: [skillRef],
      tools: [],
    });

    const blocked = await api<{
      error: string;
      references: { kind: string; id: string; name: string }[];
    }>('DELETE', `/api/skills/${skill.body.entity.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('conflict');
    expect(blocked.body.references).toMatchObject([
      { kind: 'agent', id: agent.body.entity.id, name: 'Planner', version: 'v1' },
    ]);
    expect(existsSync(join(config.libraryDir, 'skills', skill.body.entity.id))).toBe(true);

    await api('PUT', `/api/agents/${agent.body.entity.id}`, {
      ...sampleAgent,
      skills: [],
      tools: [],
    });
    // Still blocked: the reference is only gone on the agent's draft, not on main.
    expect((await api('DELETE', `/api/skills/${skill.body.entity.id}`)).status).toBe(409);
    await api('POST', `/api/agents/${agent.body.entity.id}/merge`);
    expect((await api('DELETE', `/api/skills/${skill.body.entity.id}`)).status).toBe(200);
  });
});

describe('versioning', () => {
  type Created = { entity: { id: string; name: string } };

  async function createAgent(name = 'Planner') {
    const res = await api<Created>('POST', '/api/agents', {
      ...sampleAgent,
      name,
      skills: [],
      tools: [],
    });
    return res.body.entity.id;
  }

  const edit = (id: string, changes: Record<string, unknown>) =>
    api<{ commit: { hash: string } | null; status: VersionStatus }>('PUT', `/api/agents/${id}`, {
      ...sampleAgent,
      skills: [],
      tools: [],
      ...changes,
    });

  it('tags v1 on create and reports the version status', async () => {
    await start();
    const id = await createAgent();
    expect(git('rev-parse', `agent/${id}/v1`).trim()).toBe(git('rev-parse', 'main').trim());
    const status = await api<VersionStatus>('GET', `/api/agents/${id}/versions`);
    expect(status.body).toEqual({ current: 'v1', versions: ['v1'], branches: [] });
    expect((await api('GET', '/api/agents/nope-aaaaaa/versions')).status).toBe(404);
  });

  it('tags existing untagged entities as v1 on startup', async () => {
    await start();
    const id = await createAgent();
    await stop();
    git('tag', '-d', `agent/${id}/v1`);
    git('commit', '-q', '--allow-empty', '-m', 'unrelated');
    await start();
    expect(git('rev-parse', `agent/${id}/v1`).trim()).toBe(git('rev-parse', 'main').trim());
    expect((await listAll()).agent[0]).toMatchObject({ id, version: 'v1', hasDraft: false });
  });

  it('never switches the working tree: files on disk always show main', async () => {
    await start();
    const id = await createAgent();
    const file = join(config.libraryDir, 'agents', `${id}.yaml`);
    const onMain = readFileSync(file, 'utf8');
    await edit(id, { name: 'Draft name' });
    expect(git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    expect(readFileSync(file, 'utf8')).toBe(onMain);
    expect(git('status', '--porcelain').trim()).toBe('');
    await api('POST', `/api/agents/${id}/merge`);
    expect(readFileSync(file, 'utf8')).toContain('Draft name');
    expect(git('status', '--porcelain').trim()).toBe('');
  });

  it('merges only the entity being merged', async () => {
    await start();
    const a = await createAgent('Alpha');
    const b = await createAgent('Beta');
    await edit(a, { name: 'Alpha 2' });
    await edit(b, { name: 'Beta 2' });
    const mergeA = await api<{ version: string }>('POST', `/api/agents/${a}/merge`);
    expect(mergeA.body.version).toBe('v2');
    expect((await api<{ name: string }>('GET', `/api/agents/${b}`)).body.name).toBe('Beta');
    expect(
      (await api<VersionStatus>('GET', `/api/agents/${b}/versions`)).body.branches,
    ).toMatchObject([{ name: 'draft', changed: true }]);
    // B's draft started before A was merged; that is not a conflict for B.
    const mergeB = await api<{ version: string }>('POST', `/api/agents/${b}/merge`);
    expect(mergeB.status).toBe(200);
    expect(mergeB.body.version).toBe('v2');
    expect((await listAll()).agent.map((x) => [x.name, x.version])).toEqual([
      ['Alpha 2', 'v2'],
      ['Beta 2', 'v2'],
    ]);
  });

  it('starts a new draft after a merge and keeps counting versions', async () => {
    await start();
    const id = await createAgent();
    await edit(id, { name: 'Two' });
    await api('POST', `/api/agents/${id}/merge`);
    const again = await edit(id, { name: 'Three' });
    expect(again.body.status.branches).toMatchObject([{ name: 'draft', commits: 1 }]);
    const merged = await api<{ version: string }>('POST', `/api/agents/${id}/merge`);
    expect(merged.body.version).toBe('v3');
  });

  it('does not create a draft for a save that changes nothing', async () => {
    await start();
    const id = await createAgent();
    const res = await edit(id, {});
    expect(res.body.commit).toBeNull();
    expect(res.body.status.branches).toEqual([]);
    expect(git('branch', '--list', `agent/${id}/*`).trim()).toBe('');
  });

  it('refuses to merge a draft that matches main', async () => {
    await start();
    const id = await createAgent();
    await edit(id, { name: 'Changed' });
    const back = await edit(id, {});
    expect(back.body.status.branches).toMatchObject([{ commits: 2, changed: false }]);
    const res = await api<{ error: string }>('POST', `/api/agents/${id}/merge`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('bad_request');
  });

  it('404s when merging without a draft', async () => {
    await start();
    const id = await createAgent();
    expect((await api('POST', `/api/agents/${id}/merge`)).status).toBe(404);
  });

  it('detects that main changed since the draft started, and merges with force', async () => {
    await start();
    const id = await createAgent();
    await edit(id, { name: 'From draft' });
    // Someone changes main's copy outside the app.
    const file = join(config.libraryDir, 'agents', `${id}.yaml`);
    writeFileSync(file, readFileSync(file, 'utf8').replace('Planner', 'From main'));
    git('commit', '-qam', 'manual edit');

    const res = await api<{ error: string }>('POST', `/api/agents/${id}/merge`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('merge_conflict');
    expect((await api<{ name: string }>('GET', `/api/agents/${id}`)).body.name).toBe('From main');

    const forced = await api<{ version: string; entity: { name: string } }>(
      'POST',
      `/api/agents/${id}/merge`,
      { force: true },
    );
    expect(forced.status).toBe(200);
    expect(forced.body.entity.name).toBe('From draft');
    expect((await api<{ name: string }>('GET', `/api/agents/${id}`)).body.name).toBe('From draft');
  });

  it('discards a draft', async () => {
    await start();
    const id = await createAgent();
    await edit(id, { name: 'Throwaway' });
    const res = await api<{ status: VersionStatus }>('DELETE', `/api/agents/${id}/branches/draft`);
    expect(res.status).toBe(200);
    expect(res.body.status.branches).toEqual([]);
    expect((await api('GET', `/api/agents/${id}?ref=draft`)).status).toBe(404);
    expect((await api<{ name: string }>('GET', `/api/agents/${id}`)).body.name).toBe('Planner');
    expect((await api('DELETE', `/api/agents/${id}/branches/draft`)).status).toBe(404);
  });

  it('deletes the draft branch together with the entity', async () => {
    await start();
    const id = await createAgent();
    await edit(id, { name: 'Draft' });
    expect((await api('DELETE', `/api/agents/${id}`)).status).toBe(200);
    expect(git('branch', '--list', `agent/${id}/*`).trim()).toBe('');
    expect(git('tag', '--list', `agent/${id}/*`).trim()).toBe(`agent/${id}/v1`);
  });

  it('shows history and diffs between versions, branches and commits', async () => {
    await start();
    const id = await createAgent();
    const first = await edit(id, { name: 'Second' });
    await edit(id, { name: 'Second', prompt: 'Plan carefully.' });
    await api('POST', `/api/agents/${id}/merge`);
    const pending = await edit(id, { name: 'Third', prompt: 'Plan carefully.' });

    const history = await api<HistoryResponse>('GET', `/api/agents/${id}/history`);
    expect(history.status).toBe(200);
    expect(history.body.versions.map((v) => [v.version, v.message])).toEqual([
      ['v2', `Merge agent ${id} (Second) as v2`],
      ['v1', `Create agent ${id} (Planner)`],
    ]);
    expect(history.body.branches).toHaveLength(1);
    expect(history.body.branches[0]).toMatchObject({ name: 'draft', commits: 1, changed: true });
    expect(history.body.branches[0]!.log.map((c) => [c.hash, c.message])).toEqual([
      [pending.body.commit!.hash, `Update agent ${id} (Third)`],
    ]);

    const path = `agents/${id}.yaml`;
    const v1v2 = await api<DiffResponse>('GET', `/api/agents/${id}/diff?from=v1&to=v2`);
    expect(v1v2.body.files.map((f) => f.path)).toEqual([path]);
    expect(v1v2.body.files[0]!.before).toContain('name: Planner');
    expect(v1v2.body.files[0]!.after).toContain('name: Second');

    const toDraft = await api<DiffResponse>('GET', `/api/agents/${id}/diff?from=main&to=draft`);
    expect(toDraft.body.files[0]!.after).toContain('name: Third');

    // A commit that was merged earlier is still reachable by hash.
    const byHash = await api<DiffResponse>(
      'GET',
      `/api/agents/${id}/diff?from=v1&to=${first.body.commit!.hash.slice(0, 10)}`,
    );
    expect(byHash.body.files[0]!.after).toContain('name: Second');
    expect(byHash.body.files[0]!.after).not.toContain('Plan carefully.');

    const same = await api<DiffResponse>('GET', `/api/agents/${id}/diff?from=v2&to=main`);
    expect(same.body.files).toEqual([]);

    expect((await api('GET', `/api/agents/${id}/diff?from=v1`)).status).toBe(400);
    expect((await api('GET', `/api/agents/${id}/diff?from=v1&to=v9`)).status).toBe(404);
    expect((await api('GET', `/api/agents/${id}?ref=v9`)).status).toBe(404);
    expect((await api('GET', `/api/agents/${id}?ref=nope`)).status).toBe(404);
  });

  it('stores a merge note in the merge commit and shows it in the history', async () => {
    await start();
    const id = await createAgent();
    await edit(id, { name: 'Second' });
    const merged = await api<{ commit: { hash: string } }>('POST', `/api/agents/${id}/merge`, {
      note: '  Tightened\n the plan  ',
    });
    expect(merged.status).toBe(200);
    expect(git('log', '-1', '--format=%B', 'main').trim()).toBe(
      `Merge agent ${id} (Second) as v2\n\nTightened the plan`,
    );
    const history = await api<HistoryResponse>('GET', `/api/agents/${id}/history`);
    expect(history.body.versions.map((v) => [v.version, v.note])).toEqual([
      ['v2', 'Tightened the plan'],
      ['v1', undefined],
    ]);
    expect(history.body.versions[0]!.message).toBe(`Merge agent ${id} (Second) as v2`);

    await edit(id, { name: 'Third' });
    const tooLong = await api<{ error: string }>('POST', `/api/agents/${id}/merge`, {
      note: 'x'.repeat(201),
    });
    expect(tooLong.status).toBe(400);
    expect((await api('POST', `/api/agents/${id}/merge`, { note: 42 })).status).toBe(400);
    expect(git('branch', '--list', `agent/${id}/draft`).trim()).not.toBe('');
  });

  it('creates a fork branch at a version and saves to it', async () => {
    await start();
    const id = await createAgent();
    await edit(id, { name: 'Two' });
    await api('POST', `/api/agents/${id}/merge`);

    const fork = await api<{ status: VersionStatus }>('POST', `/api/agents/${id}/branches`, {
      name: 'fork-proj-agent-1',
      from: 'v1',
    });
    expect(fork.status).toBe(201);
    expect(fork.body.status.branches).toMatchObject([{ name: 'fork-proj-agent-1', commits: 0 }]);
    expect(git('rev-parse', `agent/${id}/fork-proj-agent-1`).trim()).toBe(
      git('rev-parse', `agent/${id}/v1`).trim(),
    );
    expect(
      (await api<{ name: string }>('GET', `/api/agents/${id}?ref=fork-proj-agent-1`)).body.name,
    ).toBe('Planner');

    const saved = await api<{ status: VersionStatus }>(
      'PUT',
      `/api/agents/${id}?branch=fork-proj-agent-1`,
      { ...sampleAgent, skills: [], tools: [], name: 'Forked' },
    );
    expect(saved.status).toBe(200);
    expect(
      (await api<{ name: string }>('GET', `/api/agents/${id}?ref=fork-proj-agent-1`)).body.name,
    ).toBe('Forked');
    // main and the (absent) draft are untouched
    expect((await api<{ name: string }>('GET', `/api/agents/${id}`)).body.name).toBe('Two');
    expect(saved.body.status.branches.map((b) => b.name)).toEqual(['fork-proj-agent-1']);

    const dup = await api('POST', `/api/agents/${id}/branches`, {
      name: 'fork-proj-agent-1',
      from: 'v2',
    });
    expect(dup.status).toBe(400);
    expect(
      (await api('POST', `/api/agents/${id}/branches`, { name: 'draft', from: 'v1' })).status,
    ).toBe(400);
    expect(
      (await api('POST', `/api/agents/${id}/branches`, { name: 'x', from: 'v9' })).status,
    ).toBe(404);
    expect(
      (await api('PUT', `/api/agents/${id}?branch=nope`, { ...sampleAgent, skills: [], tools: [] }))
        .status,
    ).toBe(404);
  });

  it('includes versions in full lists', async () => {
    await start();
    const id = await createAgent();
    await edit(id, { name: 'Draft' });
    const res = await api<{ items: unknown[]; versions: Record<string, unknown> }>(
      'GET',
      '/api/agents?full=1',
    );
    expect(res.body.versions).toEqual({ [id]: { version: 'v1', hasDraft: true } });
  });
});

describe('workspace', () => {
  const check = (path: string) =>
    api<WorkspaceCheck>('POST', '/api/workspace/check', { path }).then((r) => r.body);

  it('checks folders', async () => {
    await start();
    expect(await check(workspace)).toEqual({ path: workspace, status: 'ok' });
    expect(await check(`${workspace}/`)).toMatchObject({ path: workspace, status: 'ok' });
    expect((await check('relative/path')).status).toBe('not-absolute');
    expect((await check(join(home, 'missing'))).status).toBe('not-found');
    writeFileSync(join(home, 'file.txt'), 'x');
    expect((await check(join(home, 'file.txt'))).status).toBe('not-a-directory');
    mkdirSync(join(home, 'plain'));
    expect((await check(join(home, 'plain'))).status).toBe('not-a-repo');
    mkdirSync(join(workspace, 'src'));
    expect(await check(join(workspace, 'src'))).toMatchObject({
      status: 'inside-repo',
      repoRoot: workspace,
    });
    expect((await check(config.libraryDir)).status).toBe('is-library');
    expect((await check(join(config.libraryDir, 'agents'))).status).toBe('is-library');
    expect((await check(home)).status).toBe('is-library');
  });

  it('initializes a git repo only in a plain folder', async () => {
    await start();
    const plain = join(home, 'plain');
    mkdirSync(plain);
    const res = await api<WorkspaceCheck>('POST', '/api/workspace/init', { path: plain });
    expect(res.body.status).toBe('ok');
    expect(existsSync(join(plain, '.git'))).toBe(true);
    // Never inside another repo or the library.
    mkdirSync(join(workspace, 'sub'));
    const inside = await api<WorkspaceCheck>('POST', '/api/workspace/init', {
      path: join(workspace, 'sub'),
    });
    expect(inside.body.status).toBe('inside-repo');
    expect(existsSync(join(workspace, 'sub', '.git'))).toBe(false);
  });

  it('suggests folders for a partly typed path', async () => {
    await start();
    mkdirSync(join(home, 'code-a'));
    mkdirSync(join(home, 'code-b'));
    mkdirSync(join(home, '.hidden'));
    const res = await api<WorkspaceSuggestions>(
      'GET',
      `/api/workspace/suggest?path=${encodeURIComponent(join(home, 'co'))}`,
    );
    expect(res.body.items.map((i) => i.path)).toEqual([join(home, 'code-a'), join(home, 'code-b')]);
    const children = await api<WorkspaceSuggestions>(
      'GET',
      `/api/workspace/suggest?path=${encodeURIComponent(`${home}/`)}`,
    );
    expect(children.body.items.find((i) => i.path === workspace)?.isGitRepo).toBe(true);
    expect(children.body.items.some((i) => i.path.endsWith('.hidden'))).toBe(false);
  });

  it('checks where a new workspace folder would go', async () => {
    await start();
    const checkNew = (path: string) =>
      api<WorkspaceCheck>('POST', '/api/workspace/check-new', { path }).then((r) => r.body);
    expect(await checkNew(join(home, 'new', 'app'))).toEqual({
      path: join(home, 'new', 'app'),
      status: 'ok',
    });
    expect((await checkNew(workspace)).status).toBe('exists');
    expect((await checkNew('relative')).status).toBe('not-absolute');
    writeFileSync(join(home, 'file.txt'), 'x');
    expect((await checkNew(join(home, 'file.txt', 'app'))).status).toBe('not-a-directory');
    expect((await checkNew(join(config.libraryDir, 'agents', 'x'))).status).toBe('is-library');
    expect(await checkNew(join(workspace, 'nested'))).toMatchObject({
      status: 'ok',
      warning: expect.stringContaining(workspace),
    });
  });

  it('creates the workspace folder with a git repo together with the project', async () => {
    await start();
    const target = join(home, 'code', 'checkout');
    const res = await api<{ entity: { workspacePath: string } }>(
      'POST',
      '/api/projects?createWorkspace=1',
      { ...sampleInput('project'), workspacePath: target },
    );
    expect(res.status).toBe(201);
    expect(res.body.entity.workspacePath).toBe(target);
    expect(existsSync(join(target, '.git'))).toBe(true);

    // The folder exists now, so the same request is refused.
    const again = await api<{ issues: { path: string[] }[] }>(
      'POST',
      '/api/projects?createWorkspace=1',
      { ...sampleInput('project'), workspacePath: target },
    );
    expect(again.status).toBe(400);
    expect(again.body.issues).toMatchObject([{ path: ['workspacePath'] }]);

    // An invalid project creates no folder.
    const other = join(home, 'code', 'never');
    const invalid = await api('POST', '/api/projects?createWorkspace=1', {
      ...sampleInput('project'),
      name: '',
      workspacePath: other,
    });
    expect(invalid.status).toBe(400);
    expect(existsSync(other)).toBe(false);
  });

  it('requires projects to point at a git repo, checked on create and on path changes', async () => {
    await start();
    const project = sampleInput('project');
    const bad = await api<{ error: string; issues: { path: string[]; message: string }[] }>(
      'POST',
      '/api/projects',
      { ...project, workspacePath: join(home, 'missing') },
    );
    expect(bad.status).toBe(400);
    expect(bad.body.issues).toMatchObject([{ path: ['workspacePath'] }]);

    const created = await api<{ entity: { id: string; workspacePath: string } }>(
      'POST',
      '/api/projects',
      project,
    );
    expect(created.status).toBe(201);
    const id = created.body.entity.id;

    // Changing the path to a non-repo is refused.
    mkdirSync(join(home, 'plain'));
    const moved = await api('PUT', `/api/projects/${id}`, {
      ...project,
      workspacePath: join(home, 'plain'),
    });
    expect(moved.status).toBe(400);

    // A workspace that disappeared later does not block saving other changes.
    rmSync(workspace, { recursive: true, force: true });
    const renamed = await api('PUT', `/api/projects/${id}`, { ...project, name: 'Renamed' });
    expect(renamed.status).toBe(200);
  });
});

describe('workflow checks', () => {
  /** Demo workflow 1 with the loop's cap removed. */
  const uncapped = () => {
    const project = structuredClone(sampleInput('project')) as {
      workflow: { nodes: { id: string; exits?: { maxIterations?: number }[] }[] };
    };
    for (const n of project.workflow.nodes) for (const x of n.exits ?? []) delete x.maxIterations;
    return project;
  };

  it('refuses to save a workflow with an uncapped loop, before creating anything', async () => {
    await start();
    const before = git('rev-parse', 'main').trim();
    const res = await api<{ error: string; problems: { rule: string; edges: string[] }[] }>(
      'POST',
      '/api/projects',
      uncapped(),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('workflow');
    expect(res.body.problems).toMatchObject([{ rule: 'uncapped-loop', edges: ['e7', 'e4', 'e5'] }]);
    expect(git('rev-parse', 'main').trim()).toBe(before);

    // Nor with ?createWorkspace=1: no folder is made.
    const folder = join(home, 'new-ws');
    const created = await api('POST', '/api/projects?createWorkspace=1', {
      ...uncapped(),
      workspacePath: folder,
    });
    expect(created.status).toBe(400);
    expect(existsSync(folder)).toBe(false);

    // Saving an existing project is refused the same way.
    const ok = await api<{ entity: { id: string } }>(
      'POST',
      '/api/projects',
      sampleInput('project'),
    );
    expect(ok.status).toBe(201);
    const put = await api<{ error: string }>(
      'PUT',
      `/api/projects/${ok.body.entity.id}`,
      uncapped(),
    );
    expect(put.status).toBe(400);
    expect(put.body.error).toBe('workflow');
  });

  it('refuses to merge a workflow with errors, and merges once they are fixed', async () => {
    await start();
    const created = await api<{ entity: { id: string } }>('POST', '/api/projects', {
      ...sampleInput('project'),
      workflow: MINIMAL_WORKFLOW,
    });
    const id = created.body.entity.id;
    // A dangling decision exit is an error (it doesn't block saving).
    const withDecision = {
      ...sampleInput('project'),
      workflow: {
        nodes: [
          ...MINIMAL_WORKFLOW.nodes,
          {
            id: 'd',
            type: 'decision',
            evaluator: { type: 'human', instructions: 'Ok?', allowFeedback: true },
            exits: [
              { id: 'yes', label: 'approve' },
              { id: 'no', label: 'reject' },
            ],
          },
        ],
        edges: [
          {
            id: 'e1',
            source: { node: 'in' },
            target: { node: 'd' },
            payload: 'text',
            context: { mode: 'full' },
          },
          {
            id: 'e2',
            source: { node: 'd', port: 'yes' },
            target: { node: 'out' },
            payload: 'text',
            context: { mode: 'full' },
          },
        ],
      },
    };
    expect((await api('PUT', `/api/projects/${id}`, withDecision)).status).toBe(200);
    const refused = await api<{ error: string; message: string; problems: { rule: string }[] }>(
      'POST',
      `/api/projects/${id}/merge`,
    );
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('workflow');
    expect(refused.body.message).toMatch(/Can’t merge/);
    expect(refused.body.problems.map((p) => p.rule)).toEqual(['exit-unconnected']);

    // Library rules run on merge too: an agent that doesn't exist is an error.
    const missingAgent = structuredClone(withDecision);
    missingAgent.workflow.edges.push({
      id: 'e3',
      source: { node: 'd', port: 'no' },
      target: { node: 'out' },
      payload: 'text',
      context: { mode: 'full' },
    });
    missingAgent.workflow.nodes.push({
      id: 'a',
      type: 'agent',
      binding: { kind: 'agent', agent: { kind: 'agent', id: 'ghost-zzzzzz', version: 'v1' } },
    } as never);
    missingAgent.workflow.edges.push({
      id: 'e4',
      source: { node: 'in' },
      target: { node: 'a' },
      payload: 'text',
      context: { mode: 'full' },
    });
    await api('PUT', `/api/projects/${id}`, missingAgent);
    const missing = await api<{ problems: { rule: string }[] }>(
      'POST',
      `/api/projects/${id}/merge`,
    );
    expect(missing.status).toBe(400);
    // Both exits now lead to the output, which has two inputs and no join yet.
    expect(missing.body.problems.map((p) => p.rule)).toEqual(['missing-join', 'missing-ref']);

    // An existing agent with no tools needed fixes it.
    const agent = await api<{ entity: { id: string } }>('POST', '/api/agents', {
      ...sampleAgent,
      skills: [],
      tools: [],
    });
    const fixed = structuredClone(missingAgent);
    for (const n of fixed.workflow.nodes as { id: string; binding?: unknown }[]) {
      if (n.id === 'a') {
        n.binding = {
          kind: 'agent',
          agent: { kind: 'agent', id: agent.body.entity.id, version: 'v1' },
        };
      }
    }
    // The output waits for any of its inputs.
    for (const n of fixed.workflow.nodes as { id: string; join?: unknown }[]) {
      if (n.id === 'out') n.join = { mode: 'any' };
    }
    fixed.workflow.edges.push({
      id: 'e5',
      source: { node: 'a' },
      target: { node: 'out' },
      payload: 'text',
      context: { mode: 'full' },
    });
    await api('PUT', `/api/projects/${id}`, fixed);
    const merged = await api<{ version: string }>('POST', `/api/projects/${id}/merge`);
    expect(merged.status).toBe(200);
    expect(merged.body.version).toBe('v2');
  });
});
