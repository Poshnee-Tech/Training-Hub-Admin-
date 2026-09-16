'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * POLL QUIETLY: refetch in the background, re-render only when the data changed.
 *
 * Pages that watch live state (the floor view, an agent's breaks) refetch on
 * a timer. Setting state on every tick would re-render and re-animate the
 * page every few seconds even when nothing happened. This compares a
 * signature of each response with the last one and only hands a NEW value to
 * React when they differ, so the screen changes exactly when there is a new
 * entry. Polling pauses while the tab is hidden and runs once as soon as it is
 * shown again.
 *
 * `signatureOf` lets a caller ignore fields that change on every response
 * (e.g. a server timestamp).
 */
export function useQuietPoll<T>(
  fetcher: (() => Promise<T>) | null,
  intervalMs: number,
  signatureOf: (value: T) => string = (value) => JSON.stringify(value),
): { data: T | null; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastSignature = useRef<string | null>(null);
  const fetcherRef = useRef(fetcher);
  const signatureRef = useRef(signatureOf);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    fetcherRef.current = fetcher;
    signatureRef.current = signatureOf;
  });

  const hasFetcher = fetcher !== null;

  useEffect(() => {
    if (!hasFetcher) return;
    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      const run = fetcherRef.current;
      if (!run || inFlight || cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const value = await run();
        if (cancelled) return;
        const signature = signatureRef.current(value);
        if (signature !== lastSignature.current) {
          lastSignature.current = signature;
          setData(value);
        }
        setError((previous) => (previous === null ? previous : null));
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Could not refresh';
          setError((previous) => (previous === message ? previous : message));
        }
      } finally {
        inFlight = false;
      }
    };

    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hasFetcher, intervalMs, refreshTick]);

  return { data, error, refresh: () => setRefreshTick((n) => n + 1) };
}
