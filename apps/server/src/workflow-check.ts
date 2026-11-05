import {
  RepeatGroup,
  WorkflowGraph,
  checkWorkflow,
  flattenWorkflow,
  type Agent,
  type AgentRef,
  type EntityKind,
  type Pattern,
  type PatternRef,
  type ToolPreset,
  type ToolRef,
  type WorkflowProblem,
  type WorkflowResolver,
} from '@app/schema';
import { z } from 'zod';
import { NotFoundError, type LibraryStore } from './store/library-store.js';

/** Entity kinds whose content is a workflow graph checked by `checkWorkflow`. */
export const WORKFLOW_KINDS: ReadonlySet<EntityKind> = new Set(['project', 'template', 'pattern']);

/** A 400 listing workflow problems (uncapped loops on save, any error on merge). */
export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly problems: WorkflowProblem[],
  ) {
    super(message);
  }
}

const key = (ref: { id: string; version: string }) => `${ref.id}@${ref.version}`;

async function load<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

/** Every pattern the graph pins, and the patterns those nest, by `id@version`. */
async function loadPatterns(
  store: LibraryStore,
  graph: WorkflowGraph,
): Promise<Map<string, Pattern | null>> {
  const patterns = new Map<string, Pattern | null>();
  const queue: PatternRef[] = [];
  const enqueue = (g: WorkflowGraph) => {
    for (const n of g.nodes) if (n.type === 'pattern') queue.push(n.pattern);
  };
  enqueue(graph);
  for (let ref = queue.shift(); ref; ref = queue.shift()) {
    if (patterns.has(key(ref))) continue;
    const pattern = await load(() => store.get('pattern', ref.id, ref.version));
    patterns.set(key(ref), pattern);
    if (pattern) enqueue(pattern.workflow);
  }
  return patterns;
}

/**
 * Loads every pattern, agent and tool preset the graph pins (including inside its pattern
 * instances), so all rules can run. With `library: false` only patterns are loaded: enough for
 * the rules that block saving.
 */
export async function loadResolver(
  store: LibraryStore,
  graph: WorkflowGraph,
  opts: { library?: boolean } = {},
): Promise<WorkflowResolver> {
  const patterns = await loadPatterns(store, graph);
  const pattern = (ref: PatternRef) => patterns.get(key(ref));
  if (opts.library === false) {
    return { agent: () => undefined, tool: () => undefined, pattern };
  }

  const agents = new Map<string, Agent | null>();
  const tools = new Map<string, ToolPreset | null>();
  const agentRefs: AgentRef[] = [];
  const toolRefs: ToolRef[] = [];
  // The flat graph has the bound agents of every instance in place of its slots.
  for (const n of flattenWorkflow(graph, pattern).graph.nodes) {
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
    pattern,
  };
}

/** The graph (and for patterns the repeat groups) of a request body, if they parse. */
function graphOf(body: unknown): { graph: WorkflowGraph; repeat: RepeatGroup[] } | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const { workflow, repeat } = body as { workflow?: unknown; repeat?: unknown };
  const graph = WorkflowGraph.safeParse(workflow);
  if (!graph.success) return undefined; // The entity schema reports it.
  const groups = z.array(RepeatGroup).default([]).safeParse(repeat);
  return { graph: graph.data, repeat: groups.success ? groups.data : [] };
}

/**
 * Problems that block saving (uncapped loops, patterns containing themselves). Skipped when
 * the body isn't a valid graph.
 */
export async function checkSave(
  store: LibraryStore,
  kind: EntityKind,
  body: unknown,
  id?: string,
): Promise<void> {
  const parsed = graphOf(body);
  if (!parsed) return;
  const resolver = await loadResolver(store, parsed.graph, { library: false });
  const { problems } = checkWorkflow(parsed.graph, {
    kind: kind === 'pattern' ? 'pattern' : 'workflow',
    resolver,
    repeat: parsed.repeat,
    ...(id ? { selfId: id } : {}),
  });
  const blocking = problems.filter((p) => p.blocksSave);
  if (blocking.length > 0) {
    throw new WorkflowError(
      `Can’t save: ${blocking[0]?.message ?? 'the workflow has problems'}`,
      blocking,
    );
  }
}

/** Errors block merging: a published version must be complete. */
export async function checkMerge(
  store: LibraryStore,
  kind: EntityKind,
  id: string,
  entity: { workflow: WorkflowGraph; repeat?: RepeatGroup[] },
): Promise<void> {
  const resolver = await loadResolver(store, entity.workflow);
  const { problems } = checkWorkflow(entity.workflow, {
    kind: kind === 'pattern' ? 'pattern' : 'workflow',
    resolver,
    repeat: entity.repeat ?? [],
    selfId: id,
  });
  const errors = problems.filter((p) => p.severity === 'error');
  if (errors.length > 0) {
    throw new WorkflowError(
      `Can’t merge: ${errors.length === 1 ? 'there is 1 error' : `there are ${errors.length} errors`} in the ${kind === 'pattern' ? 'pattern' : 'workflow'}. ${errors[0]?.message ?? ''}`.trim(),
      errors,
    );
  }
}
