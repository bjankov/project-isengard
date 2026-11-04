import { useCallback, useRef, useState } from 'react';

const LIMIT = 200;
/** Changes with the same key within this window form one undo step (e.g. typing). */
const COALESCE_MS = 1200;

export interface UndoHistory<T> {
  /** Remember `before` as an undo step. Same `key` within a short window coalesces. */
  record: (before: T, key?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Undo/redo for one editing session over snapshots of a value. `current` is the live value
 * and `restore` replaces it. History survives saves and is lost on reload.
 */
export function useUndoHistory<T>(current: T, restore: (value: T) => void): UndoHistory<T> {
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);
  const last = useRef<{ key: string; at: number } | null>(null);

  const record = useCallback((before: T, key?: string) => {
    const now = Date.now();
    const prev = last.current;
    last.current = key ? { key, at: now } : null;
    if (key && prev && prev.key === key && now - prev.at < COALESCE_MS) return;
    setPast((p) => [...p.slice(-(LIMIT - 1)), before]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    const before = past.at(-1);
    if (before === undefined) return;
    last.current = null;
    setPast(past.slice(0, -1));
    setFuture((f) => [current, ...f]);
    restore(before);
  }, [past, current, restore]);

  const redo = useCallback(() => {
    const next = future[0];
    if (next === undefined) return;
    last.current = null;
    setFuture(future.slice(1));
    setPast((p) => [...p, current]);
    restore(next);
  }, [future, current, restore]);

  return { record, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}
