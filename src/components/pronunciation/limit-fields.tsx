'use client';

/**
 * The six practice-limit boxes, shared by the two places that edit them.
 * ─────────────────────────────────────────────────────────────────────
 *
 * The global card sets what applies to everyone; the per-agent dialog sets one
 * agent's override. They are the SAME six fields with the same rules, so the
 * grid, the parsing and the inherit/zero distinction live here once rather
 * than being written twice and drifting.
 *
 * ── EMPTY MEANS INHERIT, 0 MEANS ZERO ────────────────────────────────────
 *
 * The backend keeps null (inherit) and 0 (a real limit of zero, which disables
 * practice) distinct, so the inputs must too: an empty box sends null, a typed
 * 0 sends 0. Collapsing them would make "stop overriding this agent" and
 * "block this agent" the same click — the one mistake an admin must not be
 * able to make by accident.
 *
 * Inheritance is per FIELD, so each box clears independently: an override can
 * raise daily attempts and leave the other five tracking the global value.
 */

import type { PronunciationLimitValues } from '@/lib/api';

export type LimitKey = keyof PronunciationLimitValues;

export const FIELD =
  'w-full rounded-[8px] border border-bean-line bg-bean-card px-2 py-1.5 text-center text-[13px] text-bean-ink outline-none transition focus:border-bean-brand';
export const LABEL = 'block font-mono-ui text-[10px] uppercase tracking-[0.11em] text-bean-muted';

/** One row per window, in the order the grid lays them out. */
export const ROWS: ReadonlyArray<{
  period: 'day' | 'month' | 'total';
  label: string;
  hint: string;
  attempts: LimitKey;
  minutes: LimitKey;
}> = [
  { period: 'day', label: 'Per day', hint: 'resets at midnight', attempts: 'dailyAttemptLimit', minutes: 'dailyMinutesLimit' },
  { period: 'month', label: 'Per month', hint: 'calendar month', attempts: 'monthlyAttemptLimit', minutes: 'monthlyMinutesLimit' },
  { period: 'total', label: 'Total', hint: 'lifetime, never resets', attempts: 'totalAttemptLimit', minutes: 'totalMinutesLimit' },
];

export const BLANK_DRAFT: Record<LimitKey, string> = {
  dailyAttemptLimit: '', dailyMinutesLimit: '',
  monthlyAttemptLimit: '', monthlyMinutesLimit: '',
  totalAttemptLimit: '', totalMinutesLimit: '',
};

/** '' -> null (inherit); '0' -> 0 (a real zero). Unparseable -> null. */
export function toLimit(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function fromLimit(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

export function draftFrom(values: Partial<PronunciationLimitValues> | null | undefined): Record<LimitKey, string> {
  const out = { ...BLANK_DRAFT };
  if (!values) return out;
  for (const key of Object.keys(BLANK_DRAFT) as LimitKey[]) out[key] = fromLimit(values[key]);
  return out;
}

export function bodyFrom(draft: Record<LimitKey, string>): PronunciationLimitValues {
  const out = {} as PronunciationLimitValues;
  for (const key of Object.keys(BLANK_DRAFT) as LimitKey[]) out[key] = toLimit(draft[key]);
  return out;
}

export function personName(a: { firstName?: string; lastName?: string; email: string }): string {
  const name = [a.firstName, a.lastName].filter(Boolean).join(' ').trim();
  return name || a.email;
}

/**
 * The grid itself.
 *
 * `usage`, when given, sits beside the box it is measured against — so "why
 * was this agent blocked" is answerable in one glance rather than by comparing
 * two panels.
 */
export function LimitRows({
  draft,
  onChange,
  usage,
  placeholderFor,
}: {
  draft: Record<LimitKey, string>;
  onChange: (key: LimitKey, value: string) => void;
  usage?: { day: { attempts: number; minutes: number }; month: { attempts: number; minutes: number }; total: { attempts: number; minutes: number } };
  placeholderFor: (key: LimitKey) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-separate border-spacing-y-1.5">
        <thead>
          <tr>
            <th className="w-[34%] text-left"><span className={LABEL}>Window</span></th>
            <th className="w-[33%]"><span className={LABEL}>Attempts</span></th>
            <th className="w-[33%]"><span className={LABEL}>Minutes</span></th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.period}>
              <td className="pr-3 align-middle">
                <div className="text-[13px] font-semibold text-bean-ink">{row.label}</div>
                <div className="text-[10px] text-bean-muted">{row.hint}</div>
                {usage && (
                  <div className="mt-0.5 text-[10px] text-bean-muted">
                    used {usage[row.period].attempts} · {usage[row.period].minutes}m
                  </div>
                )}
              </td>
              <td className="px-1">
                <input
                  className={FIELD}
                  inputMode="numeric"
                  aria-label={`${row.label} attempts`}
                  placeholder={placeholderFor(row.attempts)}
                  value={draft[row.attempts]}
                  onChange={(e) => onChange(row.attempts, e.target.value)}
                />
              </td>
              <td className="px-1">
                <input
                  className={FIELD}
                  inputMode="numeric"
                  aria-label={`${row.label} minutes`}
                  placeholder={placeholderFor(row.minutes)}
                  value={draft[row.minutes]}
                  onChange={(e) => onChange(row.minutes, e.target.value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
