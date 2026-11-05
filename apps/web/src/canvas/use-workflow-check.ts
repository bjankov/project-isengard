import {
  checkWorkflow,
  flattenWorkflow,
  type Agent,
  type Pattern,
  type Ref,
  type RepeatGroup,
  type ToolPreset,
  type WorkflowGraph,
  type WorkflowProblem,
  type WorkflowResolver,
} from '@app/schema';
import { useEffect, useMemo } from 'react';
import { usePinnedStore } from '@/stores/pinned';
import type { CanvasKind } from './doc';

export type Severity = WorkflowProblem['severity'];

export interface WorkflowCheck {
  problems: WorkflowProblem[];
  errors: number;
  warnings: number;
  /** The worst severity per node / edge id, and per inner path of an instance. */
  nodes: Map<string, Severity>;
  edges: Map<string, Severity>;
  /** Edges that are the first-named place of an uncapped loop (shown with a `no cap` badge). */
  uncappedEdges: Set<string>;
  blocking: WorkflowProblem[];
  resolver: WorkflowResolver;
}

const keyOf = (ref: Pick<Ref, 'kind' | 'id' | 'version'>) => `${ref.kind}/${ref.id}@${ref.version}`;

function worse(a: Severity | undefined, b: Severity): Severity {
  return a === 'error' || b === 'error' ? 'error' : 'warning';
}

export interface CheckTarget {
  kind: CanvasKind;
  /** The pattern's repeat groups and id, when checking a pattern. */
  repeat?: readonly RepeatGroup[];
  selfId?: string;
}

/**
 * Live validation of a workflow or pattern (PLAN.md 9.5). Loads the pinned patterns, agents
 * and tool presets it uses (also inside pattern instances), so the rules that need them apply
 * once they arrive.
 */
export function useWorkflowCheck(graph: WorkflowGraph, target: CheckTarget): WorkflowCheck {
  const entries = usePinnedStore((s) => s.entries);
  const load = usePinnedStore((s) => s.load);

  const resolver = useMemo<WorkflowResolver>(() => {
    const lookup = <T>(ref: Ref): T | null | undefined => {
      const e = entries[keyOf(ref)];
      if (!e || e.state === 'loading') return undefined;
      return e.state === 'missing' ? null : (e.entity as T);
    };
    return {
      agent: (ref) => lookup<Agent>(ref),
      tool: (ref) => lookup<ToolPreset>(ref),
      pattern: (ref) => lookup<Pattern>(ref),
    };
  }, [entries]);

  // Everything the rules need: patterns (nested ones as they arrive), then the agents and
  // presets of the flattened graph, with every instance's bound agents in place.
  const wanted = useMemo(() => {
    const refs: Ref[] = [];
    const flat = flattenWorkflow(graph, resolver.pattern);
    const visit = (g: WorkflowGraph) => {
      for (const n of g.nodes) {
        if (n.type === 'pattern') refs.push(n.pattern);
        if (n.type === 'agent' && n.binding.kind === 'agent') refs.push(n.binding.agent);
        if (
          n.type === 'decision' &&
          n.evaluator.type === 'agent' &&
          n.evaluator.agent.kind === 'agent'
        ) {
          refs.push(n.evaluator.agent.agent);
        }
        if (n.type === 'toolStep') refs.push(n.tool);
      }
    };
    visit(graph);
    visit(flat.graph);
    for (const ref of [...refs]) {
      if (ref.kind !== 'agent') continue;
      const agent = resolver.agent({ kind: 'agent', id: ref.id, version: ref.version });
      if (agent) refs.push(...agent.tools);
    }
    return refs;
  }, [graph, resolver]);

  useEffect(() => {
    for (const ref of wanted) {
      if (!usePinnedStore.getState().entries[keyOf(ref)]) void load(ref.kind, ref.id, ref.version);
    }
  }, [wanted, load]);

  const { kind, repeat, selfId } = target;
  return useMemo(() => {
    const { problems } = checkWorkflow(graph, {
      kind: kind === 'pattern' ? 'pattern' : 'workflow',
      resolver,
      ...(repeat ? { repeat } : {}),
      ...(selfId ? { selfId } : {}),
    });
    const nodes = new Map<string, Severity>();
    const edges = new Map<string, Severity>();
    const uncappedEdges = new Set<string>();
    for (const p of problems) {
      for (const id of [...p.nodes, ...(p.inner?.nodes ?? [])])
        nodes.set(id, worse(nodes.get(id), p.severity));
      for (const id of [...p.edges, ...(p.inner?.edges ?? [])])
        edges.set(id, worse(edges.get(id), p.severity));
      if (p.rule === 'uncapped-loop' && p.edges[0]) uncappedEdges.add(p.edges[0]);
    }
    return {
      problems,
      errors: problems.filter((p) => p.severity === 'error').length,
      warnings: problems.filter((p) => p.severity === 'warning').length,
      nodes,
      edges,
      uncappedEdges,
      blocking: problems.filter((p) => p.blocksSave),
      resolver,
    };
  }, [graph, kind, repeat, selfId, resolver]);
}
