import {
  RepeatGroup,
  WorkflowGraph,
  checkWorkflow,
  flattenWorkflow,
  localOf,
  refKey,
  type DeletedRef,
  type Ref,
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
import { BadRequestError, NotFoundError, type LibraryStore } from './store/library-store.js';

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

/**
 * Entities that aren't in the library (yet): the content a cascade is about to write, keyed by
 * `refKey`. Looked up before the library.
 */
export type Overlay = ReadonlyMap<string, unknown>;

/**
 * Loads pinned entities: from the overlay, the library, or else the local copies of the
 * entities loaded so far (the workflow's own, then every pattern and agent it pins).
 * Null when the entity is gone.
 */
class Loader {
  private readonly copies = new Map<string, unknown>();
  private readonly deleted = new Map<string, DeletedRef>();

  constructor(
    private readonly store: LibraryStore,
    private readonly overlay: Overlay | undefined,
    local: unknown[],
  ) {
    for (const e of local) this.addLocal(e);
  }

  addLocal(entity: unknown): void {
    const { localCopies, deletedRefs } = localOf(entity);
    for (const [k, c] of Object.entries(localCopies)) this.copies.set(k, c.entity);
    for (const [k, d] of Object.entries(deletedRefs)) this.deleted.set(k, d);
  }

  async load<K extends 'agent' | 'tool' | 'pattern'>(
    ref: Ref & { kind: K },
  ): Promise<EntityOf<K> | null> {
    const k = refKey(ref);
    const pending = this.overlay?.get(k);
    if (pending) return pending as EntityOf<K>;
    try {
      return (await this.store.get(ref.kind, ref.id, ref.version)) as EntityOf<K>;
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      return (this.copies.get(k) as EntityOf<K> | undefined) ?? null;
    }
  }

  deletedRef = (ref: Ref): DeletedRef | undefined => this.deleted.get(refKey(ref));
}

interface EntityOfKind {
  agent: Agent;
  tool: ToolPreset;
  pattern: Pattern;
}
type EntityOf<K extends keyof EntityOfKind> = EntityOfKind[K];

/** Every pattern the graph pins, and the patterns those nest, by `id@version`. */
async function loadPatterns(
  loader: Loader,
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
    const pattern = await loader.load(ref);
    patterns.set(key(ref), pattern);
    if (pattern) {
      loader.addLocal(pattern);
      enqueue(pattern.workflow);
    }
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
  opts: {
    library?: boolean;
    /** The entity the graph belongs to (its local copies resolve deleted entities). */
    container?: unknown;
    overlay?: Overlay;
  } = {},
): Promise<WorkflowResolver> {
  const loader = new Loader(store, opts.overlay, opts.container ? [opts.container] : []);
  const patterns = await loadPatterns(loader, graph);
  const pattern = (ref: PatternRef) => patterns.get(key(ref));
  if (opts.library === false) {
    return { agent: () => undefined, tool: () => undefined, pattern, deleted: loader.deletedRef };
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
    const agent = await loader.load(ref);
    agents.set(key(ref), agent);
    if (agent) {
      loader.addLocal(agent);
      toolRefs.push(...agent.tools);
    }
  }
  for (const ref of toolRefs) {
    if (!tools.has(key(ref))) tools.set(key(ref), await loader.load(ref));
  }
  return {
    agent: (ref) => agents.get(key(ref)),
    tool: (ref) => tools.get(key(ref)),
    pattern,
    deleted: loader.deletedRef,
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
  const resolver = await loadResolver(store, parsed.graph, { library: false, container: body });
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
  const errors = await workflowErrors(store, kind, id, entity);
  if (errors.length > 0) {
    throw new WorkflowError(
      `Can’t merge: ${errors.length === 1 ? 'there is 1 error' : `there are ${errors.length} errors`} in the ${kind === 'pattern' ? 'pattern' : 'workflow'}. ${errors[0]?.message ?? ''}`.trim(),
      errors,
    );
  }
}

/** Every error of a workflow entity (what blocks merging), with an optional overlay. */
export async function workflowErrors(
  store: LibraryStore,
  kind: EntityKind,
  id: string,
  entity: { workflow: WorkflowGraph; repeat?: RepeatGroup[] },
  overlay?: Overlay,
): Promise<WorkflowProblem[]> {
  const resolver = await loadResolver(store, entity.workflow, {
    container: entity,
    ...(overlay ? { overlay } : {}),
  });
  const { problems } = checkWorkflow(entity.workflow, {
    kind: kind === 'pattern' ? 'pattern' : 'workflow',
    resolver,
    repeat: entity.repeat ?? [],
    selfId: id,
  });
  return problems.filter((p) => p.severity === 'error');
}

/**
 * A version on main must be complete: an agent can't be merged while it pins a skill or tool
 * preset that no longer exists (and isn't kept as a local copy).
 */
export async function checkAgentMerge(store: LibraryStore, agent: Agent): Promise<void> {
  const loader = new Loader(store, undefined, [agent]);
  const gone: string[] = [];
  for (const ref of [...agent.skills, ...agent.tools]) {
    let found: unknown;
    if (ref.kind === 'tool') found = await loader.load(ref);
    else {
      found = await store.get('skill', ref.id, ref.version).catch((err: unknown) => {
        if (err instanceof NotFoundError) return localOf(agent).localCopies[refKey(ref)] ?? null;
        throw err;
      });
    }
    if (!found) {
      const placeholder = loader.deletedRef(ref);
      gone.push(
        `${ref.kind === 'skill' ? 'skill' : 'tool preset'} ${placeholder ? `“${placeholder.name}”` : ref.id} (${ref.version})`,
      );
    }
  }
  if (gone.length > 0) {
    throw new BadRequestError(
      `Can’t merge: ${agent.name} uses ${gone.join(', ')}, which no longer ${gone.length === 1 ? 'exists' : 'exist'}. Remove ${gone.length === 1 ? 'it' : 'them'} first.`,
    );
  }
}
