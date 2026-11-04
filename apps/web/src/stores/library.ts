import type { EntityByKind, EntityKind, EntityVersionSummary } from '@app/schema';
import { useEffect } from 'react';
import { create } from 'zustand';
import { api } from '@/lib/api';

type Lists = { [K in EntityKind]?: EntityByKind[K][] };
type Versions = Partial<Record<EntityKind, Record<string, EntityVersionSummary>>>;

interface LibraryStore {
  /** Entities as on main. */
  lists: Lists;
  /** Version and draft state per entity id. */
  versions: Versions;
  errors: Partial<Record<EntityKind, string>>;
  load: (kind: EntityKind) => Promise<void>;
  upsert: <K extends EntityKind>(kind: K, entity: EntityByKind[K]) => void;
  setVersion: (kind: EntityKind, id: string, version: EntityVersionSummary) => void;
  remove: (kind: EntityKind, id: string) => void;
}

const byName = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);

/** Client cache of complete library entities (as on main), one list per kind. */
export const useLibrary = create<LibraryStore>((set) => ({
  lists: {},
  versions: {},
  errors: {},
  load: async (kind) => {
    try {
      const { items, versions } = await api.list(kind);
      set((s) => ({
        lists: { ...s.lists, [kind]: items },
        versions: { ...s.versions, [kind]: versions },
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
  setVersion: (kind, id, version) =>
    set((s) => ({ versions: { ...s.versions, [kind]: { ...s.versions[kind], [id]: version } } })),
  remove: (kind, id) =>
    set((s) => {
      const list = (s.lists[kind] ?? []) as { id: string }[];
      return { lists: { ...s.lists, [kind]: list.filter((e) => e.id !== id) } };
    }),
}));

const NO_VERSIONS: Record<string, EntityVersionSummary> = {};

/** Version and draft state of every entity of a kind (empty until the list has loaded). */
export function useVersions(kind: EntityKind): Record<string, EntityVersionSummary> {
  return useLibrary((s) => s.versions[kind]) ?? NO_VERSIONS;
}

/** Entities of a kind; loads them on first use. `undefined` while loading. */
export function useEntities<K extends EntityKind>(kind: K): EntityByKind[K][] | undefined {
  const list = useLibrary((s) => s.lists[kind]) as EntityByKind[K][] | undefined;
  const load = useLibrary((s) => s.load);
  useEffect(() => {
    if (!list) void load(kind);
  }, [kind, list, load]);
  return list;
}
