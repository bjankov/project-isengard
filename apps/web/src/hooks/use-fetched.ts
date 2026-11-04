import { useEffect, useEffectEvent, useState } from 'react';

export interface Fetched<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
}

/**
 * Fetch data for `key` (skipped while `key` is undefined). A new key refetches; results of
 * an outdated key are ignored.
 */
export function useFetched<T>(key: string | undefined, fetcher: () => Promise<T>): Fetched<T> {
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>();
  const run = useEffectEvent(fetcher);

  useEffect(() => {
    if (key === undefined) return;
    let cancelled = false;
    run().then(
      (data) => !cancelled && setState({ key, data }),
      (err: unknown) =>
        !cancelled && setState({ key, error: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const current = state?.key === key ? state : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: key !== undefined && !current,
  };
}
