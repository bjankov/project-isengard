import type { Pattern, PatternLookup, PatternRef } from '@app/schema';
import { useEffect, useMemo } from 'react';
import { usePinnedStore } from '@/stores/pinned';

const keyOf = (ref: PatternRef) => `pattern/${ref.id}@${ref.version}`;

/**
 * Pinned patterns and every pattern they nest, loaded on demand. `ready` once all of them have
 * arrived (or are known to be missing), so slots and ports can be listed completely.
 */
export function usePatternTree(roots: readonly PatternRef[]): {
  lookup: PatternLookup;
  ready: boolean;
} {
  const entries = usePinnedStore((s) => s.entries);
  const load = usePinnedStore((s) => s.load);

  const lookup = useMemo<PatternLookup>(
    () => (ref) => {
      const e = entries[keyOf(ref)];
      if (!e || e.state === 'loading') return undefined;
      return e.state === 'missing' ? null : (e.entity as Pattern);
    },
    [entries],
  );

  const { wanted, ready } = useMemo(() => {
    const wanted: PatternRef[] = [];
    const seen = new Set<string>();
    let ready = true;
    const visit = (ref: PatternRef) => {
      if (seen.has(keyOf(ref))) return;
      seen.add(keyOf(ref));
      const p = lookup(ref);
      if (p === undefined) {
        ready = false;
        wanted.push(ref);
        return;
      }
      if (p) for (const n of p.workflow.nodes) if (n.type === 'pattern') visit(n.pattern);
    };
    for (const r of roots) visit(r);
    return { wanted, ready };
  }, [roots, lookup]);

  useEffect(() => {
    for (const ref of wanted) {
      if (!usePinnedStore.getState().entries[keyOf(ref)]) void load('pattern', ref.id, ref.version);
    }
  }, [wanted, load]);

  return { lookup, ready };
}
