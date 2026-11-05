/**
 * M6: cascade preview and propagation (PLAN.md 8.2), deleting referenced entities (8.4), fork
 * housekeeping and restoring the built-in patterns.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUILTIN_PATTERN_IDS,
  defaultAccepted,
  type Agent,
  type CascadeApplyResponse,
  type CascadePreview,
  type DeleteWithReferencesResponse,
  type Project,
  type Template,
} from '@app/schema';
import { sampleAgent, sampleSkill } from '@app/schema/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from './app.js';
import { loadConfig, type AppConfig } from './config.js';

let home: string;
let config: AppConfig;
let built: BuiltApp;
let workspace: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: config.libraryDir, encoding: 'utf8' });
}

async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
) {
  const res = await built.app.inject({
    method,
    url,
    ...(body === undefined ? {} : { payload: body as object }),
  });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

async function ok<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await api<T>(method, url, body);
  if (res.status >= 300)
    throw new Error(`${method} ${url}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

beforeEach(async () => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'app-m6-')));
  config = loadConfig({ APP_HOME: home });
  workspace = join(home, 'workspace');
  mkdirSync(workspace);
  execFileSync('git', ['init', '-q'], { cwd: workspace });
  built = await buildApp(config, { logger: false });
});

afterEach(async () => {
  await built.app.close();
  rmSync(home, { recursive: true, force: true });
});

const ref = <K extends string>(kind: K, id: string, version = 'v1') => ({ kind, id, version });

async function createSkill(name: string): Promise<string> {
  return (await ok<{ entity: { id: string } }>('POST', '/api/skills', { ...sampleSkill, name }))
    .entity.id;
}

async function createAgent(name: string, skills: string[], tools: string[] = []): Promise<string> {
  const body = {
    ...sampleAgent,
    name,
    skills: skills.map((s) => ref('skill', s)),
    tools: tools.map((t) => ref('tool', t)),
  };
  return (await ok<{ entity: { id: string } }>('POST', '/api/agents', body)).entity.id;
}

/** in → one agent node per entry → out, chained. */
function workflow(agents: { node: string; agent: string; version?: string }[]) {
  const ids = ['in', ...agents.map((a) => a.node), 'out'];
  return {
    nodes: [
      { id: 'in', type: 'input', name: 'Task', payloadType: 'text' },
      ...agents.map((a) => ({
        id: a.node,
        type: 'agent',
        binding: { kind: 'agent', agent: ref('agent', a.agent, a.version) },
      })),
      { id: 'out', type: 'output', name: 'Result', payloadType: 'text' },
    ],
    edges: ids.slice(1).map((target, i) => ({
      id: `e${String(i)}`,
      source: { node: ids[i] },
      target: { node: target },
      payload: 'text',
      context: { mode: 'full' },
    })),
  };
}

async function createProject(
  name: string,
  agents: { node: string; agent: string; version?: string }[],
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const body = {
    name,
    workspacePath: workspace,
    overrides,
    workflow: workflow(agents),
    layout: { nodes: {} },
  };
  return (await ok<{ entity: { id: string } }>('POST', '/api/projects', body)).entity.id;
}

/** Change a skill and merge it as its next version. */
async function bumpSkill(id: string, body: string): Promise<void> {
  const skill = await ok<Record<string, unknown>>('GET', `/api/skills/${id}`);
  await ok('PUT', `/api/skills/${id}`, { ...skill, body });
  await ok('POST', `/api/skills/${id}/merge`, { note: 'Better advice' });
}

const preview = (roots: { kind: string; id: string }[]) =>
  ok<CascadePreview>('POST', '/api/cascade/preview', { roots });

const agentPins = (p: Project) =>
  Object.fromEntries(
    p.workflow.nodes.flatMap((n) =>
      n.type === 'agent' && n.binding.kind === 'agent' ? [[n.id, n.binding.agent.version]] : [],
    ),
  );

/** Skill used by two agents in three projects (the M6 done-when). */
async function scenario() {
  const skill = await createSkill('write-tests');
  const a1 = await createAgent('Coder', [skill]);
  const a2 = await createAgent('Tester', [skill]);
  const p1 = await createProject('One', [{ node: 'coder', agent: a1 }], {
    coder: { effort: 'high' },
  });
  const p2 = await createProject('Two', [{ node: 'tester', agent: a2 }]);
  const p3 = await createProject('Three', [
    { node: 'coder', agent: a1 },
    { node: 'tester', agent: a2 },
  ]);
  return { skill, a1, a2, p1, p2, p3 };
}

describe('cascade', () => {
  it('shows the full cascade of a skill used by two agents in three projects', async () => {
    const { skill, a1, a2, p1, p2, p3 } = await scenario();
    await bumpSkill(skill, '# v2');
    const result = await preview([{ kind: 'skill', id: skill }]);

    expect(result.roots).toEqual([`skill/${skill}`]);
    const cases = result.cases.map((c) => `${c.referrer}:${c.location} ${c.from}→${c.to}`).sort();
    expect(cases).toEqual(
      [
        `agent/${a1}:skills/0 v1→v2`,
        `agent/${a2}:skills/0 v1→v2`,
        `project/${p1}:node/coder v1→v2`,
        `project/${p2}:node/tester v1→v2`,
        `project/${p3}:node/coder v1→v2`,
        `project/${p3}:node/tester v1→v2`,
      ].sort(),
    );
    const projectCase = result.cases.find((c) => c.referrer === `project/${p1}`);
    expect(projectCase).toMatchObject({ target: `agent/${a1}`, label: 'Node “Coder”' });
    expect(result.entities.find((e) => e.key === `agent/${a1}`)).toMatchObject({
      version: 'v1',
      next: 'v2',
      problems: [],
    });
  });

  it('produces the expected pinned versions for each choice, keeping overrides', async () => {
    const { skill, a1, a2, p1, p2, p3 } = await scenario();
    await bumpSkill(skill, '# v2');
    const { cases } = await preview([{ kind: 'skill', id: skill }]);
    const id = (referrer: string, location: string) =>
      cases.find((c) => c.referrer === referrer && c.location === location)?.id ?? '';
    // Both agents move; project Two declines; project Three takes only the Coder.
    const accept = [
      id(`agent/${a1}`, 'skills/0'),
      id(`agent/${a2}`, 'skills/0'),
      id(`project/${p1}`, 'node/coder'),
      id(`project/${p3}`, 'node/coder'),
    ];
    const applied = await ok<CascadeApplyResponse>('POST', '/api/cascade/apply', {
      roots: [{ kind: 'skill', id: skill }],
      accept,
    });
    expect(applied.updated.map((u) => `${u.kind}/${u.id}@${u.version}`).sort()).toEqual(
      [`agent/${a1}@v2`, `agent/${a2}@v2`, `project/${p1}@v2`, `project/${p3}@v2`].sort(),
    );

    for (const a of [a1, a2]) {
      expect((await ok<Agent>('GET', `/api/agents/${a}`)).skills[0]?.version).toBe('v2');
      expect((await ok<Agent>('GET', `/api/agents/${a}?ref=v1`)).skills[0]?.version).toBe('v1');
    }
    const one = await ok<Project>('GET', `/api/projects/${p1}`);
    expect(agentPins(one)).toEqual({ coder: 'v2' });
    expect(one.overrides).toEqual({ coder: { effort: 'high' } });
    expect(agentPins(await ok<Project>('GET', `/api/projects/${p2}`))).toEqual({ tester: 'v1' });
    expect(agentPins(await ok<Project>('GET', `/api/projects/${p3}`))).toEqual({
      coder: 'v2',
      tester: 'v1',
    });
    // The new version says why, in the history.
    const history = await ok<{ versions: { version: string; note?: string }[] }>(
      'GET',
      `/api/agents/${a1}/history`,
    );
    expect(history.versions[0]).toMatchObject({ version: 'v2', note: 'Uses skill write-tests v2' });
    expect(git('status', '--porcelain').trim()).toBe('');

    // Nothing left but Two's and Three's Tester: still offered.
    const again = await preview([{ kind: 'agent', id: a2 }]);
    expect(again.cases.map((c) => c.referrer).sort()).toEqual(
      [`project/${p2}`, `project/${p3}`].sort(),
    );
  });

  it('refuses updates whose target was declined', async () => {
    const { skill, a1, p1 } = await scenario();
    await bumpSkill(skill, '# v2');
    const { cases } = await preview([{ kind: 'skill', id: skill }]);
    const projectCase = cases.find((c) => c.referrer === `project/${p1}`);
    const res = await api('POST', '/api/cascade/apply', {
      roots: [{ kind: 'skill', id: skill }],
      accept: [projectCase?.id],
    });
    expect(res.status).toBe(400);
    expect((await ok<Agent>('GET', `/api/agents/${a1}`)).skills[0]?.version).toBe('v1');
  });

  it('lists forks unchecked and updates the fork branch when accepted', async () => {
    const { skill, a1, p1 } = await scenario();
    const branch = `fork-${p1}-coder`;
    await ok('POST', `/api/agents/${a1}/branches`, { name: branch, from: 'v1' });
    const project = await ok<Project>('GET', `/api/projects/${p1}`);
    await ok('PUT', `/api/projects/${p1}`, {
      ...project,
      workflow: workflow([{ node: 'coder', agent: a1, version: branch }]),
    });
    await ok('POST', `/api/projects/${p1}/merge`);
    await bumpSkill(skill, '# v2');

    const result = await preview([{ kind: 'skill', id: skill }]);
    const forkCase = result.cases.find((c) => c.fork === 'in-fork');
    expect(forkCase).toMatchObject({ referrer: `agent/${a1}#${branch}`, from: 'v1', to: 'v2' });
    expect(defaultAccepted(result).has(forkCase?.id ?? '')).toBe(false);
    // The project pins the fork: moving it to the agent's new main version would drop the
    // customization, so that is offered but not checked either.
    const pinsFork = result.cases.find((c) => c.referrer === `project/${p1}`);
    expect(pinsFork).toMatchObject({ fork: 'pins-fork', from: branch, to: 'v2' });
    expect(defaultAccepted(result).has(pinsFork?.id ?? '')).toBe(false);

    await ok('POST', '/api/cascade/apply', {
      roots: [{ kind: 'skill', id: skill }],
      accept: [forkCase?.id],
    });
    expect((await ok<Agent>('GET', `/api/agents/${a1}?ref=${branch}`)).skills[0]?.version).toBe(
      'v2',
    );
    expect((await ok<Agent>('GET', `/api/agents/${a1}`)).skills[0]?.version).toBe('v1');
  });

  it('applies the update to a draft too, so merging it later is no conflict', async () => {
    const { skill, a2 } = await scenario();
    const agent = await ok<Agent>('GET', `/api/agents/${a2}`);
    await ok('PUT', `/api/agents/${a2}`, { ...agent, description: 'Draft work' });
    await bumpSkill(skill, '# v2');
    const { cases } = await preview([{ kind: 'skill', id: skill }]);
    const c = cases.find((x) => x.referrer === `agent/${a2}`);
    await ok('POST', '/api/cascade/apply', {
      roots: [{ kind: 'skill', id: skill }],
      accept: [c?.id],
    });

    const draft = await ok<Agent>('GET', `/api/agents/${a2}?ref=draft`);
    expect(draft).toMatchObject({ description: 'Draft work', skills: [{ version: 'v2' }] });
    const merged = await ok<{ version: string; entity: Agent }>('POST', `/api/agents/${a2}/merge`);
    expect(merged.version).toBe('v3');
    expect(merged.entity).toMatchObject({ description: 'Draft work', skills: [{ version: 'v2' }] });
  });

  it('flags and refuses updates that would add errors', async () => {
    const write = await ok<{ entity: { id: string } }>('POST', '/api/tools', {
      name: 'Write src',
      builtin: 'write_file',
      scope: { paths: ['src/**'] },
    });
    const agent = await createAgent('Writer', [], [write.entity.id]);
    const body = {
      name: 'Writes',
      workspacePath: workspace,
      overrides: {},
      workflow: {
        nodes: [
          { id: 'in', type: 'input', name: 'Task', payloadType: 'text' },
          { id: 'w', type: 'agent', binding: { kind: 'agent', agent: ref('agent', agent) } },
          { id: 'f', type: 'artifact', path: 'src/x.ts', fileType: 'code' },
          { id: 'out', type: 'output', name: 'Result', payloadType: 'file' },
        ],
        edges: [
          {
            id: 'e1',
            source: { node: 'in' },
            target: { node: 'w' },
            payload: 'text',
            context: { mode: 'full' },
          },
          {
            id: 'e2',
            source: { node: 'w' },
            target: { node: 'f' },
            payload: 'text',
            context: { mode: 'full' },
          },
          {
            id: 'e3',
            source: { node: 'f' },
            target: { node: 'out' },
            payload: 'file',
            context: { mode: 'full' },
          },
        ],
      },
      layout: { nodes: {} },
    };
    const project = (await ok<{ entity: { id: string } }>('POST', '/api/projects', body)).entity.id;
    const a = await ok<Agent>('GET', `/api/agents/${agent}`);
    await ok('PUT', `/api/agents/${agent}`, { ...a, tools: [] });
    await ok('POST', `/api/agents/${agent}/merge`);

    const result = await preview([{ kind: 'agent', id: agent }]);
    const entity = result.entities.find((e) => e.key === `project/${project}`);
    expect(entity?.problems.map((p) => p.rule)).toEqual(['write-not-covered']);
    const res = await api<{ error: string }>('POST', '/api/cascade/apply', {
      roots: [{ kind: 'agent', id: agent }],
      accept: result.cases.map((c) => c.id),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('workflow');
  });
});

describe('deleting referenced entities', () => {
  it('keeps local copies or placeholders, as chosen per referrer', async () => {
    const { skill, a1, a2, p1 } = await scenario();
    expect((await api('DELETE', `/api/skills/${skill}`)).status).toBe(409);
    expect((await api('POST', `/api/skills/${skill}/delete`, {})).status).toBe(400);

    const res = await ok<DeleteWithReferencesResponse>('POST', `/api/skills/${skill}/delete`, {
      all: 'placeholder',
      each: { [`agent/${a1}`]: 'copy' },
    });
    expect(res.updated.map((u) => `${u.id}@${u.version}`).sort()).toEqual(
      [`${a1}@v2`, `${a2}@v2`].sort(),
    );
    expect((await api('GET', `/api/skills/${skill}`)).status).toBe(404);

    const copied = await ok<Agent>('GET', `/api/agents/${a1}`);
    expect(copied.skills).toEqual([ref('skill', skill)]);
    expect(copied.localCopies?.[`skill/${skill}@v1`]).toMatchObject({
      kind: 'skill',
      entity: { name: 'write-tests', body: sampleSkill.body },
    });
    const placeholder = await ok<Agent>('GET', `/api/agents/${a2}`);
    expect(placeholder.deletedRefs).toEqual({ [`skill/${skill}@v1`]: { name: 'write-tests' } });
    expect(git('show', `main:agents/${a1}.yaml`)).toContain('localCopies:');

    // An agent pinning a deleted skill without a copy can't be merged; with a copy it can.
    await ok('PUT', `/api/agents/${a2}`, { ...placeholder, description: 'x' });
    const refused = await api<{ message: string }>('POST', `/api/agents/${a2}/merge`);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('“write-tests”');
    await ok('PUT', `/api/agents/${a1}`, { ...copied, description: 'x' });
    expect((await api('POST', `/api/agents/${a1}/merge`)).status).toBe(200);

    // The projects pinning the agents' older versions are offered the new ones.
    const cascade = await preview(res.updated.map((u) => ({ kind: u.kind, id: u.id })));
    expect(cascade.cases.some((c) => c.referrer === `project/${p1}`)).toBe(true);
  });

  it('keeps workflows working with a local copy of a deleted agent', async () => {
    const { a2, p2 } = await scenario();
    await ok('POST', `/api/agents/${a2}/delete`, { all: 'copy' });
    const project = await ok<Project>('GET', `/api/projects/${p2}`);
    expect(Object.keys(project.localCopies ?? {}).sort()).toEqual([`agent/${a2}@v1`].sort());
    // Merging needs every reference resolved: the copy does it.
    await ok('PUT', `/api/projects/${p2}`, { ...project, description: 'still works' });
    expect((await api('POST', `/api/projects/${p2}/merge`)).status).toBe(200);
    // Unused copies are dropped on save.
    const other = await createAgent('Other', []);
    await ok('PUT', `/api/projects/${p2}`, {
      ...project,
      workflow: workflow([{ node: 'tester', agent: other }]),
    });
    expect((await ok<Project>('GET', `/api/projects/${p2}?ref=draft`)).localCopies).toBeUndefined();
  });

  it('deletes without asking when only a draft pins the entity', async () => {
    const skill = await createSkill('lonely');
    const agent = await createAgent('Drafty', []);
    const a = await ok<Agent>('GET', `/api/agents/${agent}`);
    await ok('PUT', `/api/agents/${agent}`, { ...a, skills: [ref('skill', skill)] });
    expect((await api('DELETE', `/api/skills/${skill}`)).status).toBe(200);
  });
});

describe('forks', () => {
  it('deletes a project’s fork once the project no longer pins it', async () => {
    const skill = await createSkill('s');
    const agent = await createAgent('Coder', [skill]);
    const p = await createProject('P', [{ node: 'coder', agent }]);
    const branch = `fork-${p}-coder`;
    await ok('POST', `/api/agents/${agent}/branches`, { name: branch, from: 'v1' });
    const project = await ok<Project>('GET', `/api/projects/${p}`);
    await ok('PUT', `/api/projects/${p}`, {
      ...project,
      workflow: workflow([{ node: 'coder', agent, version: branch }]),
    });
    expect(git('branch', '--list', `agent/${agent}/${branch}`).trim()).not.toBe('');

    // A template made from it gets its own copy of the fork.
    const saved = await ok<Project>('GET', `/api/projects/${p}?ref=draft`);
    const template = await ok<{ entity: Template }>('POST', '/api/templates', {
      name: 'T',
      workflow: saved.workflow,
      layout: saved.layout,
    });
    const tid = template.entity.id;
    const pinned = template.entity.workflow.nodes.find((n) => n.id === 'coder');
    expect(
      pinned?.type === 'agent' && pinned.binding.kind === 'agent' && pinned.binding.agent.version,
    ).toBe(`fork-${tid}-coder`);

    // Use library version: the project's fork goes, the template's stays.
    await ok('PUT', `/api/projects/${p}`, { ...project, description: 'back to main' });
    expect(git('branch', '--list', `agent/${agent}/${branch}`).trim()).toBe('');
    expect(git('branch', '--list', `agent/${agent}/fork-${tid}-coder`).trim()).not.toBe('');

    // Deleting the template deletes its fork.
    await ok('DELETE', `/api/templates/${tid}`);
    expect(git('branch', '--list', `agent/${agent}/fork-${tid}-coder`).trim()).toBe('');
  });
});

describe('restore defaults', () => {
  it('adds back deleted built-in patterns as their next version', async () => {
    const id = BUILTIN_PATTERN_IDS.makerChecker;
    await ok('DELETE', `/api/patterns/${id}`);
    const res = await ok<{ restored: { id: string; version: string }[] }>(
      'POST',
      '/api/settings/restore-defaults',
    );
    expect(res.restored).toEqual([{ id, name: 'Maker-checker', version: 'v2' }]);
    expect((await api('GET', `/api/patterns/${id}`)).status).toBe(200);
    const again = await ok<{ restored: unknown[] }>('POST', '/api/settings/restore-defaults');
    expect(again.restored).toEqual([]);
  });
});
