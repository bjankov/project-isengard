import { useCallback, useEffect, useRef, useState } from 'react';

const DURATION = 260;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function read(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function write(key: string, value: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify([...value]));
  } catch {
    // View state only: losing it is harmless.
  }
}

/**
 * Which pattern instances are expanded (view state, per browser: never part of the saved
 * document, so expanding doesn't count as a change), and how far each one has opened while
 * it animates (0 closed … 1 open).
 */
export function useExpanded(storageKey: string): {
  expanded: ReadonlySet<string>;
  progress: ReadonlyMap<string, number>;
  toggle: (path: string) => void;
} {
  const [expanded, setExpanded] = useState(() => read(storageKey));
  const [progress, setProgress] = useState<ReadonlyMap<string, number>>(new Map());
  const frames = useRef(new Map<string, number>());

  useEffect(() => {
    const running = frames.current;
    return () => {
      for (const id of running.values()) cancelAnimationFrame(id);
    };
  }, []);

  const animate = useCallback((path: string, from: number, to: number, done?: () => void) => {
    const previous = frames.current.get(path);
    if (previous !== undefined) cancelAnimationFrame(previous);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const value = from + (to - from) * ease(t);
      setProgress((p) => new Map(p).set(path, value));
      if (t < 1) {
        frames.current.set(path, requestAnimationFrame(step));
      } else {
        frames.current.delete(path);
        setProgress((p) => {
          const next = new Map(p);
          next.delete(path);
          return next;
        });
        done?.();
      }
    };
    frames.current.set(path, requestAnimationFrame(step));
  }, []);

  const toggle = useCallback(
    (path: string) => {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (expanded.has(path)) {
        // Close it (and everything expanded inside it) once the animation ends.
        const close = () =>
          setExpanded((e) => {
            const next = new Set([...e].filter((p) => p !== path && !p.startsWith(`${path}/`)));
            write(storageKey, next);
            return next;
          });
        if (reduced) close();
        else animate(path, progress.get(path) ?? 1, 0, close);
      } else {
        setExpanded((e) => {
          const next = new Set(e).add(path);
          write(storageKey, next);
          return next;
        });
        if (!reduced) {
          setProgress((p) => new Map(p).set(path, 0));
          animate(path, 0, 1);
        }
      }
    },
    [expanded, progress, animate, storageKey],
  );

  return { expanded, progress, toggle };
}
