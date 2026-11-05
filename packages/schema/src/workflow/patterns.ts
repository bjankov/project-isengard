/**
 * Pattern instances (PLAN.md 7.7): ports, slots, repeat groups, and flattening instances into
 * plain nodes, so every workflow rule (loops, joins, reachability, tool coverage) also applies
 * across pattern boundaries. Pure, no I/O.
 *
 * Flattened node ids are node paths (`NodePath`): `review-k2f8/maker`, `team-a1b2/worker@2`.
 * The first segment is always the node of the original graph that owns the flattened node.
 */
import type { Pattern, RepeatGroup } from '../entities.js';
import { copyId, joinPath, type AgentRef, type PatternRef } from '../ids.js';
import type { WorkflowEdge, EdgeEndpoint } from './edges.js';
import type { WorkflowGraph } from './graph.js';
import type { AgentBinding, DecisionExit, PayloadType, WorkflowNode } from './nodes.js';

type PatternNode = Extract<WorkflowNode, { type: 'pattern' }>;

/** Looks up a pinned pattern: the pattern, `null` if it doesn't exist, `undefined` if not loaded. */
export type PatternLookup = (ref: PatternRef) => Pattern | null | undefined;

/** The graph a pattern defines, with its repeat groups. */
export type PatternContent = Pick<Pattern, 'workflow' | 'repeat'>;

// ---- Ports ----

export interface PatternPort {
  /** The boundary node's id inside the pattern; the `port` of external edges. */
  id: string;
  name: string;
  payloadType: PayloadType;
}

/** Input and Output boundary nodes of a pattern, in node order. Every input port is required. */
export function patternPorts(pattern: Pick<Pattern, 'workflow'>): {
  inputs: PatternPort[];
  outputs: PatternPort[];
} {
  const inputs: PatternPort[] = [];
  const outputs: PatternPort[] = [];
  for (const n of pattern.workflow.nodes) {
    if (n.type === 'input') inputs.push({ id: n.id, name: n.name, payloadType: n.payloadType });
    if (n.type === 'output') outputs.push({ id: n.id, name: n.name, payloadType: n.payloadType });
  }
  return { inputs, outputs };
}

// ---- Repeat groups ----

/** How many copies an instance makes of a group: its choice, clamped, or the default. */
export function repeatCount(group: RepeatGroup, chosen: Record<string, number> = {}): number {
  const n = chosen[group.id] ?? group.default;
  return Math.min(group.max, Math.max(group.min, n));
}

function renameBinding(b: AgentBinding, copy: number): AgentBinding {
  return b.kind === 'slot' ? { ...b, role: `${b.role} ${String(copy)}` } : b;
}

function copyNode(node: WorkflowNode, copy: number): WorkflowNode {
  const n = structuredClone(node);
  n.id = copyId(node.id, copy);
  if (n.label) n.label = `${n.label} ${String(copy)}`;
  if (n.type === 'agent') n.binding = renameBinding(n.binding, copy);
  if (n.type === 'decision' && n.evaluator.type === 'agent') {
    n.evaluator = { ...n.evaluator, agent: renameBinding(n.evaluator.agent, copy) };
  }
  return n;
}

/**
 * Copy one repeat group `count` times. Edges inside the group are copied per copy; edges into
 * or out of it connect every copy (fan-out, fan-in). A decision exit leading into the group
 * becomes one exit per copy (`exit@k`, labeled "<label> k"), with the same cap: a router
 * choosing between N workers has N exits.
 */
function expandGroup(graph: WorkflowGraph, group: RepeatGroup, count: number): WorkflowGraph {
  const members = new Set(group.nodes.filter((id) => graph.nodes.some((n) => n.id === id)));
  if (members.size === 0) return graph;
  const copies = Array.from({ length: count }, (_, i) => i + 1);
  const splitExits = new Map<string, Set<string>>(); // decision id -> exit ids leading in
  const chain = group.mode === 'chain';

  const edges: WorkflowEdge[] = [];
  for (const e of graph.edges) {
    const src = members.has(e.source.node);
    const tgt = members.has(e.target.node);
    if (!src && !tgt) {
      edges.push(e);
      continue;
    }
    if (chain && src !== tgt) {
      // In a chain only copy 1 receives the group's inputs, and only the last copy feeds its
      // outputs. Copy k hands over to copy k+1 like the group's input edges describe.
      const k = tgt ? 1 : count;
      edges.push({
        ...structuredClone(e),
        id: copyId(e.id, k),
        source: src ? { ...e.source, node: copyId(e.source.node, k) } : e.source,
        target: tgt ? { ...e.target, node: copyId(e.target.node, k) } : e.target,
      });
      if (!tgt) continue;
      const exits = graph.edges.filter(
        (o) => members.has(o.source.node) && !members.has(o.target.node),
      );
      for (const out of exits) {
        for (const c of copies.slice(0, -1)) {
          edges.push({
            ...structuredClone(e),
            id: copyId(`${out.id}-${e.id}`, c),
            source: { ...out.source, node: copyId(out.source.node, c) },
            target: { ...e.target, node: copyId(e.target.node, c + 1) },
          });
        }
      }
      continue;
    }
    for (const k of copies) {
      const source: EdgeEndpoint = src
        ? { ...e.source, node: copyId(e.source.node, k) }
        : { ...e.source };
      const target: EdgeEndpoint = tgt
        ? { ...e.target, node: copyId(e.target.node, k) }
        : { ...e.target };
      if (!src && e.source.port) {
        const from = graph.nodes.find((n) => n.id === e.source.node);
        if (from?.type === 'decision') {
          let set = splitExits.get(from.id);
          if (!set) splitExits.set(from.id, (set = new Set()));
          set.add(e.source.port);
          source.port = copyId(e.source.port, k);
        }
      }
      edges.push({ ...structuredClone(e), id: copyId(e.id, k), source, target });
    }
  }

  const nodes: WorkflowNode[] = [];
  for (const node of graph.nodes) {
    if (members.has(node.id)) {
      for (const k of copies) nodes.push(copyNode(node, k));
      continue;
    }
    const split = node.type === 'decision' ? splitExits.get(node.id) : undefined;
    if (node.type !== 'decision' || !split) {
      nodes.push(node);
      continue;
    }
    const exits: DecisionExit[] = node.exits.flatMap((x) =>
      split.has(x.id)
        ? copies.map((k) => ({ ...x, id: copyId(x.id, k), label: `${x.label} ${String(k)}` }))
        : [x],
    );
    const remap = (x: DecisionExit): DecisionExit =>
      x.onExhausted?.action === 'exit' && split.has(x.onExhausted.exit)
        ? { ...x, onExhausted: { action: 'exit', exit: copyId(x.onExhausted.exit, 1) } }
        : x;
    nodes.push({ ...node, exits: exits.map(remap) });
  }
  return { nodes, edges };
}

/** A pattern's graph with every repeat group copied as an instance chose (or its default). */
export function expandRepeats(
  pattern: PatternContent,
  chosen: Record<string, number> = {},
): WorkflowGraph {
  let graph = pattern.workflow;
  for (const group of pattern.repeat) {
    graph = expandGroup(graph, group, repeatCount(group, chosen));
  }
  return graph;
}

// ---- Slots ----

export interface PatternSlot {
  /** Binding key relative to the pattern, e.g. `maker`, `worker@2`, `team@1/worker@2`. */
  key: string;
  /** Role name, numbered for copies: "Worker 2". */
  role: string;
  description: string;
  defaultAgent?: AgentRef;
  /** The slot is a decision's evaluating agent rather than an agent node. */
  evaluator: boolean;
}

function slotOf(node: WorkflowNode): Extract<AgentBinding, { kind: 'slot' }> | undefined {
  if (node.type === 'agent' && node.binding.kind === 'slot') return node.binding;
  if (node.type === 'decision' && node.evaluator.type === 'agent') {
    const b = node.evaluator.agent;
    if (b.kind === 'slot') return b;
  }
  return undefined;
}

/**
 * Every slot an instance of `pattern` has to bind, including the slots of nested patterns.
 * Returns `undefined` while a nested pattern isn't loaded. Missing or recursive nested patterns
 * contribute no slots (they are reported as problems instead).
 */
export function listSlots(
  pattern: PatternContent,
  chosen: Record<string, number>,
  lookup: PatternLookup,
  seen: ReadonlySet<string> = new Set(),
): PatternSlot[] | undefined {
  const slots: PatternSlot[] = [];
  for (const node of expandRepeats(pattern, chosen).nodes) {
    const slot = slotOf(node);
    if (slot) {
      slots.push({
        key: node.id,
        role: slot.role,
        description: slot.description,
        ...(slot.defaultAgent ? { defaultAgent: slot.defaultAgent } : {}),
        evaluator: node.type === 'decision',
      });
    }
    if (node.type !== 'pattern' || seen.has(node.pattern.id)) continue;
    const nested = lookup(node.pattern);
    if (nested === undefined) return undefined;
    if (nested === null) continue;
    const inner = listSlots(nested, node.repeat, lookup, new Set([...seen, node.pattern.id]));
    if (!inner) return undefined;
    const copy = /@(\d+)$/.exec(node.id)?.[1];
    const group = copy ? ` (${node.label?.replace(/ \d+$/, '') ?? nested.name} ${copy})` : '';
    for (const s of inner) {
      const rename = node.bindings[s.key];
      const named = rename?.kind === 'slot' ? rename : undefined;
      slots.push({
        key: joinPath(node.id, s.key),
        role: `${named?.role ?? s.role}${group}`,
        description: named?.description || s.description,
        ...((named?.defaultAgent ?? s.defaultAgent)
          ? { defaultAgent: named?.defaultAgent ?? s.defaultAgent }
          : {}),
        evaluator: s.evaluator,
      });
    }
  }
  return slots;
}

// ---- Flattening ----

export interface FlatWorkflow {
  /** The workflow with every loadable pattern instance replaced by its nodes. */
  graph: WorkflowGraph;
  /** Boundary ports of inlined instances (Input/Output nodes that content passes through). */
  ports: Set<string>;
  /** Pattern instances that were inlined, by flat id. */
  inlined: Map<string, PatternNode>;
  /** Instances whose pattern is missing (`null`) or recursive, by flat id. */
  missing: Map<string, PatternNode>;
  recursive: Map<string, PatternNode>;
  /** False while a pattern isn't loaded yet: the flat graph is incomplete. */
  complete: boolean;
}

/** The node of the original graph that a flat node or edge id belongs to. */
export function ownerOf(flatId: string): string {
  const i = flatId.indexOf('/');
  return i === -1 ? flatId : flatId.slice(0, i);
}

/**
 * Replace pattern instances with their (repeat-expanded) nodes, recursively. Slots are filled
 * from the bindings of the outermost instance (keys as in `listSlots`); unbound slots stay
 * slots. Instances whose pattern is missing, recursive or not loaded stay as pattern nodes.
 */
export function flattenWorkflow(
  graph: WorkflowGraph,
  lookup?: PatternLookup,
  /** The pattern being edited, when `graph` is a pattern: instances of it are recursive. */
  selfId?: string,
): FlatWorkflow {
  const flat: FlatWorkflow = {
    graph: { nodes: [], edges: [] },
    ports: new Set(),
    inlined: new Map(),
    missing: new Map(),
    recursive: new Map(),
    complete: true,
  };

  /**
   * Add `g`'s nodes and edges under `prefix`. `bind` resolves a slot by its key relative to the
   * pattern being inlined (undefined at the top level, where nodes are taken as they are).
   */
  const inline = (
    g: WorkflowGraph,
    prefix: string,
    bind: ((key: string) => AgentBinding | undefined) | undefined,
    portJoins: PatternNode['portJoins'],
    seen: ReadonlySet<string>,
  ) => {
    const inlinedHere = new Set<string>();
    for (const node of g.nodes) {
      const id = joinPath(prefix, node.id);
      if (node.type === 'pattern' && lookup) {
        const pattern = seen.has(node.pattern.id) ? undefined : lookup(node.pattern);
        if (seen.has(node.pattern.id)) flat.recursive.set(id, node);
        else if (pattern === null) flat.missing.set(id, node);
        else if (pattern === undefined) flat.complete = false;
        if (pattern) {
          inlinedHere.add(node.id);
          flat.inlined.set(id, node);
          // A nested instance's slots are slots of the pattern around it: `<node>/<key>`.
          const nestedBind = (key: string): AgentBinding | undefined => {
            const own = node.bindings[key];
            if (!bind) return own; // A top-level instance binds directly.
            if (own?.kind === 'agent') return own;
            return bind?.(joinPath(node.id, key));
          };
          inline(
            expandRepeats(pattern, node.repeat),
            id,
            nestedBind,
            node.portJoins,
            new Set([...seen, node.pattern.id]),
          );
          continue;
        }
      }
      const copy = structuredClone(node);
      copy.id = id;
      if (bind) {
        if (copy.type === 'input' || copy.type === 'output') {
          flat.ports.add(id);
          if (copy.type === 'input') {
            const join = portJoins[node.id];
            if (join) copy.join = join;
            else delete copy.join;
          }
        }
        if (copy.type === 'agent' && copy.binding.kind === 'slot') {
          const b = bind(node.id);
          if (b?.kind === 'agent') copy.binding = b;
        }
        if (
          copy.type === 'decision' &&
          copy.evaluator.type === 'agent' &&
          copy.evaluator.agent.kind === 'slot'
        ) {
          const b = bind(node.id);
          if (b?.kind === 'agent') copy.evaluator = { ...copy.evaluator, agent: b };
        }
      }
      flat.graph.nodes.push(copy);
    }
    const end = (e: EdgeEndpoint): EdgeEndpoint => {
      const node = joinPath(prefix, e.node);
      if (inlinedHere.has(e.node) && e.port) return { node: joinPath(node, e.port) };
      return e.port ? { node, port: e.port } : { node };
    };
    for (const e of g.edges) {
      flat.graph.edges.push({
        ...structuredClone(e),
        id: joinPath(prefix, e.id),
        source: end(e.source),
        target: end(e.target),
      });
    }
  };

  inline(graph, '', undefined, {}, new Set(selfId ? [selfId] : []));
  return flat;
}
