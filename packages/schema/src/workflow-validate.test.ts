import { describe, expect, it } from 'vitest';
import {
  type Agent,
  type ToolPreset,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowResolver,
  WorkflowGraph,
  analyzeLoops,
  applyFix,
  createNode,
  defaultExits,
  globCovers,
  hasBlockingProblems,
  joinInputs,
  traceOrigin,
  validateWorkflow,
  withEvaluator,
} from './index.js';
import { sampleProject } from './testing.js';

const demo = WorkflowGraph.parse(sampleProject.workflow);

const defaults = {
  model: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
  effort: 'medium' as const,
  limits: { maxIterations: 20, maxTokens: 200_000, maxWallTimeSeconds: 600 },
};
const preset = (id: string, p: Omit<ToolPreset, 'id' | 'description'>): ToolPreset =>
  ({ id, description: '', ...p }) as ToolPreset;
const tools: Record<string, ToolPreset> = {
  'read-src-aaaaaa': preset('read-src-aaaaaa', {
    name: 'Read src',
    builtin: 'read_file',
    scope: { paths: ['src/**'] },
  }),
  'write-docs-aaaaaa': preset('write-docs-aaaaaa', {
    name: 'Write docs',
    builtin: 'write_file',
    scope: { paths: ['PLAN.md', 'docs/**'] },
  }),
  'shell-any-aaaaaa': preset('shell-any-aaaaaa', {
    name: 'Any shell',
    builtin: 'shell',
    scope: { commands: [] },
  }),
};
const agent = (id: string, name: string, toolIds: string[]): Agent => ({
  id,
  name,
  description: '',
  prompt: '',
  skills: [],
  tools: toolIds.map((t) => ({ kind: 'tool', id: t, version: 'v1' })),
  defaults,
});
const agents: Record<string, Agent> = {
  'planner-dddddd': agent('planner-dddddd', 'Planner', ['write-docs-aaaaaa']),
  'executor-eeeeee': agent('executor-eeeeee', 'Executor', ['read-src-aaaaaa']),
};
const resolver: WorkflowResolver = {
  agent: (ref) => agents[ref.id] ?? null,
  tool: (ref) => tools[ref.id] ?? null,
};

/** The demo with the tool step's preset known. */
const demoResolver: WorkflowResolver = {
  ...resolver,
  tool: (ref) =>
    ref.id === 'run-tests-cccccc'
      ? preset('run-tests-cccccc', {
          name: 'Run tests',
          builtin: 'shell',
          scope: { commands: [{ match: 'exact', command: 'npm test' }] },
        })
      : resolver.tool(ref),
};

const edge = (id: string, source: string, target: string, extra: Partial<WorkflowEdge> = {}) =>
  ({
    id,
    source: { node: source },
    target: { node: target },
    payload: 'text',
    context: { mode: 'full' },
    ...extra,
  }) as WorkflowEdge;

const rules = (g: WorkflowGraph, r?: WorkflowResolver) => validateWorkflow(g, r).map((p) => p.rule);

const mapNodes = (g: WorkflowGraph, fn: (n: WorkflowNode) => WorkflowNode): WorkflowGraph => ({
  ...g,
  nodes: g.nodes.map(fn),
});
const exitCap = (g: WorkflowGraph, max: number | undefined) =>
  mapNodes(g, (n) =>
    n.type === 'decision'
      ? { ...n, exits: n.exits.map((x) => (x.id === 'no' ? { ...x, maxIterations: max } : x)) }
      : n,
  );

describe('globCovers', () => {
  it('matches literal paths against globs', () => {
    expect(globCovers('src/**', 'src/a/b.ts')).toBe(true);
    expect(globCovers('src/**', 'test/a.ts')).toBe(false);
    expect(globCovers('*.md', 'PLAN.md')).toBe(true);
    expect(globCovers('./PLAN.md', 'PLAN.md')).toBe(true);
  });

  it('covers glob targets only when containment is clear', () => {
    expect(globCovers('src/**', 'src/**')).toBe(true);
    expect(globCovers('**', 'anything/**/*.ts')).toBe(true);
    expect(globCovers('src/**', 'src/api/**/*.ts')).toBe(true);
    expect(globCovers('src/*.ts', 'src/**')).toBe(false);
    expect(globCovers('**/*.ts', 'src/*.ts')).toBe(false);
  });
});

describe('loops', () => {
  it('counts the demo retry loop as capped by its decision exit', () => {
    const loops = analyzeLoops(demo);
    expect([...loops.capEdges]).toEqual(['e7']);
    expect(loops.uncapped).toEqual([]);
    expect(rules(demo)).not.toContain('uncapped-loop');
  });

  it('blocks saving when the loop’s exit has no cap, and the fix caps it', () => {
    const g = exitCap(demo, undefined);
    const problems = validateWorkflow(g);
    const loop = problems.find((p) => p.rule === 'uncapped-loop');
    expect(loop).toMatchObject({ blocksSave: true, severity: 'error', edges: ['e7', 'e4', 'e5'] });
    expect(loop?.message).toMatch(/Max loops on the “fail” exit/);
    expect(hasBlockingProblems(problems)).toBe(true);
    const fixed = applyFix(g, loop!.fix!);
    expect(rules(fixed)).not.toContain('uncapped-loop');
  });

  it('refuses a loop without a decision', () => {
    const g: WorkflowGraph = {
      ...demo,
      edges: [...demo.edges, edge('back', 'tests', 'executor')],
    };
    const loop = validateWorkflow(g).find((p) => p.rule === 'uncapped-loop');
    expect(loop?.message).toMatch(/no decision/);
    expect(loop?.edges[0]).toBe('back');
    expect(loop?.fix).toBeUndefined();
  });

  it('accepts a loop closed by an agent → agent edge when an exit inside it is capped', () => {
    // Supervisor shape: sup → ◇delegate◇ → worker → back to sup.
    const g: WorkflowGraph = {
      nodes: [
        createNode('input', 'in'),
        createNode('agent', 'sup', {
          agent: { kind: 'agent', id: 'planner-dddddd', version: 'v1' },
        }),
        {
          ...createNode('decision', 'd'),
          exits: [
            { id: 'pass', label: 'delegate', maxIterations: 5 },
            { id: 'fail', label: 'done' },
          ],
        } as WorkflowNode,
        createNode('agent', 'worker', {
          agent: { kind: 'agent', id: 'executor-eeeeee', version: 'v1' },
        }),
        createNode('output', 'out'),
      ],
      edges: [
        edge('e1', 'in', 'sup'),
        edge('e2', 'sup', 'd'),
        { ...edge('e3', 'd', 'worker'), source: { node: 'd', port: 'pass' } },
        edge('e4', 'worker', 'sup'),
        { ...edge('e5', 'd', 'out'), source: { node: 'd', port: 'fail' } },
      ],
    };
    const loops = analyzeLoops(g);
    expect([...loops.backEdges]).toEqual(['e4']);
    expect([...loops.capEdges]).toEqual(['e3']);
    expect(rules(g)).not.toContain('uncapped-loop');
    // The loop's way back doesn't count as a second input of the supervisor.
    expect(joinInputs(g, 'sup', loops).map((e) => e.id)).toEqual(['e1']);
  });
});

describe('joins', () => {
  const twoIn: WorkflowGraph = {
    ...demo,
    nodes: demo.nodes.map((n) => (n.id === 'executor' ? { ...n, join: undefined } : n)),
    edges: [...demo.edges, edge('extra', 'in', 'executor')],
  };

  it('does not count loop back-edges as inputs', () => {
    const noJoin = mapNodes(demo, (n) => (n.id === 'executor' ? { ...n, join: undefined } : n));
    expect(joinInputs(noJoin, 'executor').map((e) => e.id)).toEqual(['e3']);
    expect(rules(noJoin)).not.toContain('missing-join');
  });

  it('requires a join mode for two inputs, with a fix', () => {
    const p = validateWorkflow(twoIn).find((x) => x.rule === 'missing-join');
    expect(p).toMatchObject({ severity: 'error', blocksSave: false, nodes: ['executor'] });
    const fixed = applyFix(twoIn, p!.fix!);
    expect(fixed.nodes.find((n) => n.id === 'executor')?.join).toEqual({ mode: 'all' });
    expect(rules(fixed)).not.toContain('missing-join');
  });

  it('rejects n-of-m with more than the inputs', () => {
    const g = mapNodes(twoIn, (n) =>
      n.id === 'executor' ? { ...n, join: { mode: 'n-of-m', n: 3 } } : n,
    );
    expect(rules(g)).toContain('join-too-large');
  });

  it('never needs a join for shared stores or reads from them', () => {
    const g: WorkflowGraph = {
      nodes: [
        createNode('input', 'in'),
        createNode('agent', 'a', { agent: { kind: 'agent', id: 'planner-dddddd', version: 'v1' } }),
        createNode('agent', 'b', { agent: { kind: 'agent', id: 'planner-dddddd', version: 'v1' } }),
        createNode('sharedStore', 's'),
      ],
      edges: [
        edge('e1', 'in', 'a'),
        edge('e2', 'in', 'b'),
        edge('e3', 'a', 's', { access: 'write' }),
        edge('e4', 'b', 's', { access: 'write' }),
        edge('e5', 's', 'a', { access: 'read' }),
      ],
    };
    expect(rules(g)).not.toContain('missing-join');
  });
});

describe('decisions', () => {
  it('flags missing and unconnected exits', () => {
    const noExits = mapNodes(demo, (n) => (n.type === 'decision' ? { ...n, exits: [] } : n));
    expect(rules(noExits)).toContain('no-exits');
    const dangling = { ...demo, edges: demo.edges.filter((e) => e.id !== 'e6') };
    const p = validateWorkflow(dangling).find((x) => x.rule === 'exit-unconnected');
    expect(p?.message).toMatch(/“pass” exit/);
  });

  it('flags an exhausted exit that points at a missing exit', () => {
    const g = mapNodes(demo, (n) =>
      n.type === 'decision'
        ? {
            ...n,
            exits: n.exits.map((x) =>
              x.id === 'no' ? { ...x, onExhausted: { action: 'exit', exit: 'gone' } } : x,
            ),
          }
        : n,
    );
    expect(rules(g)).toContain('exhausted-exit');
  });

  it('warns about an evaluator without code', () => {
    const g = mapNodes(demo, (n) =>
      n.type === 'decision' ? { ...n, evaluator: { ...n.evaluator, code: '' } as never } : n,
    );
    expect(validateWorkflow(g).find((p) => p.rule === 'evaluator-incomplete')?.severity).toBe(
      'warning',
    );
  });

  it('swaps untouched default exits when the evaluator changes', () => {
    const fresh = createNode('decision', 'd') as Extract<WorkflowNode, { type: 'decision' }>;
    const g: WorkflowGraph = { nodes: [fresh], edges: [] };
    const human = withEvaluator(g, fresh, {
      type: 'human',
      instructions: '',
      allowFeedback: true,
    });
    expect(human.exits).toEqual(defaultExits('human'));
    const edited = { ...fresh, exits: [{ id: 'ok', label: 'ok' }] };
    expect(
      withEvaluator(g, edited, { type: 'human', instructions: '', allowFeedback: true }).exits,
    ).toEqual(edited.exits);
  });
});

describe('reachability and inputs', () => {
  it('warns about nodes unreachable from an input', () => {
    const g = { ...demo, edges: demo.edges.filter((e) => e.id !== 'e1') };
    const unreachable = validateWorkflow(g).filter((p) => p.rule === 'unreachable');
    expect(unreachable.map((p) => p.nodes[0])).toContain('planner');
    expect(unreachable.every((p) => p.severity === 'warning')).toBe(true);
    expect(unreachable.map((p) => p.nodes[0])).not.toContain('note');
  });

  it('requires an input', () => {
    const g = { nodes: demo.nodes.filter((n) => n.type !== 'input'), edges: [] };
    expect(rules(g)).toContain('no-input');
  });
});

describe('library rules', () => {
  it('passes the demo workflow with matching tools', () => {
    const problems = validateWorkflow(demo, demoResolver).filter((p) => p.severity === 'error');
    expect(problems).toEqual([]);
  });

  it('skips library rules for entities that are not loaded yet', () => {
    expect(rules(demo, { agent: () => undefined, tool: () => undefined })).toEqual([]);
  });

  it('flags a write without a covering write tool', () => {
    const g = mapNodes(demo, (n) => (n.type === 'artifact' ? { ...n, path: 'README.md' } : n));
    const p = validateWorkflow(g, demoResolver).find((x) => x.rule === 'write-not-covered');
    expect(p?.message).toMatch(/Planner writes README.md/);
    expect(p?.message).toMatch(/PLAN.md, docs\/\*\*/);
  });

  it('flags references without a covering read tool, and references to non-files', () => {
    const asRef = (target: string) =>
      ({
        ...demo,
        edges: demo.edges.map((e) =>
          e.id === target ? { ...e, context: { mode: 'reference' } } : e,
        ),
      }) as WorkflowGraph;
    // PLAN.md → Executor, who can only read src/**.
    const p = validateWorkflow(asRef('e3'), demoResolver).find(
      (x) => x.rule === 'reference-not-covered',
    );
    expect(p?.message).toMatch(/Executor gets PLAN.md by reference/);
    // Task text → Planner.
    expect(rules(asRef('e1'), demoResolver)).toContain('reference-not-file');
  });

  it('flags missing references and unrestricted shells', () => {
    const g = mapNodes(demo, (n) =>
      n.id === 'tests' && n.type === 'toolStep'
        ? { ...n, tool: { kind: 'tool', id: 'shell-any-aaaaaa', version: 'v1' } }
        : n.id === 'planner' && n.type === 'agent'
          ? {
              ...n,
              binding: {
                kind: 'agent',
                agent: { kind: 'agent', id: 'gone-zzzzzz', version: 'v1' },
              },
            }
          : n,
    );
    const problems = validateWorkflow(g, demoResolver);
    expect(problems.find((p) => p.rule === 'missing-ref')?.nodes).toEqual(['planner']);
    expect(problems.find((p) => p.rule === 'unrestricted-shell')).toMatchObject({
      severity: 'warning',
      nodes: ['tests'],
    });
  });
});

describe('traceOrigin', () => {
  it('follows decisions back to the content they pass through', () => {
    const e7 = demo.edges.find((e) => e.id === 'e7')!;
    expect(traceOrigin(demo, e7)?.id).toBe('tests');
  });
});
