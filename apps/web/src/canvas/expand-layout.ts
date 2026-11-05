/**
 * Layout of expanded pattern instances (PLAN.md 7.7): view state only, nothing here is saved.
 * An expanded instance is a frame holding its pattern's nodes (repeat copies stacked, slots
 * filled with the bound agents), with its Input and Output nodes as port pills on the frame's
 * left and right edges. Nested instances expand one level at a time.
 */
import {
  analyzeLoops,
  expandRepeats,
  joinPath,
  patternPorts,
  type Pattern,
  type EdgeEndpoint,
  type LoopAnalysis,
  type PatternLookup,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from '@app/schema';

type PatternNode = Extract<WorkflowNode, { type: 'pattern' }>;

export interface Size {
  width: number;
  height: number;
}

/** Approximate rendered sizes; layout must not wait for measuring. */
export const CARD: Size = { width: 224, height: 84 };
const DECISION: Size = { width: 230, height: 112 };
export const PORT: Size = { width: 112, height: 32 };
const NOTE: Size = { width: 224, height: 112 };
/** A collapsed instance: header, one row per port pair (inputs left, outputs right), footer. */
export function collapsedSize(pattern: Pick<Pattern, 'workflow'>): Size {
  const { inputs, outputs } = patternPorts(pattern);
  return { width: 256, height: 92 + Math.max(inputs.length, outputs.length, 1) * 24 };
}

export const FRAME_HEADER = 44;
const PAD = 40;
/** Vertical distance between copies of a repeated node. */
const COPY_GAP = 24;

export interface InnerNode {
  /** Flat path, e.g. `review-k2f8/maker` or `team-a1b2/worker@2`. */
  id: string;
  /** The frame it sits in. */
  parent: string;
  /** Position relative to the parent frame. */
  position: { x: number; y: number };
  node: WorkflowNode;
  /** An Input or Output boundary node drawn as a port pill on the frame. */
  port?: 'in' | 'out';
  /** For nested instances: expanded size, when expanded. */
  frame?: Size;
}

export interface InnerEdge {
  id: string;
  edge: WorkflowEdge;
  source: { node: string; handle?: string };
  target: { node: string; handle?: string };
  back: boolean;
  cap: number | undefined;
}

export interface FrameLayout {
  size: Size;
  nodes: InnerNode[];
  edges: InnerEdge[];
}

/** Context for laying out frames of one graph. */
export interface ExpandContext {
  lookup: PatternLookup;
  expanded: ReadonlySet<string>;
  /** The flattened workflow's nodes by path: slots there are filled with bound agents. */
  bound: ReadonlyMap<string, WorkflowNode>;
  /** How far each frame has opened, 0..1 (animation). Missing = fully open. */
  progress?: ReadonlyMap<string, number>;
}

function sizeOf(node: WorkflowNode, ctx: ExpandContext, path: string): Size {
  if (node.type === 'decision') return DECISION;
  if (node.type === 'note') return NOTE;
  if (node.type === 'pattern') {
    const p = ctx.lookup(node.pattern);
    const closed = p ? collapsedSize(p) : CARD;
    const open = ctx.expanded.has(path) ? frameLayout(path, node, ctx)?.size : undefined;
    return open ? lerpSize(closed, open, ctx.progress?.get(path) ?? 1) : closed;
  }
  return CARD;
}

export function lerpSize(a: Size, b: Size, t: number): Size {
  return { width: a.width + (b.width - a.width) * t, height: a.height + (b.height - a.height) * t };
}

/** Where an edge endpoint attaches in the drawn graph, inside the frame at `prefix`. */
export function attach(
  prefix: string,
  end: EdgeEndpoint,
  graph: WorkflowGraph,
  expanded: ReadonlySet<string>,
): { node: string; handle?: string } {
  const node = joinPath(prefix, end.node);
  const target = graph.nodes.find((n) => n.id === end.node);
  if (target?.type === 'pattern' && expanded.has(node) && end.port) {
    return { node: joinPath(node, end.port) };
  }
  return end.port ? { node, handle: end.port } : { node };
}

/** The node a copy came from: `worker@2` → `worker`. */
const templateId = (id: string) => id.replace(/@\d+$/, '');
const copyIndex = (id: string) => Number(/@(\d+)$/.exec(id)?.[1] ?? '1');

/**
 * The expanded frame of the instance at `path`, or undefined while its pattern isn't loaded.
 * Positions come from the pattern's own layout; copies of repeated nodes stack downwards, and
 * whatever was below them moves down to make room.
 */
export function frameLayout(
  path: string,
  instance: PatternNode,
  ctx: ExpandContext,
): FrameLayout | undefined {
  const pattern = ctx.lookup(instance.pattern);
  if (!pattern) return undefined;
  const graph = expandRepeats(pattern, instance.repeat);
  const template = pattern.layout.nodes;

  // Template positions, with copies stacked under the first one.
  const raw = new Map<string, { x: number; y: number; size: Size }>();
  for (const n of graph.nodes) {
    const t = template[templateId(n.id)] ?? { x: 0, y: 0 };
    const size = sizeOf(n, ctx, joinPath(path, n.id));
    raw.set(n.id, { x: t.x, y: t.y + (copyIndex(n.id) - 1) * (size.height + COPY_GAP), size });
  }
  // Make room below repeated groups (and below expanded nested frames).
  const grow = new Map<string, { y: number; extra: number }>();
  for (const n of graph.nodes) {
    const t = template[templateId(n.id)];
    const r = raw.get(n.id);
    if (!t || !r) continue;
    const bottom = r.y + r.size.height - (t.y + CARD.height);
    const key = templateId(n.id);
    if (bottom > (grow.get(key)?.extra ?? 0)) grow.set(key, { y: t.y, extra: bottom });
  }
  for (const n of graph.nodes) {
    const t = template[templateId(n.id)];
    const r = raw.get(n.id);
    if (!t || !r) continue;
    for (const [key, g] of grow) {
      if (key !== templateId(n.id) && t.y > g.y) r.y += g.extra;
    }
  }

  const inner = [...raw.entries()].filter(([id]) => {
    const n = graph.nodes.find((x) => x.id === id);
    return n && n.type !== 'input' && n.type !== 'output';
  });
  const xs = inner.map(([, r]) => r.x);
  const ys = [...raw.values()].map((r) => r.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const right = inner.length ? Math.max(...inner.map(([, r]) => r.x + r.size.width)) : minX;
  const bottom = Math.max(...[...raw.values()].map((r) => r.y + r.size.height), minY);
  // Ports stick out half their width; the inner nodes start after the input ports.
  const left = PAD + PORT.width / 2;
  const width = right - minX + left + PAD + PORT.width / 2;
  const height = bottom - minY + FRAME_HEADER + PAD * 2;

  const nodes: InnerNode[] = graph.nodes.map((n) => {
    const id = joinPath(path, n.id);
    const r = raw.get(n.id) ?? { x: 0, y: 0, size: CARD };
    const y = r.y - minY + FRAME_HEADER + PAD;
    // The flattened graph has the bound agents in place of slots (not for nested instances,
    // or in the pattern editor, where slots stay slots).
    const shown = ctx.bound.get(id) ?? n;
    if (n.type === 'input') {
      return {
        id,
        parent: path,
        position: { x: -PORT.width / 2, y },
        node: { ...shown, id },
        port: 'in',
      };
    }
    if (n.type === 'output') {
      return {
        id,
        parent: path,
        position: { x: width - PORT.width / 2, y },
        node: { ...shown, id },
        port: 'out',
      };
    }
    const frame =
      n.type === 'pattern' && ctx.expanded.has(id) ? frameLayout(id, n, ctx)?.size : undefined;
    return {
      id,
      parent: path,
      position: { x: r.x - minX + left, y },
      node: { ...shown, id },
      ...(frame ? { frame } : {}),
    };
  });

  const loops: LoopAnalysis = analyzeLoops(graph);
  const edges: InnerEdge[] = graph.edges.map((e) => {
    const from = graph.nodes.find((n) => n.id === e.source.node);
    const exit =
      from?.type === 'decision' ? from.exits.find((x) => x.id === e.source.port) : undefined;
    return {
      id: joinPath(path, e.id),
      edge: e,
      source: attach(path, e.source, graph, ctx.expanded),
      target: attach(path, e.target, graph, ctx.expanded),
      back: loops.backEdges.has(e.id),
      cap: loops.capEdges.has(e.id) ? exit?.maxIterations : undefined,
    };
  });

  return { size: { width, height }, nodes, edges };
}
