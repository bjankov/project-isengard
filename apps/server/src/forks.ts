/**
 * Fork branches (PLAN.md 7.7, 8.2). A fork is a branch of an agent or pattern named
 * `fork-<container id>-<node id>`, pinned by one node of its container (a project, template or
 * pattern). The container owns it:
 * - a new container (a template saved from a project, a project started from a template) gets
 *   its own copies of the forks it pins
 * - forks the container no longer pins anywhere are deleted when it is saved, merged, discarded
 *   or deleted, unless some other entity on main still pins them
 */
import {
  DRAFT_BRANCH,
  collectRefs,
  forkBranchName,
  isBranchVersion,
  refKey,
  refLocations,
  repin,
  type EntityByKind,
  type EntityKind,
} from '@app/schema';
import type { RefOp } from './git.js';
import type { LibraryStore } from './store/library-store.js';

const FORK_KINDS: readonly EntityKind[] = ['agent', 'pattern'];
export const CONTAINER_KINDS: ReadonlySet<EntityKind> = new Set(['project', 'template', 'pattern']);

/** Whether a branch name is a fork owned by the container. */
export function ownedBy(branch: string, containerId: string): boolean {
  return branch.startsWith(`fork-${containerId}-`);
}

/**
 * For a container about to be created: give it its own copies of the forks it pins (branches
 * created at the same commits) and pin those instead. Called inside the create transaction.
 */
export async function adoptForks<K extends EntityKind>(
  store: LibraryStore,
  kind: K,
  id: string,
  entity: EntityByKind[K],
): Promise<{ entity: EntityByKind[K]; refOps: RefOp[] }> {
  if (!CONTAINER_KINDS.has(kind)) return { entity, refOps: [] };
  let next = entity;
  const refOps: RefOp[] = [];
  for (const loc of refLocations(kind, entity)) {
    const { ref, node } = loc;
    const forkable = (loc.role === 'agent' || loc.role === 'pattern') && node;
    if (!forkable || !isBranchVersion(ref.version) || ref.version === DRAFT_BRANCH) continue;
    if (ownedBy(ref.version, id)) continue;
    const head = await store.branchHead(ref.kind, ref.id, ref.version);
    if (!head) continue; // A fork that no longer exists stays missing.
    const branch = forkBranchName(id, node);
    refOps.push({ op: 'create', ref: store.branchRef(ref.kind, ref.id, branch), value: head });
    next = repin(kind, next, loc.key, branch);
  }
  return { entity: next, refOps };
}

/**
 * Ref ops deleting the forks a container owns that nothing pins any more: not its main version,
 * not any of its branches (a fork of a pattern pins that pattern's nested forks), and no other
 * entity on main. With `deleting`, the container's own refs don't count.
 */
export async function unusedForkOps(
  store: LibraryStore,
  kind: EntityKind,
  id: string,
  opts: { deleting?: boolean } = {},
): Promise<RefOp[]> {
  if (!CONTAINER_KINDS.has(kind)) return [];
  const owned = (await store.namedBranches(FORK_KINDS)).filter((f) => ownedBy(f.branch, id));
  if (owned.length === 0) return [];
  const pinned = new Set<string>();
  if (!opts.deleting) {
    const versions = [undefined, ...(await store.status(kind, id)).branches.map((b) => b.name)];
    for (const v of versions) {
      const entity = await store.get(kind, id, v);
      for (const r of collectRefs(kind, entity)) pinned.add(refKey(r));
    }
  }
  const ops: RefOp[] = [];
  for (const f of owned) {
    const key = refKey({ kind: f.kind, id: f.id, version: f.branch });
    if (pinned.has(key)) continue;
    const elsewhere = store
      .references(f.kind, f.id)
      .incoming.some((r) => r.version === f.branch && !(r.kind === kind && r.id === id));
    if (elsewhere) continue;
    ops.push({ op: 'delete', ref: store.branchRef(f.kind, f.id, f.branch), old: f.head });
  }
  return ops;
}

/** Delete the container's unused forks (after a save, merge or discard). */
export async function cleanupForks(
  store: LibraryStore,
  kind: EntityKind,
  id: string,
): Promise<void> {
  const ops = await unusedForkOps(store, kind, id);
  if (ops.length > 0) await store.updateRefs(ops);
}
