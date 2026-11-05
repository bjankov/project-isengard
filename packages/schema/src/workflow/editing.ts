/**
 * Pure helpers for editing workflow graphs: default node contents, connection rules, payload
 * inference and loop analysis. Shared by the canvas (web) and tests; no I/O.
 */
import type { AgentRef, ToolRef } from '../ids.js';
import type { WorkflowEdge, EdgeEndpoint } from './edges.js';
import type { WorkflowGraph } from './graph.js';
import type {
  DecisionExit,
  Evaluator,
  JoinMode,
  PayloadType,
  WorkflowNode,
  WorkflowNodeType,
} from './nodes.js';

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
   * Edges that close a cycle when walking forward from the inputs. They are drawn curved, and
   * don't count as inputs for joins: a loop re-runs its target.
   */
  backEdges: Set<string>;
  /** Decision-exit edges in a cycle whose exit sets `maxIterations`: the caps of their loops. */
  capEdges: Set<string>;
  /**
   * Loops with no capped decision exit (what is left going round once every cap edge is
   * removed). Each one blocks saving.
   */
  uncapped: { nodes: string[]; edges: string[] }[];
}

/** Strongly connected components (Tarjan): node id -> component number. */
function components(
  nodeIds: readonly string[],
  edges: readonly WorkflowEdge[],
): Map<string, number> {
  const out = new Map<string, string[]>();
  for (const id of nodeIds) out.set(id, []);
  for (const e of edges) out.get(e.source.node)?.push(e.target.node);
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
    for (const w of out.get(v) ?? []) {
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
  for (const id of nodeIds) if (!idx.has(id)) strong(id);
  return comp;
}

/** Edges whose two ends are in the same strongly connected component. */
function cycleEdges(nodeIds: readonly string[], edges: readonly WorkflowEdge[]): WorkflowEdge[] {
  const comp = components(nodeIds, edges);
  return edges.filter((e) => {
    const a = comp.get(e.source.node);
    return a !== undefined && a === comp.get(e.target.node);
  });
}

/** The decision exit an edge leaves from, if its source is a decision. */
export function exitOf(graph: WorkflowGraph, edge: WorkflowEdge): DecisionExit | undefined {
  const from = graph.nodes.find((n) => n.id === edge.source.node);
  return from?.type === 'decision' ? from.exits.find((x) => x.id === edge.source.port) : undefined;
}

export function analyzeLoops(graph: WorkflowGraph): LoopAnalysis {
  const nodeIds = graph.nodes.map((n) => n.id);
  const inCycle = new Set(cycleEdges(nodeIds, graph.edges).map((e) => e.id));

  const capEdges = new Set(
    graph.edges
      .filter((e) => inCycle.has(e.id) && exitOf(graph, e)?.maxIterations !== undefined)
      .map((e) => e.id),
  );

  // What still goes round once the caps are removed is an uncapped loop.
  const rest = cycleEdges(
    nodeIds,
    graph.edges.filter((e) => !capEdges.has(e.id)),
  );
  const restComp = components(nodeIds, rest);
  const groups = new Map<number, { nodes: Set<string>; edges: string[] }>();
  for (const e of rest) {
    const c = restComp.get(e.source.node) ?? -1;
    let g = groups.get(c);
    if (!g) groups.set(c, (g = { nodes: new Set(), edges: [] }));
    g.nodes.add(e.source.node).add(e.target.node);
    g.edges.push(e.id);
  }
  const uncapped = [...groups.values()].map((g) => ({ nodes: [...g.nodes], edges: g.edges }));

  // Back edges: DFS from the inputs first (then any unvisited node), in node order.
  const out = new Map<string, WorkflowEdge[]>();
  for (const id of nodeIds) out.set(id, []);
  for (const e of graph.edges) out.get(e.source.node)?.push(e);
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

  return { inCycle, backEdges, capEdges, uncapped };
}

// ---- Joins ----

/**
 * The incoming edges that count for a node's join (PLAN.md 7.5): every incoming edge except
 * loop back-edges (a loop re-runs its target with the latest of its other inputs) and reads
 * from a shared store (access to state, not a trigger). Shared stores never join.
 */
export function joinInputs(
  graph: WorkflowGraph,
  nodeId: string,
  loops: LoopAnalysis = analyzeLoops(graph),
): WorkflowEdge[] {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node || node.type === 'sharedStore' || node.type === 'note') return [];
  const stores = new Set(graph.nodes.filter((n) => n.type === 'sharedStore').map((n) => n.id));
  return graph.edges.filter(
    (e) => e.target.node === nodeId && !loops.backEdges.has(e.id) && !stores.has(e.source.node),
  );
}

/** Whether a node needs a join mode: more than one incoming edge counts for it. */
export function needsJoin(graph: WorkflowGraph, nodeId: string, loops?: LoopAnalysis): boolean {
  return joinInputs(graph, nodeId, loops).length > 1;
}

/** Short label of a join mode, e.g. `all`, `any`, `2 of 3`. */
export function joinLabel(join: JoinMode, inputs: number): string {
  return join.mode === 'n-of-m' ? `${join.n} of ${inputs}` : join.mode;
}

// ---- Origins ----

/**
 * The node whose content an edge really carries: decisions pass their input through, so an
 * edge leaving a decision carries what came into it. Follows the first incoming edge with a
 * payload (the same rule as payload inference); returns the decision itself if it has none.
 */
export function traceOrigin(graph: WorkflowGraph, edge: WorkflowEdge): WorkflowNode | undefined {
  const seen = new Set<string>();
  let node = graph.nodes.find((n) => n.id === edge.source.node);
  while (node?.type === 'decision' && !seen.has(node.id)) {
    seen.add(node.id);
    const id = node.id;
    const incoming =
      graph.edges.find((e) => e.target.node === id && e.payload !== 'none') ??
      graph.edges.find((e) => e.target.node === id);
    if (!incoming) break;
    node = graph.nodes.find((n) => n.id === incoming.source.node);
  }
  return node;
}

// ---- Decision exits ----

/** The exits a new evaluator of this type starts with (PLAN.md 7.4). */
export function defaultExits(type: Evaluator['type']): DecisionExit[] {
  switch (type) {
    case 'deterministic':
      return [
        { id: 'pass', label: 'pass' },
        { id: 'fail', label: 'fail' },
      ];
    case 'human':
      return [
        { id: 'approve', label: 'approve' },
        { id: 'reject', label: 'reject' },
      ];
    case 'agent':
      return [];
  }
}

function sameExits(a: readonly DecisionExit[], b: readonly DecisionExit[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.id === b[i]?.id &&
        x.label === b[i]?.label &&
        x.maxIterations === undefined &&
        x.onExhausted === undefined,
    )
  );
}

/**
 * Switch a decision's evaluator. Exits that are still the untouched defaults of the old type
 * (and not connected) become the new type's defaults; anything the user changed is kept.
 */
export function withEvaluator(
  graph: WorkflowGraph,
  node: Extract<WorkflowNode, { type: 'decision' }>,
  evaluator: Evaluator,
): Extract<WorkflowNode, { type: 'decision' }> {
  const untouched =
    sameExits(node.exits, defaultExits(node.evaluator.type)) &&
    !graph.edges.some((e) => e.source.node === node.id);
  const next = defaultExits(evaluator.type);
  return { ...node, evaluator, exits: untouched && next.length ? next : node.exits };
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
