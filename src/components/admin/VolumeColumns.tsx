'use client';

/**
 * Completed calls per day, last 30 days.
 *
 * `overview.dailyCalls` was already in the payload and the old page never drew
 * it. It matters next to the score trend: a dip in average score on a day the
 * floor ran three calls is noise, and the only way a reader can tell is by
 * seeing how much work the day carried. The two panels share a window and a
 * day-bucketing rule so their x axes line up.
 *
 * One series, so no legend — the title says what is plotted, and a lone swatch
 * would just repeat it.
 */

import { useMemo, useState } from 'react';
import ChartFrame, { ChartEmpty, ChartTooltip, axisTicks } from './ChartFrame';
import { useInView, useMeasure } from '@/lib/use-chart-motion';
import type { DayPoint } from '@/lib/analytics-series';

const H = 176;
const PAD = { top: 14, right: 16, bottom: 28, left: 34 };
const MAX_BAR = 24;
const INK = 'rgb(var(--air-cyan))';

export default function VolumeColumns({ days }: { days: DayPoint[] }) {
  const [wrapRef, width] = useMeasure<HTMLDivElement>();
  const [viewRef, inView] = useInView<HTMLDivElement>(0.25);
  const [hover, setHover] = useState<number | null>(null);

  const total = days.reduce((sum, d) => sum + d.count, 0);

  const geom = useMemo(() => {
    const innerW = Math.max(0, width - PAD.left - PAD.right);
    const innerH = H - PAD.top - PAD.bottom;
    const peak = Math.max(1, ...days.map((d) => d.count));

    // Clean axis top: the tick labels should read 0 / 6 / 12, not 0 / 5.5 / 11.
    const step = peak <= 4 ? 1 : peak <= 10 ? 2 : peak <= 30 ? 5 : peak <= 60 ? 10 : 25;
    const top = Math.ceil(peak / step) * step;

    const slot = days.length ? innerW / days.length : 0;
    // The 2px surface gap is what separates neighbouring columns; no stroke is
    // drawn around them, which would add ink that is not data.
    const barW = Math.max(2, Math.min(MAX_BAR, slot - 2));

    const x = (i: number) => PAD.left + i * slot + (slot - barW) / 2;
    const y = (v: number) => PAD.top + (1 - v / top) * innerH;

    return { innerW, innerH, top, step, slot, barW, x, y };
  }, [days, width]);

  if (!total) {
    return (
      <ChartFrame title="Call volume" subtitle="Completed calls per day across the last 30 days.">
        <ChartEmpty>No completed calls in the last 30 days.</ChartEmpty>
      </ChartFrame>
    );
  }

  const { innerW, innerH, top, step, slot, barW, x, y } = geom;
  const active = hover !== null ? days[hover] : null;
  const mean = total / days.length;
  const dayTicks = axisTicks(days.length);

  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  // Three or four gridlines is plenty behind columns this short.
  const shownTicks = ticks.filter((_, i) => i % Math.ceil(ticks.length / 4) === 0 || i === ticks.length - 1);

  return (
    <ChartFrame
      title="Call volume"
      subtitle={`Completed calls per day. ${total.toLocaleString()} in the window, averaging ${mean.toFixed(1)} a day.`}
      table={<VolumeTable days={days} />}
    >
      <div ref={viewRef}>
        <div ref={wrapRef} className="relative w-full">
          {width > 0 && (
            <svg
              width={width}
              height={H}
              className="block touch-none select-none"
              role="img"
              aria-label={`Completed calls per day over the last ${days.length} days, ${total} in total.`}
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
              onPointerMove={(e) => {
                if (slot <= 0) return;
                const px = e.clientX - e.currentTarget.getBoundingClientRect().left - PAD.left;
                setHover(Math.max(0, Math.min(days.length - 1, Math.floor(px / slot))));
              }}
              onPointerLeave={() => setHover(null)}
            >
              {shownTicks.map((v) => (
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
                    x={PAD.left - 8}
                    y={y(v) + 4}
                    textAnchor="end"
                    className="fill-air-faint font-mono-ui text-[10px] tabular-nums"
                  >
                    {v}
                  </text>
                </g>
              ))}

              {days.map((d, i) => {
                const h = Math.max(0, y(0) - y(d.count));
                const lit = hover === i;
                return (
                  <g key={d.key}>
                    {/* Hit target spans the whole slot, including the gap, so
                        a one-call column is not a two-pixel needle to hover. */}
                    <rect
                      x={PAD.left + i * slot}
                      y={PAD.top}
                      width={slot}
                      height={innerH}
                      fill="transparent"
                    />
                    <rect
                      x={x(i)}
                      y={y(d.count)}
                      width={barW}
                      height={h}
                      rx={Math.min(4, barW / 2)}
                      fill={INK}
                      fillOpacity={lit ? 1 : 0.72}
                      style={{
                        transformBox: 'fill-box',
                        transformOrigin: 'bottom',
                        transform: inView ? 'scaleY(1)' : 'scaleY(0)',
                        transition: `transform 620ms cubic-bezier(.2,.8,.2,1) ${i * 18}ms, fill-opacity .15s ease-out`,
                      }}
                    />
                  </g>
                );
              })}

              {/* Window average — the line that says whether a day was busy. */}
              <line
                x1={PAD.left}
                x2={PAD.left + innerW}
                y1={y(mean)}
                y2={y(mean)}
                stroke="rgb(var(--air-signal) / 0.6)"
                strokeWidth={1}
              />

              {dayTicks.map((i) => (
                <text
                  key={days[i].key}
                  x={x(i) + barW / 2}
                  y={H - 9}
                  textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}
                  className="fill-air-faint font-mono-ui text-[10px]"
                >
                  {days[i].label}
                </text>
              ))}
            </svg>
          )}

          {active && (
            <ChartTooltip
              x={x(hover as number) + barW / 2}
              y={y(active.count)}
              width={width}
              title={active.label}
              rows={[
                {
                  label: 'Completed calls',
                  value: active.count.toLocaleString(),
                  color: INK,
                },
              ]}
              footer={`Window average ${mean.toFixed(1)} a day`}
            />
          )}
        </div>
      </div>
    </ChartFrame>
  );
}

function VolumeTable({ days }: { days: DayPoint[] }) {
  return (
    <table className="w-full text-left text-[12.5px]">
      <thead className="sticky top-0 bg-air-panel">
        <tr className="border-b border-air-line/15">
          <th scope="col" className="py-2 pr-3 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.14em] text-air-faint">
            Day
          </th>
          <th scope="col" className="py-2 text-right font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.14em] text-air-faint">
            Completed calls
          </th>
        </tr>
      </thead>
      <tbody>
        {[...days].reverse().map((d) => (
          <tr key={d.key} className="border-b border-air-line/[0.07]">
            <td className="py-2 pr-3 text-air-text">{d.label}</td>
            <td className="py-2 text-right tabular-nums text-air-text">{d.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
