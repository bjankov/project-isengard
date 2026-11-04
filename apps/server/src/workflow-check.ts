import {
  WorkflowGraph,
  validateWorkflow,
  type Agent,
  type AgentRef,
  type ToolPreset,
  type ToolRef,
  type WorkflowProblem,
  type WorkflowResolver,
} from '@app/schema';
import { NotFoundError, type LibraryStore } from './store/library-store.js';

/** Entity kinds whose content is a workflow graph checked by `validateWorkflow`. */
export const WORKFLOW_KINDS = new Set(['project', 'template']);

/** A 400 listing workflow problems (uncapped loops on save, any error on merge). */
export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly problems: WorkflowProblem[],
  ) {
    super(message);
  }
}

/** Problems that block saving (uncapped loops). Skipped when the body isn't a valid graph. */
export function checkSave(body: unknown): void {
  const workflow =
    body && typeof body === 'object' ? (body as { workflow?: unknown }).workflow : undefined;
  const graph = WorkflowGraph.safeParse(workflow);
  if (!graph.success) return; // The entity schema reports it.
  const blocking = validateWorkflow(graph.data).filter((p) => p.blocksSave);
  if (blocking.length > 0) {
    throw new WorkflowError(
      `Can’t save: ${blocking[0]?.message ?? 'the workflow has problems'}`,
      blocking,
    );
  }
}

/** Loads every agent and tool preset the graph pins, so all rules can run. */
export async function loadResolver(
  store: LibraryStore,
  graph: WorkflowGraph,
): Promise<WorkflowResolver> {
  const key = (ref: { id: string; version: string }) => `${ref.id}@${ref.version}`;
  const agents = new Map<string, Agent | null>();
  const tools = new Map<string, ToolPreset | null>();
  const load = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  };

  const agentRefs: AgentRef[] = [];
  const toolRefs: ToolRef[] = [];
  for (const n of graph.nodes) {
    if (n.type === 'agent' && n.binding.kind === 'agent') agentRefs.push(n.binding.agent);
    if (n.type === 'decision' && n.evaluator.type === 'agent' && n.evaluator.agent.kind === 'agent')
      agentRefs.push(n.evaluator.agent.agent);
    if (n.type === 'toolStep') toolRefs.push(n.tool);
  }
  for (const ref of agentRefs) {
    if (agents.has(key(ref))) continue;
    const agent = await load(() => store.get('agent', ref.id, ref.version));
    agents.set(key(ref), agent);
    if (agent) toolRefs.push(...agent.tools);
  }
  for (const ref of toolRefs) {
    if (!tools.has(key(ref)))
      tools.set(key(ref), await load(() => store.get('tool', ref.id, ref.version)));
  }
  return {
    agent: (ref) => agents.get(key(ref)),
    tool: (ref) => tools.get(key(ref)),
  };
}

/** Errors block merging: a published version must be complete. */
export async function checkMerge(store: LibraryStore, entity: { workflow: WorkflowGraph }) {
  const resolver = await loadResolver(store, entity.workflow);
  const errors = validateWorkflow(entity.workflow, resolver).filter((p) => p.severity === 'error');
  if (errors.length > 0) {
    throw new WorkflowError(
      `Can’t merge: ${errors.length === 1 ? 'there is 1 error' : `there are ${errors.length} errors`} in the workflow. ${errors[0]?.message ?? ''}`.trim(),
      errors,
    );
  }
}
