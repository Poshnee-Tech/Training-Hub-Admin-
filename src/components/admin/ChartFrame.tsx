'use client';

/**
 * The chrome every analytics chart sits in: title, legend, table toggle.
 *
 * Pulled out so the three charts cannot drift into three different ideas of
 * where a legend goes or what a panel header looks like — and so the table
 * view is structural rather than something each chart remembers to add.
 *
 * WHY A TABLE VIEW
 * A tooltip enhances, it never gates. Every number these charts draw has to be
 * reachable without a pointer — for a screen reader, for anyone who cannot
 * hover, and for the admin who wants to copy a column into a message. The
 * toggle is the cheapest honest way to guarantee that, and it doubles as the
 * answer to "what exactly was that spike on the 14th".
 */

import { useId, useState } from 'react';

export type LegendKey = {
  label: string;
  color: string;
  /** `line` for a stroked series, `dot` for scattered points, `rect` for fills. */
  shape?: 'line' | 'dot' | 'rect';
};

export default function ChartFrame({
  title,
  subtitle,
  legend,
  table,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  legend?: LegendKey[];
  /** Rendered inside the panel when the reader switches to the table view. */
  table?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  return (
    <section className="air-panel rounded-[20px] border p-6 backdrop-blur-lg">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="font-display text-[20px] font-bold leading-tight tracking-[-0.02em] text-air-text">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-air-muted">
              {subtitle}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-4">
          {action}

          {/* A legend is always present for two or more series — identity can
              never rest on colour alone. One series needs none: the title
              already says what is plotted, and a lone swatch just repeats it. */}
          {legend && legend.length > 1 && (
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {legend.map((key) => (
                <li key={key.label} className="flex items-center gap-2">
                  <LegendMark shape={key.shape ?? 'line'} color={key.color} />
                  <span className="text-[11.5px] font-medium text-air-muted">{key.label}</span>
                </li>
              ))}
            </ul>
          )}

          {table && (
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              aria-expanded={showTable}
              aria-controls={tableId}
              className="air-hairline shrink-0 rounded-full border px-3 py-1.5 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.14em] text-air-muted transition hover:border-air-signal/40 hover:text-air-text"
            >
              {showTable ? 'Chart' : 'Table'}
            </button>
          )}
        </div>
      </header>

      {/* The chart stays mounted behind the table rather than unmounting, so
          toggling back does not replay every entrance animation. */}
      <div className={showTable ? 'hidden' : undefined}>{children}</div>

      {table && (
        <div id={tableId} className={showTable ? 'max-h-[420px] overflow-auto' : 'hidden'}>
          {table}
        </div>
      )}
    </section>
  );
}

/** The legend mirrors the mark: a stroke for lines, a disc for scattered points. */
function LegendMark({ shape, color }: { shape: 'line' | 'dot' | 'rect'; color: string }) {
  if (shape === 'line') {
    return (
      <span
        aria-hidden
        className="h-[3px] w-4 shrink-0 rounded-full"
        style={{ background: color }}
      />
    );
  }
  if (shape === 'dot') {
    return (
      <span
        aria-hidden
        className="h-[9px] w-[9px] shrink-0 rounded-full"
        style={{ background: color }}
      />
    );
  }
  return (
    <span aria-hidden className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: color }} />
  );
}

/**
 * Floating readout. Values lead and labels follow — the reader already knows
 * which series they are chasing; what they came for is the number.
 *
 * Positioned against the plot's own box and clamped to it, so a tooltip near
 * the right edge slides inward instead of pushing the panel wider.
 */
export function ChartTooltip({
  x,
  y,
  width,
  title,
  rows,
  footer,
}: {
  x: number;
  y: number;
  width: number;
  title: string;
  rows: Array<{ label: string; value: string; color?: string }>;
  footer?: string;
}) {
  const CARD = 176;
  const half = CARD / 2;
  const left = Math.max(half, Math.min(width - half, x));

  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full"
      style={{ left, top: Math.max(0, y - 14), width: CARD }}
      role="status"
      aria-live="polite"
    >
      <div className="air-panel rounded-[13px] border p-3 shadow-[0_18px_40px_-20px_rgba(0,0,0,.7)] backdrop-blur-xl">
        <p className="font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.14em] text-air-faint">
          {title}
        </p>

        <ul className="mt-2 space-y-1.5">
          {rows.map((row) => (
            <li key={row.label} className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5">
                {row.color && (
                  <span
                    aria-hidden
                    className="h-[3px] w-2.5 shrink-0 rounded-full"
                    style={{ background: row.color }}
                  />
                )}
                <span className="truncate text-[11px] text-air-muted">{row.label}</span>
              </span>
              <span className="shrink-0 font-display text-[14px] font-extrabold tabular-nums text-air-text">
                {row.value}
              </span>
            </li>
          ))}
        </ul>

        {footer && (
          <p className="mt-2 border-t border-air-line/12 pt-2 font-mono-ui text-[9px] uppercase tracking-[0.1em] text-air-faint">
            {footer}
          </p>
        )}
      </div>
    </div>
  );
}

/** Shared empty state, so a quiet window never reads as a broken panel. */
export function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[180px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-air-line/15 text-center">
      <p className="text-[13px] text-air-muted">{children}</p>
    </div>
  );
}

/**
 * Indices to label along a categorical x axis.
 *
 * The last position always gets a label — a time axis whose right end is
 * unlabelled makes the reader count backwards to find out when "now" is — and
 * any tick that would crowd it is dropped rather than drawn. Placing ticks on
 * a fixed stride and separately forcing the final one is what produced
 * overlapping dates at the right edge before this existed.
 */
export function axisTicks(n: number, count = 5): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];

  const last = n - 1;
  const step = Math.max(1, Math.round(last / Math.max(1, count - 1)));

  const ticks: number[] = [];
  for (let i = 0; i < last; i += step) ticks.push(i);
  while (ticks.length && last - ticks[ticks.length - 1] < step * 0.6) ticks.pop();
  ticks.push(last);

  return ticks;
}
