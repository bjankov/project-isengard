import {
  joinInputs,
  joinLabel,
  portInputs,
  type LoopAnalysis,
  type WorkflowGraph,
} from '@app/schema';
import type { Severity, WorkflowCheck } from './use-workflow-check';

/** What a node shows about its problems and inputs: outline, marker, join chip, port joins. */
export interface NodeStatus {
  severity?: Severity;
  messages: string[];
  /** How the node waits for several inputs: a label, null when not chosen, absent for ≤ 1. */
  join?: string | null;
  /** Inputs that count for its join. */
  inputs: number;
  /** Pattern instances: inputs per input port, and the ports its edges use. */
  portInputs?: Record<string, number>;
  usedPorts?: { inputs: string[]; outputs: string[] };
}

export const NO_STATUS: NodeStatus = { messages: [], inputs: 0 };

/**
 * The status of every node of the graph, computed once per change (not once per node per
 * render). Inner nodes of expanded instances (paths) get severity and messages only.
 */
export function nodeStatuses(
  graph: WorkflowGraph,
  loops: LoopAnalysis,
  check: WorkflowCheck,
): (id: string) => NodeStatus {
  const messages = new Map<string, string[]>();
  for (const p of check.problems) {
    const first = p.nodes[0];
    if (first === undefined) continue;
    const list = messages.get(first) ?? [];
    list.push(p.message);
    messages.set(first, list);
  }
  const top = new Map<string, NodeStatus>();
  for (const n of graph.nodes) {
    const inputs = joinInputs(graph, n.id, loops).length;
    const status: NodeStatus = {
      messages: messages.get(n.id) ?? [],
      inputs,
    };
    const severity = check.nodes.get(n.id);
    if (severity) status.severity = severity;
    if (inputs > 1) status.join = n.join ? joinLabel(n.join, inputs) : null;
    if (n.type === 'pattern') {
      const ports: Record<string, number> = {};
      const used = { inputs: new Set<string>(), outputs: new Set<string>() };
      for (const e of graph.edges) {
        if (e.target.node === n.id && e.target.port) used.inputs.add(e.target.port);
        if (e.source.node === n.id && e.source.port) used.outputs.add(e.source.port);
      }
      for (const port of used.inputs) ports[port] = portInputs(graph, n.id, port, loops).length;
      status.portInputs = ports;
      status.usedPorts = { inputs: [...used.inputs], outputs: [...used.outputs] };
    }
    top.set(n.id, status);
  }
  return (id) => {
    const known = top.get(id);
    if (known) return known;
    const severity = check.nodes.get(id);
    const list = messages.get(id);
    if (!severity && !list) return NO_STATUS;
    return { messages: list ?? [], inputs: 0, ...(severity ? { severity } : {}) };
  };
}
