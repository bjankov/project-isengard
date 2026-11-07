import { describe, expect, it } from 'vitest';
import {
  Agent,
  BUILTIN_PATTERNS,
  DEMO_IDS,
  Project,
  Skill,
  ToolPreset,
  checkWorkflow,
  collectRefs,
  demoContent,
  repinAll,
  type WorkflowResolver,
} from './index.js';

const demo = demoContent('/home/me/.app/demo-workspace');

const resolver: WorkflowResolver = {
  agent: (r) => demo.agents.find((a) => a.id === r.id) ?? null,
  tool: (r) => demo.tools.find((t) => t.id === r.id) ?? null,
  pattern: (r) => BUILTIN_PATTERNS.find((p) => p.id === r.id) ?? null,
};

describe('demo content (PLAN.md 9.6)', () => {
  it('is valid against the schema', () => {
    for (const s of demo.skills) expect(() => Skill.parse(s)).not.toThrow();
    for (const t of demo.tools) expect(() => ToolPreset.parse(t)).not.toThrow();
    for (const a of demo.agents) expect(() => Agent.parse(a)).not.toThrow();
    for (const p of demo.projects) expect(() => Project.parse(p)).not.toThrow();
  });

  it('has the agents PLAN.md names, and both example projects', () => {
    expect(demo.agents.map((a) => a.name)).toEqual(
      expect.arrayContaining(['Planner', 'Executor', 'Tester', 'Reviewer', 'Router']),
    );
    expect(demo.projects.map((p) => p.id)).toEqual(Object.values(DEMO_IDS.projects));
  });

  it('only references demo entities and built-in patterns', () => {
    const known = new Set([
      ...demo.skills.map((s) => s.id),
      ...demo.tools.map((t) => t.id),
      ...demo.agents.map((a) => a.id),
      ...BUILTIN_PATTERNS.map((p) => p.id),
    ]);
    const refs = [
      ...demo.agents.flatMap((a) => collectRefs('agent', a)),
      ...demo.projects.flatMap((p) => collectRefs('project', p)),
    ];
    for (const r of refs) expect(known, `${r.kind} ${r.id}`).toContain(r.id);
  });

  it('example projects have no errors or warnings', () => {
    for (const p of demo.projects) {
      const { problems } = checkWorkflow(p.workflow, { kind: 'workflow', resolver });
      expect(problems.map((x) => `${p.name}: ${x.message}`)).toEqual([]);
    }
  });

  it('every node has a position', () => {
    for (const p of demo.projects) {
      for (const n of p.workflow.nodes) expect(p.layout.nodes[n.id], n.id).toBeDefined();
    }
  });

  it('repinAll re-pins only the references it is given a version for', () => {
    const [project] = demo.projects.slice(1);
    if (!project) throw new Error('missing project');
    const pinned = repinAll('project', project, (r) =>
      r.kind === 'pattern' ? 'v4' : r.id === DEMO_IDS.agents.router ? 'v2' : undefined,
    );
    const versions = Object.fromEntries(
      collectRefs('project', pinned).map((r) => [r.id, r.version]),
    );
    expect(versions[DEMO_IDS.agents.router]).toBe('v2');
    expect(versions[DEMO_IDS.agents.executor]).toBe('v1');
    expect(Object.entries(versions).find(([id]) => id.endsWith('builtn'))?.[1]).toBe('v4');
    // The input is left alone.
    expect(collectRefs('project', project).every((r) => r.version === 'v1')).toBe(true);
  });
});
