/**
 * Plain-words descriptions of what an agent receives on each incoming edge (PLAN.md 9.4).
 * Pure, so it is unit tested without the UI.
 */
import {
  exitOf,
  nodeName,
  traceOrigin,
  type ContextModeName,
  type LoopAnalysis,
  type ModelRef,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowResolver,
} from '@app/schema';

export interface IncomingDescription {
  edge: WorkflowEdge;
  /** What arrives, e.g. `PLAN.md` or `Executor’s output`. */
  source: string;
  /** The decision it passed through, e.g. `tests pass? → fail`. */
  via?: string;
  /** How much of it, in plain words, e.g. `only the section “## Tasks”`. */
  what: string;
  /** `sequencing` for edges without payload (start-after only). */
  mode: ContextModeName | 'sequencing';
  /** Extra facts: loop history, shared-store access, v2-only work. */
  notes: string[];
  /** Arrives again on each loop round (the edge is part of a loop). */
  inLoop: boolean;
  /** The whole description as one line. */
  sentence: string;
}

function sourceLabel(node: WorkflowNode | undefined, resolver?: WorkflowResolver): string {
  if (!node) return 'unknown input';
  const name = nodeName(node, resolver);
  switch (node.type) {
    case 'input':
      return `the task “${name}”`;
    case 'artifact':
      return name;
    case 'agent':
      return `${name}’s output`;
    case 'toolStep':
      return `${name}’s result`;
    case 'humanInput':
      return `${name} (what the person provides)`;
    case 'sharedStore':
      return `the shared store “${name}”`;
    case 'decision':
      return `${name}’s input`;
    default:
      return name;
  }
}

/** Describe one incoming edge of an agent node. */
export function describeIncoming(
  graph: WorkflowGraph,
  edge: WorkflowEdge,
  options: {
    loops: LoopAnalysis;
    resolver?: WorkflowResolver;
    modelName?: (model: ModelRef) => string;
  },
): IncomingDescription {
  const { loops, resolver } = options;
  const modelName = options.modelName ?? ((m: ModelRef) => m.model);
  const from = graph.nodes.find((n) => n.id === edge.source.node);
  const origin = traceOrigin(graph, edge);
  const exit = exitOf(graph, edge);
  const via =
    from?.type === 'decision' && exit ? `${nodeName(from, resolver)} → ${exit.label}` : undefined;
  const source = sourceLabel(origin, resolver);
  const inLoop = loops.inCycle.has(edge.id);
  const notes: string[] = [];

  let what: string;
  let mode: IncomingDescription['mode'] = edge.context.mode;
  const ctx = edge.context;
  if (edge.payload === 'none') {
    mode = 'sequencing';
    what = `nothing; it only starts after ${from ? nodeName(from, resolver) : 'it'}`;
  } else {
    switch (ctx.mode) {
      case 'full':
        what = 'in full';
        break;
      case 'reference':
        what = 'as a workspace path only; the agent reads it on demand';
        break;
      case 'excerpt':
        what =
          ctx.selector.kind === 'heading'
            ? `only the section “${ctx.selector.heading}”`
            : ctx.selector.kind === 'jsonPath'
              ? `only ${ctx.selector.path} (JSON path)`
              : `only lines ${ctx.selector.start}–${ctx.selector.end}`;
        break;
      case 'diff':
        what =
          ctx.base === 'workspace-head'
            ? 'only the changes since the workspace’s last commit'
            : 'only what changed since the previous attempt';
        break;
      case 'summary':
        what = `a summary by ${modelName(ctx.model)}${ctx.instruction.trim() ? ` (“${ctx.instruction.trim()}”)` : ''}`;
        notes.push('summarized when the workflow runs (v2)');
        break;
      case 'outcome-only': {
        const decision =
          from?.type === 'decision'
            ? `which exit of ${nodeName(from, resolver)} was taken${exit ? ` (“${exit.label}”)` : ''}`
            : 'the outcome';
        what = `only ${decision}, plus the evaluator’s notes; no content`;
        break;
      }
    }
  }
  if (inLoop && mode !== 'sequencing') {
    notes.unshift(edge.history === 'all' ? 'all attempts' : 'latest attempt only');
  }
  if (edge.access === 'read' && from?.type === 'sharedStore') notes.push('read access');

  const head = `${source}${via ? ` via ${via}` : ''}`;
  const sentence = `${head}: ${what}${notes.length ? `, ${notes.join(', ')}` : ''}`;
  return { edge, source, via, what, mode, notes, inLoop, sentence };
}

/** Incoming edges of a node, forward ones first, then those that come back round a loop. */
export function incomingEdges(
  graph: WorkflowGraph,
  nodeId: string,
  loops: LoopAnalysis,
): WorkflowEdge[] {
  const incoming = graph.edges.filter((e) => e.target.node === nodeId);
  return [
    ...incoming.filter((e) => !loops.backEdges.has(e.id)),
    ...incoming.filter((e) => loops.backEdges.has(e.id)),
  ];
}
