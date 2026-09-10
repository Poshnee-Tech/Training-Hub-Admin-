'use client';

/**
 * The two figure components at the top of the analytics page.
 *
 * Kept out of the page file so the page stays a layout — the same split the
 * charts already follow — and so both can be rendered against fixed data
 * during development without a backend.
 *
 * These are deliberately NOT the dashboard's `StatTile`, which lives inside
 * that page's own file: pulling it out would mean editing a screen this change
 * has no business touching. They wear the same panel, accent ring and glow, so
 * the two read as one family on screen even though they are two files.
 */

import RadialGauge, { toneForScore } from './RadialGauge';
import { useCountUp } from '@/lib/use-chart-motion';
import { BAND_WORD, WINDOW_DAYS, scoreBand } from '@/lib/analytics-series';

const ACCENT = {
  signal: {
    ring: 'border-air-signal/25',
    glow: 'rgb(var(--air-signal) / .16)',
    fill: 'rgb(var(--air-signal))',
  },
  cyan: {
    ring: 'border-air-cyan/25',
    glow: 'rgb(var(--air-cyan) / .14)',
    fill: 'rgb(var(--air-cyan))',
  },
  mint: {
    ring: 'border-air-mint/25',
    glow: 'rgb(var(--air-mint) / .14)',
    fill: 'rgb(var(--air-mint))',
  },
} as const;

/**
 * The one hero figure on the page.
 *
 * The ring is the console's shared RadialGauge with its own readout switched
 * off, so the number can be set at hero size beside it rather than at the 15px
 * the gauge draws internally. The alternative — two copies of one value at two
 * sizes — always leaves one of them looking like a mistake.
 */
export function HeroAverage({
  average,
  delta,
  label = 'Team average',
}: {
  /** null when nothing in the current scope has been scored — not the same as 0. */
  average: number | null;
  delta: number | null;
  label?: string;
}) {
  const shown = useCountUp(average ?? 0, { duration: 1100 });
  const band = scoreBand(average ?? 0);
  const bandText =
    band === 'strong' ? 'text-air-mint' : band === 'mid' ? 'text-air-amber' : 'text-air-live';

  return (
    <div className="air-panel flex items-center gap-5 rounded-[20px] border px-6 py-5 backdrop-blur-lg">
      <RadialGauge
        value={average ?? 0}
        tone={average === null ? 'neutral' : toneForScore(average)}
        size={92}
        thickness={9}
        showValue={false}
      />

      <div className="min-w-0">
        {average === null ? (
          <div className="font-display text-[46px] font-extrabold leading-none tracking-[-0.03em] text-air-faint">
            —
          </div>
        ) : (
          <div className="font-display text-[46px] font-extrabold leading-none tracking-[-0.03em] text-air-text">
            {Math.round(shown)}
            <span className="text-[26px] text-air-muted">%</span>
          </div>
        )}
        <p className="mt-1.5 text-[13px] font-semibold text-air-text">{label}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2">
          {average === null ? (
            <span className="font-mono-ui text-[9px] font-bold uppercase tracking-[0.14em] text-air-faint">
              Nothing scored yet
            </span>
          ) : (
            <span className={`font-mono-ui text-[9px] font-bold uppercase tracking-[0.14em] ${bandText}`}>
              {BAND_WORD[band]}
            </span>
          )}
          <TrendNote delta={delta} />
        </div>
      </div>
    </div>
  );
}

/** Direction is carried by the arrow and the words; colour only agrees with them. */
function TrendNote({ delta }: { delta: number | null }) {
  if (delta === null) return null;

  const rounded = Math.round(delta * 10) / 10;
  const flat = Math.abs(rounded) < 0.5;
  const up = rounded > 0;

  return (
    <span
      className={`font-mono-ui text-[9px] font-bold uppercase tracking-[0.1em] ${
        flat ? 'text-air-faint' : up ? 'text-air-mint' : 'text-air-live'
      }`}
      title={`Last ${WINDOW_DAYS / 2} days against the ${WINDOW_DAYS / 2} before them`}
    >
      {flat ? '· steady' : `· ${up ? '▲ +' : '▼ '}${rounded} pts`}
    </span>
  );
}

/** Headline count, with an optional meter for values that are already a share. */
export function Tile({
  label,
  value,
  suffix = '',
  accent,
  footnote,
  meter,
}: {
  label: string;
  /** null renders an em dash — "we have no number", not "the number is zero". */
  value: number | null;
  suffix?: string;
  accent: keyof typeof ACCENT;
  footnote: string;
  meter?: number | null;
}) {
  const shown = useCountUp(value ?? 0, { duration: 1000 });
  const a = ACCENT[accent];

  return (
    <div
      className={`air-panel relative overflow-hidden rounded-[20px] border ${a.ring} p-5 backdrop-blur-lg transition-transform duration-200 hover:-translate-y-0.5`}
    >
      <div
        className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full"
        style={{ background: `radial-gradient(circle, ${a.glow}, transparent 70%)` }}
        aria-hidden
      />

      <div className="relative">
        <p className="truncate font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.14em] text-air-muted">
          {label}
        </p>

        <div className="mt-3 font-display text-[34px] font-extrabold leading-none tracking-[-0.02em] text-air-text">
          {value === null ? '—' : `${Math.round(shown).toLocaleString()}${suffix}`}
        </div>

        {typeof meter === 'number' && (
          <div className="mt-3 h-[6px] w-full overflow-hidden rounded-full bg-air-line/15">
            <div
              className="h-full rounded-full"
              style={{
                background: a.fill,
                width: `${Math.max(0, Math.min(100, meter))}%`,
                transition: 'width 1s cubic-bezier(.2,.8,.2,1)',
              }}
            />
          </div>
        )}

        <p className="mt-2 font-mono-ui text-[9.5px] leading-relaxed tracking-[0.04em] text-air-faint">
          {footnote}
        </p>
      </div>
    </div>
  );
}
