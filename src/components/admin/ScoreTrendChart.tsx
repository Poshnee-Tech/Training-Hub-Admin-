'use client';

/**
 * Team score over the last 30 days.
 *
 * WHAT CHANGED AND WHY
 * The panel this replaces drew one bar per evaluation, side by side. That is a
 * chart of row order, not of time: fifty calls in one busy afternoon occupied
 * fifty times the width of a quiet week, so the shape of the bars said more
 * about when the floor was busy than about whether it was improving. Averaging
 * into calendar days and drawing a real time axis is the whole fix.
 *
 * TWO SERIES, TWO JOBS
 *   · Daily average — scattered dots, deliberately not joined. A gap in the
 *     dots is a day nobody was scored, and joining across it would draw a
 *     trend through days that produced no data.
 *   · 7-day average — the line the reader should actually follow. Daily means
 *     off a small floor swing 20 points on one bad call; the trailing mean is
 *     what shows whether coaching is landing.
 * They are told apart by shape and by the legend, never by hue alone — the
 * console's bright theme is a warm monochrome where two accent colours are
 * genuinely hard to separate.
 *
 * The band tints behind the plot (on target / developing / needs work) are the
 * same thresholds RadialGauge uses. They sit at a few percent opacity so the
 * reader can see which band the line is in without reading the axis, and still
 * never compete with the data.
 */

import { useMemo, useState } from 'react';
import ChartFrame, { ChartEmpty, ChartTooltip, axisTicks } from './ChartFrame';
import { useInView, useMeasure } from '@/lib/use-chart-motion';
import { monotonePath } from '@/lib/chart-path';
import type { DayPoint } from '@/lib/analytics-series';

const H = 268;
const PAD = { top: 16, right: 62, bottom: 30, left: 40 };
const TARGET = 80;

const INK = {
  trailing: 'rgb(var(--air-signal))',
  daily: 'rgb(var(--air-cyan))',
};

export default function ScoreTrendChart({ days }: { days: DayPoint[] }) {
  const [wrapRef, width] = useMeasure<HTMLDivElement>();
  const [viewRef, inView] = useInView<HTMLDivElement>(0.25);
  const [hover, setHover] = useState<number | null>(null);

  const scored = days.filter((d) => d.avg !== null);

  const geom = useMemo(() => {
    const innerW = Math.max(0, width - PAD.left - PAD.right);
    const innerH = H - PAD.top - PAD.bottom;
    const n = days.length;

    const x = (i: number) => (n > 1 ? PAD.left + (i / (n - 1)) * innerW : PAD.left + innerW / 2);
    const y = (v: number) => PAD.top + (1 - Math.max(0, Math.min(100, v)) / 100) * innerH;

    // Runs of consecutive days that have a trailing mean. Quiet stretches drop
    // below the minimum sample and break the line rather than bridging it.
    const runs: Array<Array<{ x: number; y: number }>> = [];
    let run: Array<{ x: number; y: number }> = [];
    days.forEach((d, i) => {
      if (d.trailing === null) {
        if (run.length) runs.push(run);
        run = [];
        return;
      }
      run.push({ x: x(i), y: y(d.trailing) });
    });
    if (run.length) runs.push(run);

    const dots = days
      .map((d, i) => (d.avg === null ? null : { i, x: x(i), y: y(d.avg), value: d.avg }))
      .filter((p): p is { i: number; x: number; y: number; value: number } => p !== null);

    const lastTrailing = [...days].reverse().find((d) => d.trailing !== null) ?? null;

    return { innerW, innerH, x, y, runs, dots, lastTrailing };
  }, [days, width]);

  if (!scored.length) {
    return (
      <ChartFrame
        title="Score trend"
        subtitle="Team average overall score across the last 30 days."
      >
        <ChartEmpty>No calls have been scored in the last 30 days yet.</ChartEmpty>
      </ChartFrame>
    );
  }

  const { innerW, innerH, x, y, runs, dots, lastTrailing } = geom;
  const active = hover !== null ? days[hover] : null;

  const ticks = axisTicks(days.length);

  const move = (clientX: number, rect: DOMRect) => {
    if (innerW <= 0) return;
    const px = clientX - rect.left - PAD.left;
    const step = innerW / Math.max(1, days.length - 1);
    setHover(Math.max(0, Math.min(days.length - 1, Math.round(px / step))));
  };

  return (
    <ChartFrame
      title="Score trend"
      subtitle="Each dot is one day's average. Follow the solid line — it smooths out single bad calls and shows whether the floor is actually moving."
      legend={[
        { label: '7-day average', color: INK.trailing, shape: 'line' },
        { label: 'Daily average', color: INK.daily, shape: 'dot' },
      ]}
      table={<TrendTable days={days} />}
    >
      <div ref={viewRef}>
        <div ref={wrapRef} className="relative w-full">
          {width > 0 && (
            <svg
              width={width}
              height={H}
              className="block touch-none select-none"
              role="img"
              aria-label={`Team average score over the last ${days.length} days. Latest 7-day average ${
                lastTrailing?.trailing != null ? Math.round(lastTrailing.trailing) : 'unavailable'
              }.`}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                setHover((h) => {
                  const next = (h ?? days.length - 1) + (e.key === 'ArrowRight' ? 1 : -1);
                  return Math.max(0, Math.min(days.length - 1, next));
                });
              }}
              onBlur={() => setHover(null)}
              onPointerMove={(e) => move(e.clientX, e.currentTarget.getBoundingClientRect())}
              onPointerLeave={() => setHover(null)}
            >
              <defs>
                <linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(var(--air-signal))" stopOpacity="0.26" />
                  <stop offset="100%" stopColor="rgb(var(--air-signal))" stopOpacity="0" />
                </linearGradient>

                {/* Wipes left to right in step with the stroke, so the fill
                    arrives under the line instead of ahead of it. */}
                <clipPath id="trend-reveal">
                  <rect
                    x={PAD.left}
                    y={0}
                    width={innerW}
                    height={H}
                    style={{
                      transformBox: 'fill-box',
                      transformOrigin: 'left',
                      transform: `scaleX(${inView ? 1 : 0})`,
                      transition: 'transform 1.15s cubic-bezier(.2,.8,.2,1)',
                    }}
                  />
                </clipPath>
              </defs>

              {/* ── score bands ─────────────────────────────── */}
              <rect x={PAD.left} y={y(100)} width={innerW} height={y(80) - y(100)} fill="rgb(var(--air-mint) / 0.05)" />
              <rect x={PAD.left} y={y(80)} width={innerW} height={y(60) - y(80)} fill="rgb(var(--air-amber) / 0.04)" />
              <rect x={PAD.left} y={y(60)} width={innerW} height={y(0) - y(60)} fill="rgb(var(--air-live) / 0.035)" />

              {/* ── grid + y axis ───────────────────────────── */}
              {[0, 25, 50, 75, 100].map((v) => (
                <g key={v}>
                  <line
                    x1={PAD.left}
                    x2={PAD.left + innerW}
                    y1={y(v)}
                    y2={y(v)}
                    stroke="rgb(var(--air-line) / 0.12)"
                    strokeWidth={1}
                  />
                  <text
                    x={PAD.left - 10}
                    y={y(v) + 4}
                    textAnchor="end"
                    className="fill-air-faint font-mono-ui text-[10px] tabular-nums"
                  >
                    {v}
                  </text>
                </g>
              ))}

              {/* ── target ──────────────────────────────────── */}
              <line
                x1={PAD.left}
                x2={PAD.left + innerW}
                y1={y(TARGET)}
                y2={y(TARGET)}
                stroke="rgb(var(--air-mint) / 0.55)"
                strokeWidth={1}
              />
              {/* Sits inside the plot rather than in the right gutter: the
                  gutter belongs to the series end-label, and when the team is
                  averaging close to 80 the two land on the same line. */}
              <text
                x={PAD.left + 6}
                y={y(TARGET) - 6}
                className="fill-air-faint font-mono-ui text-[9px] uppercase tracking-[0.12em]"
              >
                Target {TARGET}
              </text>

              <g clipPath="url(#trend-reveal)">
                {runs.map((points, i) => (
                  <g key={i}>
                    {points.length > 1 && (
                      <path
                        d={`${monotonePath(points)} L ${points[points.length - 1].x} ${y(0)} L ${points[0].x} ${y(0)} Z`}
                        fill="url(#trend-area)"
                      />
                    )}
                    <path
                      d={monotonePath(points)}
                      fill="none"
                      stroke={INK.trailing}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      pathLength={1}
                      style={{
                        strokeDasharray: 1,
                        strokeDashoffset: inView ? 0 : 1,
                        transition: 'stroke-dashoffset 1.15s cubic-bezier(.2,.8,.2,1)',
                      }}
                    />
                  </g>
                ))}
              </g>

              {/* ── daily dots ──────────────────────────────── */}
              {dots.map((p, i) => (
                <circle
                  key={p.i}
                  cx={p.x}
                  cy={p.y}
                  r={3.5}
                  fill={INK.daily}
                  fillOpacity={0.75}
                  stroke="rgb(var(--air-panel))"
                  strokeWidth={2}
                  style={{
                    opacity: inView ? 1 : 0,
                    transform: inView ? 'none' : 'translateY(8px)',
                    transformBox: 'fill-box',
                    transformOrigin: 'center',
                    transition: `opacity .45s ease-out ${300 + i * 14}ms, transform .45s ease-out ${300 + i * 14}ms`,
                  }}
                />
              ))}

              {/* ── crosshair ───────────────────────────────── */}
              {active && (
                <g pointerEvents="none">
                  <line
                    x1={x(hover as number)}
                    x2={x(hover as number)}
                    y1={PAD.top}
                    y2={PAD.top + innerH}
                    stroke="rgb(var(--air-line) / 0.45)"
                    strokeWidth={1}
                  />
                  {active.trailing !== null && (
                    <circle
                      cx={x(hover as number)}
                      cy={y(active.trailing)}
                      r={5}
                      fill={INK.trailing}
                      stroke="rgb(var(--air-panel))"
                      strokeWidth={2}
                    />
                  )}
                  {active.avg !== null && (
                    <circle
                      cx={x(hover as number)}
                      cy={y(active.avg)}
                      r={5}
                      fill={INK.daily}
                      stroke="rgb(var(--air-panel))"
                      strokeWidth={2}
                    />
                  )}
                </g>
              )}

              {/* ── x axis ──────────────────────────────────── */}
              {ticks.map((i) => (
                <text
                  key={days[i].key}
                  x={x(i)}
                  y={H - 10}
                  textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}
                  className="fill-air-faint font-mono-ui text-[10px]"
                >
                  {days[i].label}
                </text>
              ))}

              {/* End label: one direct label on the series the story is about,
                  rather than a number on every point. */}
              {lastTrailing?.trailing != null && (
                <text
                  x={PAD.left + innerW + 8}
                  y={y(lastTrailing.trailing) + 5}
                  className="fill-air-text font-display text-[15px] font-extrabold tabular-nums"
                  style={{
                    opacity: inView ? 1 : 0,
                    transition: 'opacity .5s ease-out 1.05s',
                  }}
                >
                  {Math.round(lastTrailing.trailing)}
                </text>
              )}
            </svg>
          )}

          {active && (
            <ChartTooltip
              x={x(hover as number)}
              y={y(active.trailing ?? active.avg ?? 0)}
              width={width}
              title={active.label}
              rows={[
                {
                  label: '7-day average',
                  value: active.trailing === null ? '—' : `${Math.round(active.trailing)}%`,
                  color: INK.trailing,
                },
                {
                  label: 'That day',
                  value: active.avg === null ? '—' : `${Math.round(active.avg)}%`,
                  color: INK.daily,
                },
              ]}
              footer={
                active.count === 0
                  ? 'No calls scored'
                  : `${active.count} call${active.count === 1 ? '' : 's'} scored`
              }
            />
          )}
        </div>
      </div>
    </ChartFrame>
  );
}

function TrendTable({ days }: { days: DayPoint[] }) {
  return (
    <table className="w-full text-left text-[12.5px]">
      <thead className="sticky top-0 bg-air-panel">
        <tr className="border-b border-air-line/15">
          <Th>Day</Th>
          <Th align="right">Calls scored</Th>
          <Th align="right">Daily average</Th>
          <Th align="right">7-day average</Th>
        </tr>
      </thead>
      <tbody>
        {[...days].reverse().map((d) => (
          <tr key={d.key} className="border-b border-air-line/[0.07]">
            <td className="py-2 pr-3 text-air-text">{d.label}</td>
            <td className="py-2 pr-3 text-right tabular-nums text-air-muted">{d.count}</td>
            <td className="py-2 pr-3 text-right tabular-nums text-air-text">
              {d.avg === null ? '—' : `${Math.round(d.avg)}%`}
            </td>
            <td className="py-2 text-right tabular-nums text-air-muted">
              {d.trailing === null ? '—' : `${Math.round(d.trailing)}%`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`py-2 pr-3 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.14em] text-air-faint ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}
