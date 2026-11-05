import {
  analyzeLoops,
  validateWorkflow,
  type Agent,
  type LoopAnalysis,
  type Ref,
  type ToolPreset,
  type WorkflowGraph,
  type WorkflowProblem,
  type WorkflowResolver,
} from '@app/schema';
import { useEffect, useMemo } from 'react';
import { usePinnedStore } from '@/stores/pinned';

export type Severity = WorkflowProblem['severity'];

export interface WorkflowCheck {
  problems: WorkflowProblem[];
  errors: number;
  warnings: number;
  /** The worst severity per node / edge id. */
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

/**
 * Live validation of a workflow (PLAN.md 9.5). Loads the pinned agents and tool presets it
 * uses, so library rules (tool coverage, missing references) apply once they arrive.
 */
export function useWorkflowCheck(graph: WorkflowGraph, loops?: LoopAnalysis): WorkflowCheck {
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
    };
  }, [entries]);

  // Everything the rules need: agents (nodes and evaluators), their tools, tool-step presets.
  const wanted = useMemo(() => {
    const refs: Ref[] = [];
    for (const n of graph.nodes) {
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

  return useMemo(() => {
    const analysis = loops ?? analyzeLoops(graph);
    const problems = validateWorkflow(graph, resolver, { loops: analysis });
    const nodes = new Map<string, Severity>();
    const edges = new Map<string, Severity>();
    const uncappedEdges = new Set<string>();
    for (const p of problems) {
      for (const id of p.nodes) nodes.set(id, worse(nodes.get(id), p.severity));
      for (const id of p.edges) edges.set(id, worse(edges.get(id), p.severity));
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
  }, [graph, loops, resolver]);
}
