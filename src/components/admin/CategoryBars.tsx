'use client';

/**
 * Category performance, ranked weakest first.
 *
 * WHY BARS AND NOT RINGS
 * The page this replaces drew five donuts in a row. A ring is a fine way to
 * show one number against its maximum — which is why the dashboard's hero
 * gauge stays a ring — but it is a poor way to compare five, because the eye
 * has to judge five arc lengths at five different rotations. Bars share one
 * baseline, so "objection handling is the weak one" is a glance rather than a
 * comparison. Sorting weakest-first means the thing to coach is the first
 * thing read.
 *
 * ENCODING
 * Bar length carries the score; the band colour (on target / developing /
 * needs work) carries what the score *means*. Colour is never the only channel
 * — every row also states the number and the band in words, which matters
 * because the console's bright theme is a warm monochrome where mint, amber
 * and red sit closer together than they do in the dark theme.
 *
 * The tick at 80 is the same target the trend chart draws, so a reader moving
 * between the two panels is measuring against one line, not two.
 */

import ChartFrame, { ChartEmpty } from './ChartFrame';
import { monotonePath } from '@/lib/chart-path';
import { useCountUp, useInView } from '@/lib/use-chart-motion';
import { BAND_WORD, scoreBand, type CategoryStat } from '@/lib/analytics-series';

const TARGET = 80;

const BAND = {
  strong: { fill: 'rgb(var(--air-mint))', track: 'rgb(var(--air-mint) / 0.14)', text: 'text-air-mint' },
  mid: { fill: 'rgb(var(--air-amber))', track: 'rgb(var(--air-amber) / 0.14)', text: 'text-air-amber' },
  weak: { fill: 'rgb(var(--air-live))', track: 'rgb(var(--air-live) / 0.14)', text: 'text-air-live' },
} as const;

export default function CategoryBars({
  stats,
  /** Who the numbers are about — "the floor", or a named agent. */
  subject = 'the floor',
}: {
  stats: CategoryStat[];
  subject?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>(0.2);
  const measured = stats.filter((s) => s.score > 0);

  return (
    <ChartFrame
      title={`Where ${subject} is strong and weak`}
      subtitle="Average score per scored category, weakest first. The tick on each bar is the 80-point target; the change is the last 15 days against the 15 before them."
      action={
        <span className="font-mono-ui text-[9.5px] uppercase tracking-[0.14em] text-air-faint">
          Weakest first
        </span>
      }
      table={<CategoryTable stats={stats} />}
    >
      <div ref={ref}>
        {measured.length === 0 ? (
          <ChartEmpty>No category scores recorded yet.</ChartEmpty>
        ) : (
          <ul className="space-y-2">
            {stats.map((stat, i) => (
              <CategoryRow key={stat.key} stat={stat} active={inView} delay={i * 90} />
            ))}
          </ul>
        )}
      </div>
    </ChartFrame>
  );
}

function CategoryRow({
  stat,
  active,
  delay,
}: {
  stat: CategoryStat;
  active: boolean;
  delay: number;
}) {
  const band = BAND[scoreBand(stat.score)];
  const shown = useCountUp(stat.score, { active, duration: 950 });

  return (
    <li className="group grid grid-cols-[minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-[14px] border border-air-line/10 bg-air-line/[0.035] px-4 py-3 transition-colors hover:border-air-line/20 hover:bg-air-line/[0.07] sm:grid-cols-[minmax(140px,1.1fr)_64px_minmax(120px,2.6fr)_auto]">
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-semibold text-air-text">{stat.label}</p>
        <p className={`mt-0.5 font-mono-ui text-[9px] font-bold uppercase tracking-[0.14em] ${band.text}`}>
          {BAND_WORD[scoreBand(stat.score)]}
        </p>
      </div>

      {/* Small multiple: this category's own 30-day shape, so a bar that is
          low but climbing does not read the same as one that is low and flat. */}
      <Sparkline values={stat.spark} color={band.fill} active={active} delay={delay} />

      <div className="relative h-[14px] w-full overflow-hidden rounded-[4px]" style={{ background: band.track }}>
        <div
          className="h-full rounded-r-[4px]"
          style={{
            background: band.fill,
            width: `${active ? Math.max(0, Math.min(100, stat.score)) : 0}%`,
            transition: `width 950ms cubic-bezier(.2,.8,.2,1) ${delay}ms`,
          }}
        />
        {/* Target tick. Drawn over the fill so it stays visible on a bar that
            has already cleared it. */}
        <span
          aria-hidden
          className="absolute top-0 h-full w-[2px] bg-air-panel/70"
          style={{ left: `calc(${TARGET}% - 1px)` }}
        />
      </div>

      <div className="flex items-center justify-end gap-3 sm:justify-start">
        <span className="w-[52px] shrink-0 text-right font-display text-[19px] font-extrabold tabular-nums text-air-text">
          {Math.round(shown)}%
        </span>
        <DeltaChip delta={stat.delta} />
      </div>
    </li>
  );
}

/**
 * Signed change against the earlier half of the window.
 *
 * The arrow does the work; the colour agrees with it. Direction is never left
 * to hue alone, and a null delta says so in words rather than rendering a
 * confident 0.0 built from two calls.
 */
function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <span className="w-[104px] shrink-0 whitespace-nowrap text-right font-mono-ui text-[9px] uppercase tracking-[0.1em] text-air-faint">
        Not enough data
      </span>
    );
  }

  const rounded = Math.round(delta * 10) / 10;
  const flat = Math.abs(rounded) < 0.5;
  const up = rounded > 0;

  const tone = flat
    ? 'border-air-line/20 text-air-muted'
    : up
      ? 'border-air-mint/30 bg-air-mint/10 text-air-mint'
      : 'border-air-live/30 bg-air-live/10 text-air-live';

  return (
    <span
      className={`inline-flex w-[104px] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border px-2 py-1 font-mono-ui text-[10px] font-bold tabular-nums ${tone}`}
      title="Last 15 days compared with the 15 before them"
    >
      <span aria-hidden>{flat ? '—' : up ? '▲' : '▼'}</span>
      {flat ? 'Steady' : `${up ? '+' : ''}${rounded} pts`}
    </span>
  );
}

/** 64×24 shape-only trace. No axis, no labels — the bar beside it carries the value. */
function Sparkline({
  values,
  color,
  active,
  delay,
}: {
  values: number[];
  color: string;
  active: boolean;
  delay: number;
}) {
  const W = 64;
  const H = 24;

  if (values.length < 2) {
    return <span className="hidden h-[24px] w-[64px] sm:block" aria-hidden />;
  }

  // Scaled to its own range, not to 0–100: across five categories that all sit
  // in the seventies, a 0–100 sparkline is five flat lines.
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * (W - 2) + 1,
    y: H - 3 - ((v - min) / span) * (H - 6),
  }));

  // Smoothed with the same overshoot-free spline the trend chart uses. At 64px
  // across, twenty-odd straight segments render as a scribble and the reader
  // takes nothing from it; the curve keeps the shape and drops the noise.
  const d = monotonePath(pts);
  const last = pts[pts.length - 1];

  return (
    <svg width={W} height={H} className="hidden shrink-0 sm:block" aria-hidden>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={0.6}
        pathLength={1}
        style={{
          strokeDasharray: 1,
          strokeDashoffset: active ? 0 : 1,
          transition: `stroke-dashoffset 900ms cubic-bezier(.2,.8,.2,1) ${delay + 150}ms`,
        }}
      />
      <circle
        cx={last.x}
        cy={last.y}
        r={2.2}
        fill={color}
        style={{ opacity: active ? 1 : 0, transition: `opacity .4s ease-out ${delay + 900}ms` }}
      />
    </svg>
  );
}

function CategoryTable({ stats }: { stats: CategoryStat[] }) {
  return (
    <table className="w-full text-left text-[12.5px]">
      <thead className="sticky top-0 bg-air-panel">
        <tr className="border-b border-air-line/15">
          <th scope="col" className="py-2 pr-3 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.14em] text-air-faint">
            Category
          </th>
          <th scope="col" className="py-2 pr-3 text-right font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.14em] text-air-faint">
            Average
          </th>
          <th scope="col" className="py-2 pr-3 text-right font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.14em] text-air-faint">
            Change
          </th>
          <th scope="col" className="py-2 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.14em] text-air-faint">
            Band
          </th>
        </tr>
      </thead>
      <tbody>
        {stats.map((s) => (
          <tr key={s.key} className="border-b border-air-line/[0.07]">
            <td className="py-2 pr-3 text-air-text">{s.label}</td>
            <td className="py-2 pr-3 text-right tabular-nums text-air-text">{Math.round(s.score)}%</td>
            <td className="py-2 pr-3 text-right tabular-nums text-air-muted">
              {s.delta === null
                ? '—'
                : `${s.delta > 0 ? '+' : ''}${Math.round(s.delta * 10) / 10} pts`}
            </td>
            <td className="py-2 text-air-muted">{BAND_WORD[scoreBand(s.score)]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
