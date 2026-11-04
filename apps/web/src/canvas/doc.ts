import type { Project, WorkflowEdge, WorkflowNode } from '@app/schema';
import { omit } from '@/lib/same';

/** The part of a project the canvas edits (everything but the id). */
export type ProjectDoc = Omit<Project, 'id'>;

/** Apply a change to the project; `key` coalesces repeated changes into one undo step. */
export type Change = (fn: (doc: ProjectDoc) => ProjectDoc, key?: string) => void;

export function updateNode(
  doc: ProjectDoc,
  id: string,
  fn: (n: WorkflowNode) => WorkflowNode,
): ProjectDoc {
  return {
    ...doc,
    workflow: {
      ...doc.workflow,
      nodes: doc.workflow.nodes.map((n) => (n.id === id ? fn(n) : n)),
    },
  };
}

export function updateEdge(
  doc: ProjectDoc,
  id: string,
  fn: (e: WorkflowEdge) => WorkflowEdge,
): ProjectDoc {
  return {
    ...doc,
    workflow: {
      ...doc.workflow,
      edges: doc.workflow.edges.map((e) => (e.id === id ? fn(e) : e)),
    },
  };
}

/** Remove nodes (with their edges, positions and overrides) and edges. */
export function removeItems(
  doc: ProjectDoc,
  nodeIds: Iterable<string>,
  edgeIds: Iterable<string>,
): ProjectDoc {
  const nodes = new Set(nodeIds);
  const edges = new Set(edgeIds);
  const positions = omit(doc.layout.nodes, ...nodes);
  const overrides = omit(doc.overrides, ...nodes);
  return {
    ...doc,
    overrides,
    layout: { ...doc.layout, nodes: positions },
    workflow: {
      nodes: doc.workflow.nodes.filter((n) => !nodes.has(n.id)),
      edges: doc.workflow.edges.filter(
        (e) => !edges.has(e.id) && !nodes.has(e.source.node) && !nodes.has(e.target.node),
      ),
    },
  };
}

/** Display name of a node for lists and edge descriptions. */
export function nodeTitle(node: WorkflowNode, agentNames: Record<string, string> = {}): string {
  if (node.label) return node.label;
  switch (node.type) {
    case 'input':
    case 'output':
    case 'sharedStore':
      return node.name;
    case 'agent':
      return node.binding.kind === 'agent'
        ? (agentNames[node.binding.agent.id] ?? node.binding.agent.id)
        : node.binding.role;
    case 'artifact':
      return node.path;
    case 'decision':
      return 'Decision';
    case 'toolStep':
      return 'Tool step';
    case 'humanInput':
      return 'Human input';
    case 'pattern':
      return 'Pattern';
    case 'note':
      return 'Note';
  }
}
