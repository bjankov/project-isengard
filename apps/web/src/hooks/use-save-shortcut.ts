import { useEffect, useRef } from 'react';

/** Ctrl/Cmd+S runs `onSave` (also while focus is inside Monaco). */
export function useSaveShortcut(onSave: () => void) {
  const ref = useRef(onSave);
  useEffect(() => {
    ref.current = onSave;
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, []);
}
