/**
 * Deleting an entity that is still referenced (PLAN.md 8.4). Only references from main count
 * (the index reflects main); drafts and forks that pin the entity show it as missing.
 *
 * Every referencing entity gets a new main version in which the deleted entity is either kept
 * as a local copy (the pinned version's content, embedded) or replaced by a placeholder
 * (the reference stays and resolves to "deleted: <name>"). Their drafts get the same, so
 * merging them later keeps working. All of it is one ref transaction.
 */
import {
  DRAFT_BRANCH,
  collectRefs,
  entityKey,
  isReferrerKind,
  localCopyEntries,
  localOf,
  pruneLocal,
  refKey,
  withLocal,
  type AnyEntity,
  type DeleteRequest,
  type DeleteResolution,
  type DeleteWithReferencesResponse,
  type DeletedRef,
  type EntityByKind,
  type EntityKind,
  type LocalCopy,
  type Ref,
} from '@app/schema';
import { unusedForkOps } from './forks.js';
import {
  BadRequestError,
  NotFoundError,
  type BranchStep,
  type LibraryStore,
  type MainStep,
} from './store/library-store.js';

const RESOLUTIONS: readonly DeleteResolution[] = ['copy', 'placeholder'];

function parseResolutions(body: DeleteRequest | undefined): DeleteRequest {
  const all = body?.all;
  if (all !== undefined && !RESOLUTIONS.includes(all)) {
    throw new BadRequestError('"all" must be "copy" or "placeholder"');
  }
  const each: Record<string, DeleteResolution> = {};
  for (const [k, v] of Object.entries(body?.each ?? {})) {
    if (!RESOLUTIONS.includes(v))
      throw new BadRequestError(`"${k}" must be "copy" or "placeholder"`);
    each[k] = v;
  }
  return { ...(all ? { all } : {}), each };
}

/** Add what an entity needs for the deleted entity's pinned versions. */
function withResolved<K extends EntityKind>(
  kind: K,
  entity: EntityByKind[K],
  additions: { localCopies: Record<string, LocalCopy>; deletedRefs: Record<string, DeletedRef> },
): EntityByKind[K] {
  const { localCopies, deletedRefs } = localOf(entity);
  const { localCopies: _c, deletedRefs: _d, ...rest } = entity as Record<string, unknown>;
  const merged = {
    ...rest,
    ...withLocal(
      { ...localCopies, ...additions.localCopies },
      { ...deletedRefs, ...additions.deletedRefs },
    ),
  } as EntityByKind[K];
  return pruneLocal(kind, merged);
}

export async function deleteWithReferences(
  store: LibraryStore,
  kind: EntityKind,
  id: string,
  body: DeleteRequest | undefined,
): Promise<DeleteWithReferencesResponse> {
  const target = await store.get(kind, id);
  const choices = parseResolutions(body);
  const referrers = new Map<string, { kind: EntityKind; id: string }>();
  for (const r of store.references(kind, id).incoming) {
    if (!(r.kind === kind && r.id === id) && isReferrerKind(r.kind)) {
      referrers.set(entityKey(r.kind, r.id), r);
    }
  }
  const missing = [...referrers.keys()].filter((k) => !choices.each?.[k] && !choices.all);
  if (missing.length > 0) {
    throw new BadRequestError(`Choose what happens to ${missing.join(', ')}.`);
  }

  // Content of every pinned version of the deleted entity, read before it is gone.
  const contents = new Map<string, AnyEntity | null>();
  const contentOf = async (ref: Ref) => {
    const key = refKey(ref);
    if (!contents.has(key)) {
      contents.set(
        key,
        await store.get(ref.kind, ref.id, ref.version).catch((err: unknown) => {
          if (err instanceof NotFoundError) return null;
          throw err;
        }),
      );
    }
    return contents.get(key) ?? null;
  };

  const mainSteps: MainStep[] = [];
  const branchSteps: BranchStep[] = [];
  const updated: DeleteWithReferencesResponse['updated'] = [];
  const versions = await Promise.all([...referrers.values()].map((r) => store.versionMap(r.kind)));
  let i = 0;
  for (const [key, r] of referrers) {
    const vs = versions[i++]?.get(r.id);
    const resolution = choices.each?.[key] ?? choices.all ?? 'copy';
    const additions = {
      localCopies: {} as Record<string, LocalCopy>,
      deletedRefs: {} as Record<string, DeletedRef>,
    };
    const resolve = async (entity: AnyEntity) => {
      for (const ref of collectRefs(r.kind, entity as EntityByKind[typeof r.kind])) {
        if (ref.kind !== kind || ref.id !== id || additions.deletedRefs[refKey(ref)]) continue;
        if (additions.localCopies[refKey(ref)]) continue;
        const content = await contentOf(ref);
        if (resolution === 'copy' && content && ref.kind !== 'template' && ref.kind !== 'project') {
          const entries = localCopyEntries(ref, content as Parameters<typeof localCopyEntries>[1]);
          Object.assign(additions.localCopies, entries.localCopies);
          Object.assign(additions.deletedRefs, entries.deletedRefs);
        } else {
          additions.deletedRefs[refKey(ref)] = { name: content?.name ?? target.name };
        }
      }
    };
    const entity = await store.get(r.kind, r.id);
    await resolve(entity);
    const next = `v${String(Number((vs?.version ?? 'v0').slice(1)) + 1)}`;
    const what =
      resolution === 'copy'
        ? `Keeps a local copy of deleted ${kind} ${target.name}`
        : `Deleted ${kind} ${target.name} is now a placeholder`;
    mainSteps.push({
      kind: r.kind,
      id: r.id,
      entity: withResolved(r.kind, entity, additions),
      version: next,
      message: `Update ${r.kind} ${r.id} (${entity.name}) as ${next}\n\n${what}`,
    });
    updated.push({ kind: r.kind, id: r.id, version: next });
    if (vs?.hasDraft) {
      const draft = await store.get(r.kind, r.id, DRAFT_BRANCH);
      await resolve(draft);
      branchSteps.push({
        kind: r.kind,
        id: r.id,
        branch: DRAFT_BRANCH,
        entity: withResolved(r.kind, draft, additions),
        message: `Update ${r.kind} ${r.id} (${draft.name}) draft to ${next}\n\n${what}`,
        mainStep: mainSteps.length - 1,
      });
    }
  }

  const extraRefOps = [
    ...(await store.deleteBranchOps(kind, id)),
    ...(await unusedForkOps(store, kind, id, { deleting: true })),
  ];
  mainSteps.push({
    kind,
    id,
    entity: null,
    message: `Delete ${kind} ${id} (${target.name})`,
  });
  const { commits } = await store.applyBatch(mainSteps, branchSteps, extraRefOps);
  const commit = commits.at(-1);
  if (!commit) throw new Error('deleting produced no commit');
  return { commit, updated };
}
