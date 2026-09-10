'use client';

/**
 * Motion primitives for the analytics charts.
 *
 * Three concerns, one file, because they are always used together: a chart
 * needs to know how wide it may draw (`useMeasure`), whether the reader can
 * actually see it yet (`useInView`), and how to walk a number to its value
 * once they can (`useCountUp`).
 *
 * REDUCED MOTION
 * globals.css already kills every CSS animation and transition inside
 * `.air-scope` under `prefers-reduced-motion: reduce`. That rule cannot reach
 * JavaScript, so `useCountUp` checks the same query itself and snaps straight
 * to the target. Without this the CSS-driven bars would sit still while the
 * numbers beside them counted up — worse than either extreme.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';

export function usePrefersReducedMotion(): boolean {
  // `false` on the server and on first paint, so the markup React renders
  // matches what it hydrates; the effect corrects it before anything animates.
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(REDUCED);
    setReduced(mq.matches);

    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * Element width in CSS pixels, tracked through resizes.
 *
 * The charts draw at real pixel coordinates rather than through a scaled
 * viewBox: `preserveAspectRatio="none"` would stretch a 2px stroke into an
 * ellipse and make label text lie about its own size. Measuring costs one
 * observer and keeps every stroke honest.
 */
export function useMeasure<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Seed from the current layout so the first paint after mount already has
    // a real width; the observer only handles later changes.
    setWidth(el.clientWidth);

    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      // Sub-pixel churn from the layout engine would re-render on every frame
      // during a window drag; whole pixels are all a chart can draw anyway.
      setWidth((prev) => (Math.abs(prev - w) < 1 ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}

/**
 * True once the element has been on screen. Latches — a panel that scrolls
 * back out does not replay its entrance, which would turn a long page into a
 * flicker reel on the way back up.
 */
export function useInView<T extends HTMLElement>(threshold = 0.2): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // No IntersectionObserver: show the finished state rather than an empty
    // chart that never fills in.
    if (typeof IntersectionObserver !== 'function') {
      setSeen(true);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  return [ref, seen];
}

/**
 * Walks a number from 0 to `target` on an ease-out curve.
 *
 * Held at 0 until `active`, so a score that scrolls into view counts up with
 * its bar instead of having finished before the reader arrived.
 */
export function useCountUp(
  target: number,
  { duration = 900, active = true }: { duration?: number; active?: boolean } = {},
): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(0);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!active) return;

    if (reduced || duration <= 0) {
      setValue(target);
      return;
    }

    const start = performance.now();
    const from = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [target, duration, active, reduced]);

  return value;
}
