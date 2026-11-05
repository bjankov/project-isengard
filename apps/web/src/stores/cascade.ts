import type { CascadeRoot, EntityKind } from '@app/schema';
import { create } from 'zustand';
import { api } from '@/lib/api';

/** Kinds other entities can pin; only these can have a cascade. */
export const PINNABLE: ReadonlySet<EntityKind> = new Set(['skill', 'tool', 'agent', 'pattern']);

interface CascadeRequest {
  /** Distinguishes requests, so reopening loads a fresh preview. */
  seq: number;
  roots: CascadeRoot[];
  /** Why the dialog opened, e.g. "Skill “x” is now v2." */
  intro: string;
}

interface CascadeStore {
  request: CascadeRequest | undefined;
  /** Bumped after a cascade was applied, so views showing "users on older versions" refresh. */
  generation: number;
  open: (request: Omit<CascadeRequest, 'seq'>) => void;
  close: () => void;
  applied: () => void;
}

let seq = 0;

/** The cascade preview dialog (one, mounted in the app shell). */
export const useCascade = create<CascadeStore>((set) => ({
  request: undefined,
  generation: 0,
  open: (request) => set({ request: { ...request, seq: ++seq } }),
  close: () => set({ request: undefined }),
  applied: () => set((s) => ({ generation: s.generation + 1 })),
}));

/**
 * After a new main version (merge, promotion, deletion): open the cascade preview when anything
 * pins an older version. Quietly does nothing otherwise, or when the preview can't be loaded.
 */
export async function offerCascade(roots: CascadeRoot[], intro: string): Promise<void> {
  const pinnable = roots.filter((r) => PINNABLE.has(r.kind));
  if (pinnable.length === 0) return;
  try {
    const preview = await api.cascadePreview(pinnable);
    if (preview.cases.length > 0) useCascade.getState().open({ roots: pinnable, intro });
  } catch {
    // The editor header still offers "Update users…" later.
  }
}
