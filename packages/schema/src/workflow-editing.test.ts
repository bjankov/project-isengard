import { describe, expect, it } from 'vitest';
import {
  WorkflowGraph,
  analyzeLoops,
  canConnect,
  cloneSubgraph,
  createEdge,
  createNode,
  extractSubgraph,
  inferPayload,
  newLocalId,
  CANVAS_NODE_TYPES,
  WorkflowNode,
} from './index.js';
import { sampleProject } from './testing.js';

const demo = WorkflowGraph.parse(sampleProject.workflow);
const agentRef = { kind: 'agent' as const, id: 'planner-aaaaaa', version: 'v1' };
const toolRef = { kind: 'tool' as const, id: 'shell-aaaaaa', version: 'v1' };

describe('createNode', () => {
  it.each(CANVAS_NODE_TYPES)('creates a valid %s node', (type) => {
    const node = createNode(type, 'n1', { agent: agentRef, tool: toolRef });
    expect(WorkflowNode.safeParse(node).success).toBe(true);
  });

  it('requires an agent for agent nodes and a preset for tool steps', () => {
    expect(() => createNode('agent', 'a')).toThrow();
    expect(() => createNode('toolStep', 't')).toThrow();
  });
});

describe('newLocalId', () => {
  it('avoids taken ids and matches the LocalId format', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = newLocalId('agent', taken);
      expect(taken.has(id)).toBe(false);
      expect(id).toMatch(/^agent-[a-z0-9]{4}$/);
      taken.add(id);
    }
  });
});

describe('inferPayload', () => {
  it('follows the source node type', () => {
    expect(inferPayload(demo, { node: 'in' })).toBe('text');
    expect(inferPayload(demo, { node: 'plan' })).toBe('file');
    expect(inferPayload(demo, { node: 'planner' })).toBe('text');
    expect(inferPayload(demo, { node: 'out' })).toBe('none');
  });

  it('passes a decision’s input through', () => {
    expect(inferPayload(demo, { node: 'pass', port: 'no' })).toBe('text');
    const fileIn: WorkflowGraph = {
      nodes: [createNode('artifact', 'f'), createNode('decision', 'd')],
      edges: [
        {
          id: 'e',
          source: { node: 'f' },
          target: { node: 'd' },
          payload: 'file',
          context: { mode: 'full' },
        },
      ],
    };
    expect(inferPayload(fileIn, { node: 'd', port: 'pass' })).toBe('file');
  });
});

describe('canConnect', () => {
  const check = (s: string, t: string, port?: string) =>
    canConnect(demo, port ? { node: s, port } : { node: s }, { node: t });

  it('allows ordinary connections', () => {
    expect(check('planner', 'out')).toEqual({ ok: true });
    expect(check('pass', 'planner', 'yes')).toEqual({ ok: true });
  });

  it('refuses invalid ones with a reason', () => {
    expect(check('note', 'planner')).toMatchObject({ ok: false, reason: /Notes/ });
    expect(check('planner', 'note')).toMatchObject({ ok: false, reason: /Notes/ });
    expect(check('planner', 'in')).toMatchObject({ ok: false, reason: /Input/ });
    expect(check('out', 'planner')).toMatchObject({ ok: false, reason: /Output/ });
    expect(check('planner', 'planner')).toMatchObject({ ok: false, reason: /itself/ });
    expect(check('pass', 'out')).toMatchObject({ ok: false, reason: /exits/ });
    expect(check('in', 'planner')).toMatchObject({ ok: false, reason: /already connected/ });
  });
});

describe('createEdge', () => {
  it('infers the payload and sets shared-store access', () => {
    const g: WorkflowGraph = {
      nodes: [
        createNode('artifact', 'f'),
        createNode('sharedStore', 's'),
        createNode('agent', 'a', { agent: agentRef }),
      ],
      edges: [],
    };
    expect(createEdge(g, 'e1', { node: 'f' }, { node: 'a' })).toEqual({
      id: 'e1',
      source: { node: 'f' },
      target: { node: 'a' },
      payload: 'file',
      context: { mode: 'full' },
    });
    expect(createEdge(g, 'e2', { node: 'a' }, { node: 's' }).access).toBe('write');
    expect(createEdge(g, 'e3', { node: 's' }, { node: 'a' }).access).toBe('read');
  });
});

describe('analyzeLoops', () => {
  it('finds the retry loop of the demo workflow and its back edge', () => {
    const { inCycle, backEdges } = analyzeLoops(demo);
    expect([...inCycle].sort()).toEqual(['e4', 'e5', 'e7']);
    expect([...backEdges]).toEqual(['e7']);
  });

  it('reports no loops in an acyclic graph', () => {
    const g = { ...demo, edges: demo.edges.filter((e) => e.id !== 'e7') };
    const { inCycle, backEdges } = analyzeLoops(g);
    expect(inCycle.size).toBe(0);
    expect(backEdges.size).toBe(0);
  });
});

describe('copy and paste', () => {
  it('clones the selected nodes with the edges among them and fresh ids', () => {
    const positions = { planner: { x: 10, y: 20 }, plan: { x: 30, y: 40 } };
    const sub = extractSubgraph(demo, positions, ['planner', 'plan']);
    expect(sub.nodes.map((n) => n.id)).toEqual(['planner', 'plan']);
    expect(sub.edges.map((e) => e.id)).toEqual(['e2']);

    const clone = cloneSubgraph(
      sub,
      { nodes: demo.nodes.map((n) => n.id), edges: demo.edges.map((e) => e.id) },
      { x: 40, y: 40 },
    );
    const plannerCopy = clone.idMap.planner!;
    const planCopy = clone.idMap.plan!;
    expect(plannerCopy).not.toBe('planner');
    expect(clone.edges[0]).toMatchObject({
      source: { node: plannerCopy },
      target: { node: planCopy },
    });
    expect(clone.positions[plannerCopy]).toEqual({ x: 50, y: 60 });
    const merged = WorkflowGraph.safeParse({
      nodes: [...demo.nodes, ...clone.nodes],
      edges: [...demo.edges, ...clone.edges],
    });
    expect(merged.success).toBe(true);
  });
});
