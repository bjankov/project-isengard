import { isBranchVersion, type EntityByKind, type EntityKind } from '@app/schema';
import { useEffect } from 'react';
import { create } from 'zustand';
import { ApiError, api } from '@/lib/api';
import { omit } from '@/lib/same';

type Entry = { state: 'loading' } | { state: 'ready'; entity: unknown } | { state: 'missing' };

interface PinnedStore {
  entries: Record<string, Entry>;
  load: (kind: EntityKind, id: string, version: string) => Promise<void>;
  /** Forget branch versions (forks change when edited); main versions never change. */
  forgetBranches: () => void;
}

const keyOf = (kind: EntityKind, id: string, version: string) => `${kind}/${id}@${version}`;

/** Library entities at pinned versions, as referenced by workflow nodes. */
export const usePinnedStore = create<PinnedStore>((set, get) => ({
  entries: {},
  load: async (kind, id, version) => {
    const key = keyOf(kind, id, version);
    if (get().entries[key]) return;
    set((s) => ({ entries: { ...s.entries, [key]: { state: 'loading' } } }));
    try {
      const entity = await api.get(kind, id, version);
      set((s) => ({ entries: { ...s.entries, [key]: { state: 'ready', entity } } }));
    } catch (err) {
      const missing = err instanceof ApiError && err.status === 404;
      set((s) => ({
        entries: missing ? { ...s.entries, [key]: { state: 'missing' } } : omit(s.entries, key),
      }));
    }
  },
  forgetBranches: () =>
    set((s) => ({
      entries: Object.fromEntries(
        Object.entries(s.entries).filter(([k]) => !isBranchVersion(k.split('@')[1] ?? '')),
      ),
    })),
}));

export type Pinned<T> = { state: 'loading' } | { state: 'ready'; entity: T } | { state: 'missing' };

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
  if (entry.state === 'missing') return { state: 'missing' };
  return { state: 'ready', entity: entry.entity as EntityByKind[K] };
}
