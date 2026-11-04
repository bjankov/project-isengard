/**
 * Pure helpers for editing workflow graphs: default node contents, connection rules, payload
 * inference and loop analysis. Shared by the canvas (web) and tests; no I/O.
 */
import type { AgentRef, ToolRef } from '../ids.js';
import type { WorkflowEdge, EdgeEndpoint } from './edges.js';
import type { WorkflowGraph } from './graph.js';
import type { PayloadType, WorkflowNode, WorkflowNodeType } from './nodes.js';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A new local id `<prefix>-<4 chars>` that is not in `taken`. */
export function newLocalId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (;;) {
    const bytes = new Uint8Array(4);
    globalThis.crypto.getRandomValues(bytes);
    let suffix = '';
    for (const b of bytes) suffix += ID_ALPHABET[b % ID_ALPHABET.length];
    const id = `${prefix}-${suffix}`;
    if (!used.has(id)) return id;
  }
}

/** Node types that can be placed on the canvas in M3 (patterns arrive in M5). */
export const CANVAS_NODE_TYPES = [
  'input',
  'agent',
  'artifact',
  'decision',
  'toolStep',
  'humanInput',
  'sharedStore',
  'output',
  'note',
] as const satisfies readonly WorkflowNodeType[];
export type CanvasNodeType = (typeof CANVAS_NODE_TYPES)[number];

export const NODE_TYPE_INFO: Record<WorkflowNodeType, { label: string; description: string }> = {
  input: { label: 'Input', description: 'Where the workflow starts: the task and any files.' },
  output: { label: 'Output', description: 'Where the workflow ends.' },
  agent: { label: 'Agent', description: 'An agent from the library doing one step.' },
  decision: {
    label: 'Decision',
    description: 'Chooses one labeled exit. The only node that branches.',
  },
  artifact: { label: 'Artifact', description: 'A file flowing through the workflow.' },
  toolStep: { label: 'Tool step', description: 'A fixed action without an LLM, e.g. run tests.' },
  humanInput: { label: 'Human input', description: 'A person provides answers or files.' },
  sharedStore: {
    label: 'Shared store',
    description: 'Named state several agents read and write.',
  },
  pattern: { label: 'Pattern', description: 'A reusable group of nodes.' },
  note: { label: 'Note', description: 'A comment on the canvas. Never executed.' },
};

/** Node types that need a library entity before they can be created. */
export type NodeNeeds = { agent?: AgentRef; tool?: ToolRef };

/**
 * A new node of `type` with sensible defaults. Agent nodes need `needs.agent`, tool steps need
 * `needs.tool`.
 */
export function createNode(type: CanvasNodeType, id: string, needs: NodeNeeds = {}): WorkflowNode {
  switch (type) {
    case 'input':
      return { id, type, name: 'Task', payloadType: 'text', content: '', files: [] };
    case 'output':
      return { id, type, name: 'Result', payloadType: 'text' };
    case 'agent':
      if (!needs.agent) throw new Error('an agent node needs an agent');
      return { id, type, binding: { kind: 'agent', agent: needs.agent } };
    case 'decision':
      return {
        id,
        type,
        evaluator: { type: 'deterministic', language: 'python', code: '' },
        exits: [
          { id: 'pass', label: 'pass' },
          { id: 'fail', label: 'fail' },
        ],
      };
    case 'artifact':
      return { id, type, path: 'output.md', fileType: 'markdown' };
    case 'toolStep':
      if (!needs.tool) throw new Error('a tool step needs a tool preset');
      return { id, type, tool: needs.tool, args: {} };
    case 'humanInput':
      return { id, type, instructions: '', fields: [] };
    case 'sharedStore':
      return { id, type, name: 'Shared notes', format: 'markdown' };
    case 'note':
      return { id, type, text: '' };
  }
}

// ---- Payload inference ----

/** What a node emits on its outgoing edges (PLAN.md 7.2: inferred from the source). */
export function inferPayload(graph: WorkflowGraph, source: EdgeEndpoint): PayloadType {
  const seen = new Set<string>();
  const of = (nodeId: string): PayloadType => {
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node || seen.has(nodeId)) return 'text';
    seen.add(nodeId);
    switch (node.type) {
      case 'input':
        return node.payloadType;
      case 'artifact':
        return 'file';
      case 'output':
      case 'note':
        return 'none';
      case 'decision': {
        // A decision passes its input through on the chosen exit.
        for (const e of graph.edges) {
          if (e.target.node === nodeId && e.payload !== 'none') return e.payload;
        }
        const incoming = graph.edges.find((e) => e.target.node === nodeId);
        return incoming ? of(incoming.source.node) : 'text';
      }
      default:
        return 'text';
    }
  };
  return of(source.node);
}

// ---- Connection rules ----

export type ConnectionCheck = { ok: true } | { ok: false; reason: string };

/** Whether an edge from `source` to `target` is allowed, with a reason when it is not. */
export function canConnect(
  graph: WorkflowGraph,
  source: EdgeEndpoint,
  target: EdgeEndpoint,
): ConnectionCheck {
  const from = graph.nodes.find((n) => n.id === source.node);
  const to = graph.nodes.find((n) => n.id === target.node);
  if (!from || !to) return { ok: false, reason: 'Both ends must be nodes on the canvas.' };
  if (from.type === 'note' || to.type === 'note') {
    return { ok: false, reason: 'Notes are comments and can’t be connected.' };
  }
  if (from.id === to.id) return { ok: false, reason: 'A node can’t connect to itself.' };
  if (to.type === 'input') {
    return { ok: false, reason: 'Nothing flows into an Input: it is where the workflow starts.' };
  }
  if (from.type === 'output') {
    return { ok: false, reason: 'An Output ends the workflow: nothing comes out of it.' };
  }
  if (from.type === 'decision' && !from.exits.some((x) => x.id === source.port)) {
    return { ok: false, reason: 'Connect from one of the decision’s exits.' };
  }
  const duplicate = graph.edges.some(
    (e) =>
      e.source.node === source.node &&
      (e.source.port ?? null) === (source.port ?? null) &&
      e.target.node === target.node &&
      (e.target.port ?? null) === (target.port ?? null),
  );
  if (duplicate) return { ok: false, reason: 'These two are already connected.' };
  return { ok: true };
}

/** A new edge with inferred payload, `full` context and shared-store access defaults. */
export function createEdge(
  graph: WorkflowGraph,
  id: string,
  source: EdgeEndpoint,
  target: EdgeEndpoint,
): WorkflowEdge {
  const from = graph.nodes.find((n) => n.id === source.node);
  const to = graph.nodes.find((n) => n.id === target.node);
  const edge: WorkflowEdge = {
    id,
    source: source.port ? { node: source.node, port: source.port } : { node: source.node },
    target: target.port ? { node: target.node, port: target.port } : { node: target.node },
    payload: inferPayload(graph, source),
    context: { mode: 'full' },
  };
  if (to?.type === 'sharedStore') edge.access = 'write';
  else if (from?.type === 'sharedStore') edge.access = 'read';
  return edge;
}

// ---- Loops ----

export interface LoopAnalysis {
  /** Edges that are part of a cycle (where the history toggle applies). */
  inCycle: Set<string>;
  /**
   * Edges that close a cycle when walking forward from the inputs (drawn curved with an
   * iteration-cap badge; on decision exits they need `maxIterations`).
   */
  backEdges: Set<string>;
}

export function analyzeLoops(graph: WorkflowGraph): LoopAnalysis {
  const out = new Map<string, WorkflowEdge[]>();
  for (const n of graph.nodes) out.set(n.id, []);
  for (const e of graph.edges) out.get(e.source.node)?.push(e);

  // Strongly connected components (Tarjan): an edge is in a cycle iff both ends share one.
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const comp = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  let compCount = 0;
  const strong = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const e of out.get(v) ?? []) {
      const w = e.target.node;
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) ?? 0, idx.get(w) ?? 0));
      }
    }
    if (low.get(v) === idx.get(v)) {
      for (let w = stack.pop(); w !== undefined; w = stack.pop()) {
        onStack.delete(w);
        comp.set(w, compCount);
        if (w === v) break;
      }
      compCount++;
    }
  };
  for (const n of graph.nodes) if (!idx.has(n.id)) strong(n.id);

  const inCycle = new Set<string>();
  for (const e of graph.edges) {
    const a = comp.get(e.source.node);
    if (a !== undefined && a === comp.get(e.target.node)) inCycle.add(e.id);
  }

  // Back edges: DFS from the inputs first (then any unvisited node), in node order.
  const backEdges = new Set<string>();
  const state = new Map<string, 'active' | 'done'>();
  const visit = (v: string) => {
    state.set(v, 'active');
    for (const e of out.get(v) ?? []) {
      const s = state.get(e.target.node);
      if (s === 'active') backEdges.add(e.id);
      else if (!s) visit(e.target.node);
    }
    state.set(v, 'done');
  };
  const order = [
    ...graph.nodes.filter((n) => n.type === 'input'),
    ...graph.nodes.filter((n) => n.type !== 'input'),
  ];
  for (const n of order) if (!state.has(n.id)) visit(n.id);

  return { inCycle, backEdges };
}

// ---- Copy / paste ----

export interface Subgraph {
  nodes: WorkflowNode[];
  /** Only edges between the copied nodes. */
  edges: WorkflowEdge[];
  positions: Record<string, { x: number; y: number }>;
}

/** The given nodes, the edges among them and their positions. */
export function extractSubgraph(
  graph: WorkflowGraph,
  positions: Record<string, { x: number; y: number }>,
  nodeIds: Iterable<string>,
): Subgraph {
  const ids = new Set(nodeIds);
  const result: Subgraph = {
    nodes: graph.nodes.filter((n) => ids.has(n.id)),
    edges: graph.edges.filter((e) => ids.has(e.source.node) && ids.has(e.target.node)),
    positions: {},
  };
  for (const id of ids) {
    const p = positions[id];
    if (p) result.positions[id] = { x: p.x, y: p.y };
  }
  return result;
}

/**
 * Copies of a subgraph's nodes and edges with fresh ids, moved by `offset`. `idMap` maps old
 * node ids to new ones (e.g. to copy per-node overrides).
 */
export function cloneSubgraph(
  sub: Subgraph,
  taken: { nodes: Iterable<string>; edges: Iterable<string> },
  offset: { x: number; y: number },
): Subgraph & { idMap: Record<string, string> } {
  const nodeIds = new Set(taken.nodes);
  const edgeIds = new Set(taken.edges);
  const idMap: Record<string, string> = {};
  const nodes = sub.nodes.map((n) => {
    const id = newLocalId(
      n.type.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
      nodeIds,
    );
    nodeIds.add(id);
    idMap[n.id] = id;
    return { ...structuredClone(n), id };
  });
  const edges = sub.edges.map((e) => {
    const id = newLocalId('e', edgeIds);
    edgeIds.add(id);
    return {
      ...structuredClone(e),
      id,
      source: { ...e.source, node: idMap[e.source.node] ?? e.source.node },
      target: { ...e.target, node: idMap[e.target.node] ?? e.target.node },
    };
  });
  const positions: Subgraph['positions'] = {};
  for (const [old, p] of Object.entries(sub.positions)) {
    const id = idMap[old];
    if (id) positions[id] = { x: p.x + offset.x, y: p.y + offset.y };
  }
  return { nodes, edges, positions, idMap };
}
