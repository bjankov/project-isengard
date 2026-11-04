import { useCallback, useState } from 'react';

function read(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === 'true';
  } catch {
    return fallback;
  }
}

/** A per-browser boolean UI preference (e.g. "show advanced options"). */
export function useBooleanPreference(
  key: string,
  fallback = false,
): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => read(key, fallback));
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        localStorage.setItem(key, String(v));
      } catch {
        // Storage unavailable (private mode etc.): keep the in-memory value.
      }
    },
    [key],
  );
  return [value, set];
}
