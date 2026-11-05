import { isBranchVersion, localOf, type EntityByKind, type EntityKind } from '@app/schema';
import { useEffect } from 'react';
import { create } from 'zustand';
import { ApiError, api } from '@/lib/api';
import { omit } from '@/lib/same';

/**
 * `local`: the entity was deleted from the library, and this is a local copy kept by the
 * workflow or agent that uses it (PLAN.md 8.4). `deleted`: a placeholder's last known name.
 */
type Entry =
  | { state: 'loading' }
  | { state: 'ready'; entity: unknown; local?: true }
  | { state: 'missing'; deleted?: string };

interface PinnedStore {
  entries: Record<string, Entry>;
  /** Local copies and placeholders of every loaded or registered entity, by ref key. */
  copies: Record<string, unknown>;
  deleted: Record<string, string>;
  load: (kind: EntityKind, id: string, version: string) => Promise<void>;
  /**
   * Make an entity's local copies and placeholders resolvable (the open workflow or agent; the
   * pinned agents and patterns register theirs when they load). Pinned versions are immutable,
   * so a copy kept anywhere is what every reference with the same key pins.
   */
  registerLocal: (entity: unknown) => void;
  /** Forget branch versions (forks change when edited); main versions never change. */
  forgetBranches: () => void;
}

const keyOf = (kind: EntityKind, id: string, version: string) => `${kind}/${id}@${version}`;

/** What a library 404 resolves to, given the known copies and placeholders. */
function fallback(s: Pick<PinnedStore, 'copies' | 'deleted'>, key: string): Entry {
  const copy = s.copies[key];
  if (copy) return { state: 'ready', entity: copy, local: true };
  const deleted = s.deleted[key];
  return deleted === undefined ? { state: 'missing' } : { state: 'missing', deleted };
}

/** Library entities at pinned versions, as referenced by workflow nodes. */
export const usePinnedStore = create<PinnedStore>((set, get) => ({
  entries: {},
  copies: {},
  deleted: {},
  load: async (kind, id, version) => {
    const key = keyOf(kind, id, version);
    if (get().entries[key]) return;
    set((s) => ({ entries: { ...s.entries, [key]: { state: 'loading' } } }));
    try {
      const entity = await api.get(kind, id, version);
      get().registerLocal(entity);
      set((s) => ({ entries: { ...s.entries, [key]: { state: 'ready', entity } } }));
    } catch (err) {
      const missing = err instanceof ApiError && err.status === 404;
      set((s) => ({
        entries: missing ? { ...s.entries, [key]: fallback(s, key) } : omit(s.entries, key),
      }));
    }
  },
  registerLocal: (entity) => {
    const { localCopies, deletedRefs } = localOf(entity);
    const s = get();
    const newCopies = Object.entries(localCopies).filter(([k]) => !s.copies[k]);
    const newDeleted = Object.entries(deletedRefs).filter(([k]) => s.deleted[k] === undefined);
    if (newCopies.length === 0 && newDeleted.length === 0) return;
    set((st) => {
      const copies = { ...st.copies };
      for (const [k, c] of newCopies) copies[k] = c.entity;
      const deleted = { ...st.deleted };
      for (const [k, d] of newDeleted) deleted[k] = d.name;
      // Entries that came back missing before the copy was known resolve now.
      const entries = { ...st.entries };
      for (const [k, e] of Object.entries(entries)) {
        if (e.state === 'missing') entries[k] = fallback({ copies, deleted }, k);
      }
      for (const [k, c] of newCopies) {
        const e = entries[k];
        if (e?.state === 'ready' && e.local) entries[k] = { ...e, entity: c.entity };
      }
      return { copies, deleted, entries };
    });
  },
  forgetBranches: () =>
    set((s) => ({
      entries: Object.fromEntries(
        Object.entries(s.entries).filter(([k]) => !isBranchVersion(k.split('@')[1] ?? '')),
      ),
    })),
}));

export type Pinned<T> =
  | { state: 'loading' }
  | { state: 'ready'; entity: T; local?: true }
  | { state: 'missing'; deleted?: string };

/** The entity at a pinned version (loaded on first use). */
export function usePinned<K extends EntityKind>(
  kind: K,
  id: string | undefined,
  version: string | undefined,
): Pinned<EntityByKind[K]> {
  const key = id && version ? keyOf(kind, id, version) : undefined;
  const entry = usePinnedStore((s) => (key ? s.entries[key] : undefined));
  const load = usePinnedStore((s) => s.load);
  useEffect(() => {
    if (id && version && !entry) void load(kind, id, version);
  }, [kind, id, version, entry, load]);
  if (!entry || entry.state === 'loading') return { state: 'loading' };
  if (entry.state === 'missing') return entry;
  return entry as Pinned<EntityByKind[K]>;
}

/** Register an entity's local copies while it is shown (see `registerLocal`). */
export function useRegisterLocal(entity: { localCopies?: unknown; deletedRefs?: unknown }): void {
  const register = usePinnedStore((s) => s.registerLocal);
  const { localCopies, deletedRefs } = entity;
  useEffect(() => {
    if (localCopies || deletedRefs) register({ localCopies, deletedRefs });
  }, [register, localCopies, deletedRefs]);
}
