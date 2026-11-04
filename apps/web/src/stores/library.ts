import type { EntityByKind, EntityKind } from '@app/schema';
import { useEffect } from 'react';
import { create } from 'zustand';
import { api } from '@/lib/api';

type Lists = { [K in EntityKind]?: EntityByKind[K][] };

interface LibraryStore {
  lists: Lists;
  errors: Partial<Record<EntityKind, string>>;
  load: (kind: EntityKind) => Promise<void>;
  upsert: <K extends EntityKind>(kind: K, entity: EntityByKind[K]) => void;
  remove: (kind: EntityKind, id: string) => void;
}

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);

/** Client cache of complete library entities, one list per kind. */
export const useLibrary = create<LibraryStore>((set) => ({
  lists: {},
  errors: {},
  load: async (kind) => {
    try {
      const items = await api.list(kind);
      set((s) => ({
        lists: { ...s.lists, [kind]: items },
        errors: { ...s.errors, [kind]: undefined },
      }));
    } catch (err) {
      set((s) => ({
        errors: { ...s.errors, [kind]: err instanceof Error ? err.message : String(err) },
      }));
    }
  },
  upsert: (kind, entity) =>
    set((s) => {
      const list = (s.lists[kind] ?? []) as EntityByKind[typeof kind][];
      const next = [...list.filter((e) => e.id !== entity.id), entity].sort(byName);
      return { lists: { ...s.lists, [kind]: next } };
    }),
  remove: (kind, id) =>
    set((s) => {
      const list = (s.lists[kind] ?? []) as { id: string }[];
      return { lists: { ...s.lists, [kind]: list.filter((e) => e.id !== id) } };
    }),
}));

/** Entities of a kind; loads them on first use. `undefined` while loading. */
export function useEntities<K extends EntityKind>(kind: K): EntityByKind[K][] | undefined {
  const list = useLibrary((s) => s.lists[kind]) as EntityByKind[K][] | undefined;
  const load = useLibrary((s) => s.load);
  useEffect(() => {
    if (!list) void load(kind);
  }, [kind, list, load]);
  return list;
}
