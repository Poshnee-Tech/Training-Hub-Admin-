'use client';

/**
 * Radial progress gauge.
 *
 * SVG rather than a conic-gradient: an SVG arc can carry a real gradient
 * stroke, a round cap and a glow filter, and it stays crisp at any size. The
 * track and the arc both read from theme tokens, so one component works in
 * dark and bright without a per-theme branch.
 *
 * `tone` is the semantic band, not a colour — callers pass what the number
 * MEANS (strong / mid / weak / neutral) and the palette is decided here, so a
 * score of 42 can never render green in one place and red in another.
 */

export type GaugeTone = 'strong' | 'mid' | 'weak' | 'neutral' | 'signal';

const TONES: Record<GaugeTone, { from: string; to: string; text: string }> = {
  strong: { from: 'rgb(var(--air-mint))', to: 'rgb(var(--air-cyan))', text: 'text-air-mint' },
  mid: { from: 'rgb(var(--air-amber))', to: 'rgb(var(--air-amber))', text: 'text-air-amber' },
  weak: { from: 'rgb(var(--air-live))', to: 'rgb(var(--air-amber))', text: 'text-air-live' },
  neutral: { from: 'rgb(var(--air-faint))', to: 'rgb(var(--air-muted))', text: 'text-air-muted' },
  signal: { from: 'rgb(var(--air-signal))', to: 'rgb(var(--air-cyan))', text: 'text-air-signal-bright' },
};

/** Score → semantic band. The single place these thresholds live. */
export function toneForScore(score: number): GaugeTone {
  if (score >= 80) return 'strong';
  if (score >= 60) return 'mid';
  return 'weak';
}

export default function RadialGauge({
  value,
  max = 100,
  size = 72,
  thickness = 7,
  tone = 'signal',
  label,
  sublabel,
  showValue = true,
  valueSuffix = '',
}: {
  value: number;
  max?: number;
  size?: number;
  thickness?: number;
  tone?: GaugeTone;
  label?: string;
  sublabel?: string;
  showValue?: boolean;
  valueSuffix?: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(1, value / safeMax));

  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const t = TONES[tone];

  // Unique per instance: two gauges on one page would otherwise share a
  // gradient id and the second would inherit the first's colours.
  const gid = `gauge-${tone}-${size}-${Math.round(pct * 1000)}`;

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={t.from} />
              <stop offset="100%" stopColor={t.to} />
            </linearGradient>
          </defs>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgb(var(--air-line) / 0.18)"
            strokeWidth={thickness}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`url(#${gid})`}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            style={{ transition: 'stroke-dashoffset .7s cubic-bezier(.2,.8,.2,1)' }}
          />
        </svg>

        {showValue && (
          <span className="absolute inset-0 grid place-items-center">
            <span className={`font-display text-[15px] font-extrabold leading-none ${t.text}`}>
              {Math.round(value)}
              {valueSuffix}
            </span>
          </span>
        )}
      </div>

      {(label || sublabel) && (
        <div className="min-w-0">
          {label && <div className="truncate text-[13px] font-semibold text-air-text">{label}</div>}
          {sublabel && (
            <div className="truncate font-mono-ui text-[9.5px] uppercase tracking-[0.12em] text-air-faint">
              {sublabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
