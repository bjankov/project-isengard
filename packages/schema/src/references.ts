/**
 * References between library entities: where an entity pins another (its "locations"),
 * re-pinning them, and local copies of deleted entities (PLAN.md 8). Pure, shared by the
 * server (cascade, deletion) and the web app (update badges, resolution).
 */
import type { Agent, AgentLocalCopy, DeletedRef } from './agent.js';
import type { EntityByKind, LocalCopy, Pattern } from './entities.js';
import { refKey, type EntityKind, type Ref } from './ids.js';
import type { Skill } from './skill.js';
import type { ToolPreset } from './tool.js';
import type { WorkflowGraph } from './workflow/graph.js';
import type { AgentBinding, WorkflowNode } from './workflow/nodes.js';
import { versionNumber } from './versioning.js';

/** Kinds that can reference other entities. */
export type ReferrerKind = 'agent' | 'pattern' | 'template' | 'project';
export const REFERRER_KINDS: readonly ReferrerKind[] = ['agent', 'pattern', 'template', 'project'];

export function isReferrerKind(kind: EntityKind): kind is ReferrerKind {
  return (REFERRER_KINDS as readonly string[]).includes(kind);
}

/** What a location is, for labels. */
export type LocationRole =
  | 'skill'
  | 'tool'
  | 'agent'
  | 'slotDefault'
  | 'evaluator'
  | 'evaluatorDefault'
  | 'toolStep'
  | 'pattern'
  | 'binding';

/**
 * One place where an entity pins another. `key` identifies it within the entity:
 * `skills/2`, `tools/0`, `node/<id>`, `node/<id>/evaluator`, `node/<id>/binding/<path>`.
 */
export interface RefLocation {
  key: string;
  ref: Ref;
  role: LocationRole;
  /** The workflow node it is on. */
  node?: string;
  /** For bindings: the slot path inside the pattern. */
  slot?: string;
}

function bindingLocation(
  b: AgentBinding,
  key: string,
  role: 'agent' | 'evaluator',
  extra: Partial<RefLocation>,
): RefLocation[] {
  if (b.kind === 'agent') return [{ key, ref: b.agent, role, ...extra }];
  if (b.defaultAgent) {
    return [
      {
        key,
        ref: b.defaultAgent,
        role: role === 'agent' ? 'slotDefault' : 'evaluatorDefault',
        ...extra,
      },
    ];
  }
  return [];
}

function nodeLocations(n: WorkflowNode): RefLocation[] {
  const key = `node/${n.id}`;
  switch (n.type) {
    case 'agent':
      return bindingLocation(n.binding, key, 'agent', { node: n.id });
    case 'decision':
      return n.evaluator.type === 'agent'
        ? bindingLocation(n.evaluator.agent, `${key}/evaluator`, 'evaluator', { node: n.id })
        : [];
    case 'toolStep':
      return [{ key, ref: n.tool, role: 'toolStep', node: n.id }];
    case 'pattern':
      return [
        { key, ref: n.pattern, role: 'pattern', node: n.id },
        ...Object.entries(n.bindings).flatMap(([path, b]) =>
          b.kind === 'agent'
            ? [
                {
                  key: `${key}/binding/${path}`,
                  ref: b.agent,
                  role: 'binding' as const,
                  node: n.id,
                  slot: path,
                },
              ]
            : [],
        ),
      ];
    default:
      return [];
  }
}

function graphOf(kind: EntityKind, entity: unknown): WorkflowGraph | undefined {
  return kind === 'pattern' || kind === 'template' || kind === 'project'
    ? (entity as { workflow: WorkflowGraph }).workflow
    : undefined;
}

/** Every place where an entity pins another entity (direct references, not local copies). */
export function refLocations(kind: EntityKind, entity: unknown): RefLocation[] {
  if (kind === 'agent') {
    const a = entity as Pick<Agent, 'skills' | 'tools'>;
    return [
      ...a.skills.map((ref, i) => ({ key: `skills/${String(i)}`, ref, role: 'skill' as const })),
      ...a.tools.map((ref, i) => ({ key: `tools/${String(i)}`, ref, role: 'tool' as const })),
    ];
  }
  return graphOf(kind, entity)?.nodes.flatMap(nodeLocations) ?? [];
}

function repinBinding(b: AgentBinding, version: string): AgentBinding {
  if (b.kind === 'agent') return { ...b, agent: { ...b.agent, version } };
  return b.defaultAgent ? { ...b, defaultAgent: { ...b.defaultAgent, version } } : b;
}

function repinNode(n: WorkflowNode, rest: string[], version: string): WorkflowNode {
  switch (n.type) {
    case 'agent':
      return rest.length === 0 ? { ...n, binding: repinBinding(n.binding, version) } : n;
    case 'decision':
      return rest[0] === 'evaluator' && n.evaluator.type === 'agent'
        ? { ...n, evaluator: { ...n.evaluator, agent: repinBinding(n.evaluator.agent, version) } }
        : n;
    case 'toolStep':
      return rest.length === 0 ? { ...n, tool: { ...n.tool, version } } : n;
    case 'pattern': {
      if (rest.length === 0) return { ...n, pattern: { ...n.pattern, version } };
      if (rest[0] !== 'binding') return n;
      const path = rest.slice(1).join('/');
      const b = n.bindings[path];
      return b ? { ...n, bindings: { ...n.bindings, [path]: repinBinding(b, version) } } : n;
    }
    default:
      return n;
  }
}

/** The entity with the reference at `location` pinned to `version` (same entity id). */
export function repin<K extends EntityKind>(
  kind: K,
  entity: EntityByKind[K],
  location: string,
  version: string,
): EntityByKind[K] {
  const [head, ...rest] = location.split('/');
  if (kind === 'agent' && (head === 'skills' || head === 'tools')) {
    const a = entity as Agent;
    const i = Number(rest[0]);
    const list = a[head];
    const ref = list[i];
    if (!ref) return entity;
    const next = list.map((r, j) => (j === i ? { ...r, version } : r));
    return { ...a, [head]: next } as EntityByKind[K];
  }
  const graph = graphOf(kind, entity);
  if (!graph || head !== 'node') return entity;
  const [nodeId, ...inner] = rest;
  const nodes = graph.nodes.map((n) => (n.id === nodeId ? repinNode(n, inner, version) : n));
  return { ...entity, workflow: { ...graph, nodes } } as EntityByKind[K];
}

/**
 * The entity with every reference re-pinned to `version(ref)`, where that returns a version
 * (e.g. the current version of a built-in pattern). Other references are left as they are.
 */
export function repinAll<K extends EntityKind>(
  kind: K,
  entity: EntityByKind[K],
  version: (ref: Ref) => string | undefined,
): EntityByKind[K] {
  let out = entity;
  for (const loc of refLocations(kind, entity)) {
    const v = version(loc.ref);
    if (v && v !== loc.ref.version) out = repin(kind, out, loc.key, v);
  }
  return out;
}

// ---- Local copies ----

type LocalCopies = Record<string, LocalCopy | AgentLocalCopy>;

/** The local copies and placeholders of an entity (empty for kinds without them). */
export function localOf(entity: unknown): {
  localCopies: LocalCopies;
  deletedRefs: Record<string, DeletedRef>;
} {
  const e = entity as { localCopies?: LocalCopies; deletedRefs?: Record<string, DeletedRef> };
  return { localCopies: e.localCopies ?? {}, deletedRefs: e.deletedRefs ?? {} };
}

/** Every outgoing reference from an entity, including those inside its local copies. */
export function collectRefs<K extends EntityKind>(kind: K, entity: EntityByKind[K]): Ref[] {
  const refs = refLocations(kind, entity).map((l) => l.ref);
  for (const copy of Object.values(localOf(entity).localCopies)) {
    refs.push(...refLocations(copy.kind, copy.entity).map((l) => l.ref));
  }
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = refKey(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The local copies and placeholders an entity still needs: those its references (and the
 * references of the copies it keeps) reach. Unused ones are dropped.
 */
export function pruneLocal<K extends EntityKind>(
  kind: K,
  entity: EntityByKind[K],
): EntityByKind[K] {
  const { localCopies, deletedRefs } = localOf(entity);
  if (Object.keys(localCopies).length === 0 && Object.keys(deletedRefs).length === 0) {
    return entity;
  }
  const reached = new Set<string>();
  const queue = refLocations(kind, entity).map((l) => refKey(l.ref));
  for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
    if (reached.has(key)) continue;
    reached.add(key);
    const copy = localCopies[key];
    if (copy) queue.push(...refLocations(copy.kind, copy.entity).map((l) => refKey(l.ref)));
  }
  const { localCopies: _c, deletedRefs: _d, ...rest } = entity as Record<string, unknown>;
  return {
    ...rest,
    ...withLocal(keep(localCopies, reached), keep(deletedRefs, reached)),
  } as EntityByKind[K];
}

function keep<T>(m: Record<string, T>, reached: ReadonlySet<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(m).filter(([k]) => reached.has(k)));
}

/** `localCopies` and `deletedRefs` fields, left out when empty (so files stay as they were). */
export function withLocal(
  localCopies: Record<string, unknown>,
  deletedRefs: Record<string, DeletedRef>,
): { localCopies?: never; deletedRefs?: Record<string, DeletedRef> } {
  return {
    ...(Object.keys(localCopies).length > 0 ? { localCopies: localCopies as never } : {}),
    ...(Object.keys(deletedRefs).length > 0 ? { deletedRefs } : {}),
  };
}

/** Resolution of references through local copies and placeholders. */
export interface LocalLookup {
  /** The local copy of a pinned entity, if some loaded entity keeps one. */
  copy<K extends 'skill' | 'tool' | 'agent' | 'pattern'>(
    ref: Ref & { kind: K },
  ): EntityByKind[K] | undefined;
  /** The placeholder of a deleted entity, if some loaded entity has one. */
  deleted(ref: Ref): DeletedRef | undefined;
}

/**
 * One lookup over the local copies of many entities. Pinned versions are immutable, so a copy
 * kept by any entity is exactly what every reference with the same key pins.
 */
export function localLookup(entities: Iterable<unknown>): LocalLookup {
  const copies = new Map<string, LocalCopy | AgentLocalCopy>();
  const deleted = new Map<string, DeletedRef>();
  for (const e of entities) {
    const local = localOf(e);
    for (const [k, c] of Object.entries(local.localCopies)) copies.set(k, c);
    for (const [k, d] of Object.entries(local.deletedRefs)) deleted.set(k, d);
  }
  return {
    copy: (ref) => {
      const c = copies.get(refKey(ref));
      if (!c || c.kind !== ref.kind) return undefined;
      return asEntity(c) as never;
    },
    deleted: (ref) => deleted.get(refKey(ref)),
  };
}

/** A local copy as a full entity (copies carry no local copies of their own). */
function asEntity(c: LocalCopy | AgentLocalCopy): Skill | ToolPreset | Agent | Pattern {
  return c.entity;
}

/**
 * Local copy entries for a deleted entity pinned at `ref`, ready to add to a referrer. The
 * entity's own local copies and placeholders move up next to it, so copies never nest.
 */
export function localCopyEntries(
  ref: Ref,
  entity: Skill | ToolPreset | Agent | Pattern,
): { localCopies: Record<string, LocalCopy>; deletedRefs: Record<string, DeletedRef> } {
  const { localCopies, deletedRefs } = localOf(entity);
  const { localCopies: _c, deletedRefs: _d, ...own } = entity as Agent & Pattern;
  let copy: LocalCopy;
  switch (ref.kind) {
    case 'skill':
      copy = { kind: 'skill', entity: entity as Skill };
      break;
    case 'tool':
      copy = { kind: 'tool', entity: entity as ToolPreset };
      break;
    case 'agent':
      copy = { kind: 'agent', entity: own as Agent };
      break;
    case 'pattern':
      copy = { kind: 'pattern', entity: own as Pattern };
      break;
    default:
      throw new Error(`a ${ref.kind} can't be kept as a local copy`);
  }
  return {
    localCopies: { ...(localCopies as Record<string, LocalCopy>), [refKey(ref)]: copy },
    deletedRefs,
  };
}

/** Whether `pinned` is a main version older than `current` (an update is available). */
export function isOutdated(pinned: string, current: string | null | undefined): boolean {
  const p = versionNumber(pinned);
  const c = current ? versionNumber(current) : undefined;
  return p !== undefined && c !== undefined && p < c;
}

/**
 * A short label for a location, e.g. `Node “Executor”` or `Slot “maker” of “Review”`.
 * `targetName` is the pinned entity's name (used when a node has no label of its own).
 */
export function locationLabel(
  kind: EntityKind,
  entity: unknown,
  loc: RefLocation,
  targetName: string,
): string {
  if (loc.role === 'skill') return 'Skill';
  if (loc.role === 'tool') return 'Tool preset';
  const node = graphOf(kind, entity)?.nodes.find((n) => n.id === loc.node);
  const own = node?.label;
  switch (loc.role) {
    case 'agent':
      return `Node “${own ?? targetName}”`;
    case 'slotDefault':
      return `Default agent of slot “${node?.type === 'agent' && node.binding.kind === 'slot' ? node.binding.role : (own ?? loc.node ?? '')}”`;
    case 'evaluator':
      return `Evaluator of “${own ?? 'Decision'}”`;
    case 'evaluatorDefault':
      return `Default evaluator of “${own ?? 'Decision'}”`;
    case 'toolStep':
      return `Tool step “${own ?? targetName}”`;
    case 'pattern':
      return `Pattern “${own ?? targetName}”`;
    case 'binding':
      return `Slot “${loc.slot ?? ''}” of “${own ?? loc.node ?? ''}”`;
  }
}
