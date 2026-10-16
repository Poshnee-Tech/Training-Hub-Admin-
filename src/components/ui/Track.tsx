'use client';

/**
 * Agent track (CSR or Self Verifier): one badge and one filter, used on every
 * page that lists agents, requests or calls. The track is a label on the data,
 * like campaign, so there is no page-wide switch to remember.
 */
import type { Track } from '@/lib/api';

export const TRACK_OPTIONS: ReadonlyArray<{ value: Track; label: string }> = [
  { value: 'CSR', label: 'Fronter' },
  { value: 'SELF_VERIFIER', label: 'Self Verifier' },
];

export function trackLabel(track?: string | null): string {
  return TRACK_OPTIONS.find((t) => t.value === track)?.label ?? 'Fronter';
}

// Written out in full: Tailwind only sees literal class names.
const BADGE: Record<Track, string> = {
  CSR: 'border-sky-300 bg-sky-50 text-sky-700',
  SELF_VERIFIER: 'border-violet-300 bg-violet-50 text-violet-700',
};

export function TrackBadge({ track, className = '' }: { track?: Track | null; className?: string }) {
  const t: Track = track === 'SELF_VERIFIER' ? 'SELF_VERIFIER' : 'CSR';
  return <span className={`admin-pill w-fit ${BADGE[t]} ${className}`}>{trackLabel(t)}</span>;
}

/** All / Fronter / Self Verifier. `''` means all. */
export function TrackFilter({
  value,
  onChange,
  counts,
  className = '',
}: {
  value: Track | '';
  onChange: (next: Track | '') => void;
  counts?: Partial<Record<Track | 'ALL', number>>;
  className?: string;
}) {
  const options: Array<{ key: Track | ''; label: string; count?: number }> = [
    { key: '', label: 'All', count: counts?.ALL },
    ...TRACK_OPTIONS.map((t) => ({ key: t.value, label: t.label, count: counts?.[t.value] })),
  ];
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} role="group" aria-label="Filter by track">
      {options.map((o) => {
        const on = value === o.key;
        return (
          <button
            key={o.key || 'ALL'}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition ${
              on
                ? 'border-violet-600 bg-violet-600 text-white'
                : 'border-black/10 bg-white/60 text-slate-600 hover:border-black/20 hover:text-slate-900'
            }`}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={`rounded-full px-1.5 py-0.5 font-mono-ui text-[9.5px] font-bold ${on ? 'bg-white/20' : 'bg-black/5'}`}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A plain select, for forms. */
export function TrackSelect({
  value,
  onChange,
  className = '',
  id,
}: {
  value: Track;
  onChange: (next: Track) => void;
  className?: string;
  id?: string;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as Track)} className={className}>
      {TRACK_OPTIONS.map((t) => (
        <option key={t.value} value={t.value}>{t.label}</option>
      ))}
    </select>
  );
}
