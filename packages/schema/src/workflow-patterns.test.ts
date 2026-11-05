import { describe, expect, it } from 'vitest';
import {
  type Agent,
  type Pattern,
  type PatternRef,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowResolver,
  BUILTIN_PATTERNS,
  BUILTIN_PATTERN_IDS,
  NodePath,
  Pattern as PatternSchema,
  applyFix,
  canConnect,
  checkWorkflow,
  createPatternNode,
  expandRepeats,
  flattenWorkflow,
  joinInputs,
  listSlots,
  patternPorts,
} from './index.js';

const byId = new Map(BUILTIN_PATTERNS.map((p) => [p.id, p]));
const lookup = (ref: PatternRef): Pattern | null => byId.get(ref.id) ?? null;
const builtin = (key: keyof typeof BUILTIN_PATTERN_IDS): Pattern => {
  const p = byId.get(BUILTIN_PATTERN_IDS[key]);
  if (!p) throw new Error(key);
  return p;
};
const ref = (p: Pattern): PatternRef => ({ kind: 'pattern', id: p.id, version: 'v1' });

const agent = (id: string): Agent => ({
  id,
  name: id.split('-')[0] ?? id,
  description: '',
  prompt: '',
  skills: [],
  tools: [],
  defaults: {
    model: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    effort: 'medium',
    limits: { maxIterations: 20, maxTokens: 200_000, maxWallTimeSeconds: 600 },
  },
});
const resolver: WorkflowResolver = {
  agent: (r) => agent(r.id),
  tool: () => null,
  pattern: lookup,
};
const bound = (id: string) =>
  ({ kind: 'agent', agent: { kind: 'agent', id, version: 'v1' } }) as const;

const edge = (
  id: string,
  source: string,
  target: string,
  ports: { from?: string; to?: string } = {},
): WorkflowEdge => ({
  id,
  source: ports.from ? { node: source, port: ports.from } : { node: source },
  target: ports.to ? { node: target, port: ports.to } : { node: target },
  payload: 'text',
  context: { mode: 'full' },
});

const input: WorkflowNode = {
  id: 'task',
  type: 'input',
  name: 'Task',
  payloadType: 'text',
  content: '',
  files: [],
};
const output: WorkflowNode = { id: 'done', type: 'output', name: 'Done', payloadType: 'text' };

/** Task → Maker-checker instance → Done, with both slots bound. */
function makerCheckerWorkflow(
  bindings = { maker: bound('exec-aaaaaa'), checker: bound('review-aaaaaa') },
) {
  const mc = builtin('makerChecker');
  return {
    nodes: [input, createPatternNode('mc', ref(mc), bindings), output],
    edges: [edge('e1', 'task', 'mc', { to: 'in' }), edge('e2', 'mc', 'done', { from: 'out' })],
  } satisfies WorkflowGraph;
}

const rules = (g: WorkflowGraph, r: WorkflowResolver = resolver) =>
  checkWorkflow(g, { resolver: r }).problems.map((p) => p.rule);

describe('built-in patterns', () => {
  it('are the 10 patterns of PLAN.md 10, valid against the schema', () => {
    expect(BUILTIN_PATTERNS).toHaveLength(10);
    for (const p of BUILTIN_PATTERNS) expect(() => PatternSchema.parse(p)).not.toThrow();
  });

  it('have no errors or warnings as patterns', () => {
    for (const p of BUILTIN_PATTERNS) {
      const { problems } = checkWorkflow(p.workflow, {
        kind: 'pattern',
        resolver,
        repeat: p.repeat,
        selfId: p.id,
      });
      expect(problems.map((x) => `${p.name}: ${x.message}`)).toEqual([]);
    }
  });

  it('are error-free in a workflow once every slot is bound, at several sizes', () => {
    for (const p of BUILTIN_PATTERNS) {
      for (const n of [1, 3]) {
        const repeat = Object.fromEntries(p.repeat.map((g) => [g.id, n]));
        const slots = listSlots(p, repeat, lookup) ?? [];
        const bindings = Object.fromEntries(
          slots.map((s, i) => [s.key, bound(`a${String(i)}-aaaaaa`)]),
        );
        const { inputs, outputs } = patternPorts(p);
        const g: WorkflowGraph = {
          nodes: [input, createPatternNode('p', ref(p), bindings, repeat), output],
          edges: [
            ...inputs.map((port, i) => edge(`in${String(i)}`, 'task', 'p', { to: port.id })),
            ...outputs.map((port, i) => edge(`out${String(i)}`, 'p', 'done', { from: port.id })),
          ],
        };
        const errors = checkWorkflow(g, { resolver }).problems.filter(
          (x) => x.severity === 'error',
        );
        expect(errors.map((x) => `${p.name} ×${String(n)}: ${x.message}`)).toEqual([]);
      }
    }
  });
});

describe('repeat groups', () => {
  it('copies parallel members, connecting each to the group’s neighbours', () => {
    const g = expandRepeats(builtin('fanOut'), { workers: 3 });
    expect(g.nodes.map((n) => n.id)).toEqual([
      'in',
      'worker@1',
      'worker@2',
      'worker@3',
      'aggregator',
      'out',
    ]);
    expect(joinInputs(g, 'aggregator')).toHaveLength(3);
    const roles = g.nodes.flatMap((n) =>
      n.type === 'agent' && n.binding.kind === 'slot' ? [n.binding.role] : [],
    );
    expect(roles).toEqual(['Worker 1', 'Worker 2', 'Worker 3', 'Aggregator']);
  });

  it('splits a decision exit leading into the group into one exit per copy, keeping its cap', () => {
    const g = expandRepeats(builtin('supervisor'), { workers: 2 });
    const delegate = g.nodes.find((n) => n.id === 'delegate');
    expect(delegate?.type === 'decision' && delegate.exits).toEqual([
      { id: 'worker@1', label: 'Worker 1', maxIterations: 5 },
      { id: 'worker@2', label: 'Worker 2', maxIterations: 5 },
      { id: 'done', label: 'done' },
    ]);
    expect(
      g.edges
        .filter((e) => e.source.node === 'delegate')
        .map((e) => [e.source.port, e.target.node]),
    ).toEqual([
      ['worker@1', 'worker@1'],
      ['worker@2', 'worker@2'],
      ['done', 'out'],
    ]);
  });

  it('chains copies one after another', () => {
    const g = expandRepeats(builtin('pipeline'), { steps: 3 });
    const pairs = g.edges.map((e) => `${e.source.node}→${e.target.node}`);
    expect(pairs.sort()).toEqual(
      ['in→step@1', 'step@1→step@2', 'step@2→step@3', 'step@3→out'].sort(),
    );
  });

  it('clamps the chosen count to the group’s range', () => {
    const g = expandRepeats(builtin('ensemble'), { members: 99 });
    expect(g.nodes.filter((n) => n.id.startsWith('member@'))).toHaveLength(9);
  });

  it('reports invalid groups in the pattern editor', () => {
    const p = builtin('fanOut');
    const { problems } = checkWorkflow(p.workflow, {
      kind: 'pattern',
      resolver,
      repeat: [
        ...p.repeat,
        {
          id: 'more',
          label: 'More',
          nodes: ['worker', 'in', 'ghost'],
          mode: 'parallel',
          min: 1,
          max: 3,
          default: 2,
        },
      ],
    });
    expect(problems.filter((x) => x.rule === 'repeat-invalid').map((x) => x.message)).toEqual([
      'Repeat group “More”: Worker is already in group “Workers”.',
      'Repeat group “More”: Task can’t be repeated: ports and notes exist once.',
      'Repeat group “More”: node “ghost” no longer exists.',
    ]);
  });
});

describe('slots', () => {
  it('lists slots with numbered roles, including decision evaluators', () => {
    const slots = listSlots(builtin('router'), { branches: 2 }, lookup);
    expect(slots?.map((s) => [s.key, s.role, s.evaluator])).toEqual([
      ['route', 'Router', true],
      ['branch@1', 'Branch 1', false],
      ['branch@2', 'Branch 2', false],
    ]);
  });

  it('lists the slots of nested patterns under the nested node’s path', () => {
    const keys = listSlots(builtin('hierarchy'), { teams: 2 }, lookup)?.map((s) => s.key);
    expect(keys).toEqual([
      'top',
      'team@1/supervisor',
      'team@1/worker@1',
      'team@1/worker@2',
      'team@2/supervisor',
      'team@2/worker@1',
      'team@2/worker@2',
    ]);
    for (const k of keys ?? []) expect(NodePath.safeParse(k).success).toBe(true);
    const roles = listSlots(builtin('hierarchy'), { teams: 2 }, lookup)?.map((s) => s.role);
    expect(roles?.[1]).toBe('Supervisor (Team 1)');
  });

  it('is undefined while a nested pattern is still loading', () => {
    expect(listSlots(builtin('hierarchy'), {}, () => undefined)).toBeUndefined();
  });
});

describe('pattern instances in a workflow', () => {
  it('is clean when bound and connected', () => {
    expect(rules(makerCheckerWorkflow())).toEqual([]);
  });

  it('flattens into prefixed nodes with the bound agents', () => {
    const flat = flattenWorkflow(makerCheckerWorkflow(), lookup);
    expect(flat.graph.nodes.map((n) => n.id)).toEqual([
      'task',
      'mc/in',
      'mc/maker',
      'mc/checker',
      'mc/approved',
      'mc/out',
      'done',
    ]);
    const maker = flat.graph.nodes.find((n) => n.id === 'mc/maker');
    expect(maker?.type === 'agent' && maker.binding).toEqual(bound('exec-aaaaaa'));
    expect(flat.graph.edges.find((e) => e.id === 'e1')?.target).toEqual({ node: 'mc/in' });
    expect([...flat.ports]).toEqual(['mc/in', 'mc/out']);
  });

  it('reports unbound slots on the instance', () => {
    const p = checkWorkflow(makerCheckerWorkflow({ maker: bound('exec-aaaaaa') } as never), {
      resolver,
    });
    const unbound = p.problems.find((x) => x.rule === 'unbound-slot');
    expect(unbound?.nodes).toEqual(['mc']);
    expect(unbound?.message).toContain('“Checker”');
  });

  it('reports an unconnected input port and edges to ports that don’t exist', () => {
    const g = makerCheckerWorkflow();
    g.edges = [edge('e2', 'mc', 'done', { from: 'gone' })];
    expect(rules(g)).toEqual(expect.arrayContaining(['port-unconnected', 'unknown-port']));
  });

  it('lifts problems inside the pattern onto the instance, keeping the inner paths', () => {
    const mc = builtin('makerChecker');
    const uncapped: Pattern = {
      ...mc,
      workflow: {
        ...mc.workflow,
        nodes: mc.workflow.nodes.map((n) =>
          n.type === 'decision'
            ? { ...n, exits: n.exits.map((x) => ({ id: x.id, label: x.label })) }
            : n,
        ),
      },
    };
    const r = { ...resolver, pattern: (x: PatternRef) => (x.id === mc.id ? uncapped : lookup(x)) };
    const loop = checkWorkflow(makerCheckerWorkflow(), { resolver: r }).problems.find(
      (x) => x.rule === 'uncapped-loop',
    );
    expect(loop?.nodes).toEqual(['mc']);
    expect(loop?.blocksSave).toBe(true);
    expect(loop?.fix).toBeUndefined(); // The cap is fixed in the pattern, not here.
    expect(loop?.message.startsWith('In Maker-checker: ')).toBe(true);
    expect(loop?.inner?.nodes).toEqual(expect.arrayContaining(['mc/maker', 'mc/approved']));
  });

  it('needs a join on a port fed twice, fixed on the instance', () => {
    const g = makerCheckerWorkflow();
    g.nodes.push({ ...input, id: 'task2' });
    g.edges.push(edge('e3', 'task2', 'mc', { to: 'in' }));
    const join = checkWorkflow(g, { resolver }).problems.find((x) => x.rule === 'missing-join');
    expect(join?.edges.sort()).toEqual(['e1', 'e3']);
    expect(join?.fix).toMatchObject({ kind: 'port-join-all', node: 'mc', port: 'in' });
    const fixed = join?.fix ? applyFix(g, join.fix) : g;
    expect(rules(fixed)).not.toContain('missing-join');
  });

  it('carries loops through instances (a loop around a pattern needs a cap too)', () => {
    const g = makerCheckerWorkflow();
    g.edges.push(edge('back', 'mc', 'mc', { from: 'out', to: 'in' }));
    g.nodes[1] = { ...g.nodes[1], portJoins: { in: { mode: 'any' } } } as WorkflowNode;
    expect(rules(g)).toContain('uncapped-loop');
  });

  it('reports missing patterns and slots used in a workflow', () => {
    const g = makerCheckerWorkflow();
    g.nodes[1] = createPatternNode('mc', { kind: 'pattern', id: 'gone-aaaaaa', version: 'v1' });
    expect(rules(g)).toContain('missing-ref');
    const slot: WorkflowNode = {
      id: 'a',
      type: 'agent',
      binding: { kind: 'slot', role: 'X', description: '' },
    };
    expect(rules({ nodes: [input, slot], edges: [edge('x', 'task', 'a')] })).toContain(
      'slot-in-workflow',
    );
  });

  it('only connects through ports that exist', () => {
    const g = makerCheckerWorkflow();
    expect(canConnect(g, { node: 'task' }, { node: 'mc' }, lookup).ok).toBe(false);
    expect(canConnect(g, { node: 'task' }, { node: 'mc', port: 'out' }, lookup).ok).toBe(false);
    expect(canConnect(g, { node: 'mc', port: 'in' }, { node: 'done' }, lookup).ok).toBe(false);
    g.nodes.push({ ...output, id: 'done2' });
    expect(canConnect(g, { node: 'mc', port: 'out' }, { node: 'done2' }, lookup).ok).toBe(true);
  });
});

describe('patterns in the pattern editor', () => {
  it('rejects concrete agents and a pattern containing itself', () => {
    const mc = builtin('makerChecker');
    const withAgent: WorkflowGraph = {
      ...mc.workflow,
      nodes: mc.workflow.nodes.map((n) =>
        n.id === 'maker' ? { ...n, binding: bound('exec-aaaaaa') } : n,
      ) as WorkflowNode[],
    };
    expect(
      checkWorkflow(withAgent, { kind: 'pattern', resolver }).problems.map((p) => p.rule),
    ).toContain('agent-in-pattern');

    const selfNested: WorkflowGraph = {
      nodes: [...mc.workflow.nodes, createPatternNode('again', ref(mc))],
      edges: [...mc.workflow.edges, edge('x', 'checker', 'again', { to: 'in' })],
    };
    const p = checkWorkflow(selfNested, { kind: 'pattern', resolver, selfId: mc.id });
    expect(p.problems.find((x) => x.rule === 'pattern-cycle')?.nodes).toEqual(['again']);
  });

  it('leaves nested slots open', () => {
    const h = builtin('hierarchy');
    const p = checkWorkflow(h.workflow, {
      kind: 'pattern',
      resolver,
      repeat: h.repeat,
      selfId: h.id,
    });
    expect(p.problems.map((x) => x.rule)).not.toContain('unbound-slot');
  });
});
