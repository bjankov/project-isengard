import type {
  EntityInput,
  Pattern,
  Project,
  RepeatGroup,
  WorkflowEdge,
  WorkflowNode,
} from '@app/schema';
import { omit } from '@/lib/same';

/** What a canvas edits: a project's workflow, or a pattern's. */
export type CanvasKind = 'project' | 'pattern';

/**
 * The document a canvas edits (everything but the id), the same shape for both kinds so the
 * canvas code is shared. A pattern has no overrides or workspace (`{}` and `''` here); a
 * project has no repeat groups (`[]`). `toDoc` and `fromDoc` convert from and to the stored
 * entity, so nothing extra is saved.
 */
export type WorkflowDoc = Omit<Project, 'id'> & { repeat: RepeatGroup[] };

export function toDoc(kind: CanvasKind, entity: EntityInput<CanvasKind>): WorkflowDoc {
  // Editor drafts start from parsed entities, so every defaulted field is present.
  if (kind === 'project') return { ...(entity as unknown as Omit<Project, 'id'>), repeat: [] };
  const p = entity as unknown as Omit<Pattern, 'id'>;
  return { ...p, overrides: {}, workspacePath: '' };
}

export function fromDoc(kind: CanvasKind, doc: WorkflowDoc): EntityInput<CanvasKind> {
  const { repeat, overrides, workspacePath, ...common } = doc;
  return kind === 'project'
    ? { ...common, overrides, workspacePath }
    : ({ ...common, repeat } as EntityInput<'pattern'>);
}

/** Apply a change to the document; `key` coalesces repeated changes into one undo step. */
export type Change = (fn: (doc: WorkflowDoc) => WorkflowDoc, key?: string) => void;

export function updateNode(
  doc: WorkflowDoc,
  id: string,
  fn: (n: WorkflowNode) => WorkflowNode,
): WorkflowDoc {
  return {
    ...doc,
    workflow: {
      ...doc.workflow,
      nodes: doc.workflow.nodes.map((n) => (n.id === id ? fn(n) : n)),
    },
  };
}

export function updateEdge(
  doc: WorkflowDoc,
  id: string,
  fn: (e: WorkflowEdge) => WorkflowEdge,
): WorkflowDoc {
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
  doc: WorkflowDoc,
  nodeIds: Iterable<string>,
  edgeIds: Iterable<string>,
): WorkflowDoc {
  const nodes = new Set(nodeIds);
  const edges = new Set(edgeIds);
  const positions = omit(doc.layout.nodes, ...nodes);
  // Overrides of a removed instance's inner agents (`<node>/…`) go with it.
  const overrides = Object.fromEntries(
    Object.entries(doc.overrides).filter(([key]) => !nodes.has(key.split('/')[0] ?? key)),
  );
  // Removed nodes leave their repeat groups; empty groups are removed.
  const repeat = doc.repeat
    .map((g) => ({ ...g, nodes: g.nodes.filter((id) => !nodes.has(id)) }))
    .filter((g) => g.nodes.length > 0);
  return {
    ...doc,
    overrides,
    repeat,
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
export function nodeTitle(
  node: WorkflowNode,
  agentNames: Record<string, string> = {},
  patternNames: Record<string, string> = {},
): string {
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
      return patternNames[node.pattern.id] ?? 'Pattern';
    case 'note':
      return 'Note';
  }
}
