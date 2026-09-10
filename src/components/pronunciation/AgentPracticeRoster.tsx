'use client';

/**
 * Every agent: what they have used, and what they are allowed.
 * ────────────────────────────────────────────────────────────
 *
 * One list, one row per agent, with the limits editable from that row. It
 * replaces three separate panels — an "add an override for" dropdown, a stack
 * of inline per-agent forms, and a usage table — which between them meant an
 * admin had to pick a name from a dropdown before they could see whether that
 * agent needed a different limit at all.
 *
 * ── EVERY AGENT IS LISTED, NOT ONLY THE OVERRIDDEN ONES ──────────────────
 *
 * The older panel listed only agents who already had their own row, so an
 * agent on the global limit — which is most of them — appeared nowhere. Since
 * every agent is here now, there is nothing to "add": each row simply has
 * limits, inherited until someone sets them.
 *
 * ── THE NUMBERS COME FROM THE SERVER ─────────────────────────────────────
 *
 * `remaining` and `blockedBy` are computed by the same functions that ENFORCE
 * the limits, and by the same subtraction the agent's own practice page uses.
 * Recomputing them here is how a panel comes to say "12 left" about someone
 * the server is already blocking.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { pronunciationLimitsApi, type AgentPracticeRow } from '@/lib/api';
import {
  BLANK_DRAFT,
  LimitRows,
  bodyFrom,
  draftFrom,
  personName,
  type LimitKey,
} from './limit-fields';

type Period = 'day' | 'month' | 'total';

const PERIODS: ReadonlyArray<{ key: Period; label: string; hint: string }> = [
  { key: 'day', label: 'Today', hint: 'resets at midnight' },
  { key: 'month', label: 'This month', hint: 'calendar month' },
  { key: 'total', label: 'All time', hint: 'never resets' },
];

/** Caps and what is left of them, for one window. */
function capsFor(row: AgentPracticeRow, period: Period) {
  if (period === 'day') {
    return {
      attempts: row.limits.dailyAttemptLimit, minutes: row.limits.dailyMinutesLimit,
      leftAttempts: row.remaining.dailyAttempts, leftMinutes: row.remaining.dailyMinutes,
    };
  }
  if (period === 'month') {
    return {
      attempts: row.limits.monthlyAttemptLimit, minutes: row.limits.monthlyMinutesLimit,
      leftAttempts: row.remaining.monthlyAttempts, leftMinutes: row.remaining.monthlyMinutes,
    };
  }
  return {
    attempts: row.limits.totalAttemptLimit, minutes: row.limits.totalMinutesLimit,
    leftAttempts: row.remaining.totalAttempts, leftMinutes: row.remaining.totalMinutes,
  };
}

/**
 * "3 / 60" when capped, "3" when not.
 *
 * An uncapped measure shows the usage alone rather than "3 / —": a denominator
 * that is not a number invites reading it as a broken value.
 */
function UsedOfCap({ used, cap, unit }: { used: number; cap: number | null; unit?: string }) {
  const spent = cap !== null && used >= cap;
  return (
    <span className={spent ? 'font-semibold text-bean-live' : 'text-bean-ink'}>
      {used}{unit}
      {cap !== null && <span className="text-bean-muted"> / {cap}{unit}</span>}
    </span>
  );
}

/** A thin bar, drawn only when there is a cap to be a fraction of. */
function Meter({ used, cap }: { used: number; cap: number | null }) {
  if (cap === null || cap <= 0) return null;
  const pct = Math.min(100, Math.round((used / cap) * 100));
  const tone = pct >= 100 ? 'bg-bean-live' : pct >= 80 ? 'bg-amber-500' : 'bg-bean-brand';
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-bean-line/50">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function periodWord(period: Period): string {
  return period === 'day' ? 'daily' : period === 'month' ? 'monthly' : 'total';
}

/**
 * ── ONE AGENT'S LIMITS ───────────────────────────────────────────────────
 *
 * A dialog rather than an inline form: the row is about what they HAVE used,
 * the dialog about what they are ALLOWED, and mixing the two in a table made
 * both harder to read.
 *
 * Placeholders show the value that would apply if the box were cleared — the
 * global figure, or the server default — so "empty" is visibly inheritance
 * rather than an absence of any limit.
 */
function LimitsDialog({
  row,
  inherited,
  saving,
  onSave,
  onClear,
  onClose,
  error,
}: {
  row: AgentPracticeRow;
  inherited: (key: LimitKey) => string;
  saving: boolean;
  onSave: (body: ReturnType<typeof bodyFrom>) => void;
  onClear: () => void;
  onClose: () => void;
  error: string | null;
}) {
  // Seeded from the agent's OWN row only. Seeding from the resolved values
  // would turn every inherited number into an explicit override the moment
  // anyone opened the dialog and pressed save.
  const [draft, setDraft] = useState<Record<LimitKey, string>>(() =>
    row.hasOverride ? draftFrom(row.limits) : BLANK_DRAFT,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Practice limits for ${personName(row.agent)}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bean-card w-full max-w-[560px] rounded-[18px] border p-6 shadow-xl">
        <div className="mb-4">
          <h3 className="text-[17px] font-bold tracking-[-0.01em] text-bean-ink">
            {personName(row.agent)}
          </h3>
          <p className="mt-0.5 text-[12px] text-bean-muted">{row.agent.email}</p>
          <p className="mt-2 max-w-[60ch] text-[12px] text-bean-muted">
            Leave a box <b>empty to inherit</b> the limit everyone gets; enter <b>0</b> to switch
            practice off for this agent. Each box inherits on its own.
          </p>
        </div>

        {error && (
          <div className="mb-3 rounded-xl border border-bean-live/40 bg-bean-live/10 px-3 py-2">
            <span className="text-[13px] font-medium text-bean-live">{error}</span>
          </div>
        )}

        <LimitRows
          draft={draft}
          onChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
          usage={row.usage}
          placeholderFor={inherited}
        />

        <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-bean-line pt-4">
          {row.hasOverride && (
            <button
              type="button"
              onClick={onClear}
              disabled={saving}
              className="mr-auto rounded-[10px] border border-bean-line px-3 py-2 text-[13px] font-medium text-bean-muted transition hover:border-bean-live hover:text-bean-live disabled:opacity-40"
            >
              Reset to everyone&apos;s limits
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-[10px] border border-bean-line px-4 py-2 text-[13.5px] font-medium text-bean-muted transition hover:text-bean-ink disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(bodyFrom(draft))}
            disabled={saving}
            className="rounded-[10px] bg-bean-brand px-4 py-2 text-[13.5px] font-semibold text-white transition hover:bg-bean-brand-bright disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save limits'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AgentPracticeRoster({ token, reloadKey = 0 }: { token: string | null; reloadKey?: number }) {
  const [rows, setRows] = useState<AgentPracticeRow[]>([]);
  const [globalLimits, setGlobalLimits] = useState<Partial<Record<LimitKey, number | null>>>({});
  const [envDefault, setEnvDefault] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('day');
  const [query, setQuery] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);

  const [editing, setEditing] = useState<AgentPracticeRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      // The roster for usage; the limits response for what an empty box would
      // inherit. Both are needed before a placeholder can be honest.
      const [roster, limits] = await Promise.all([
        pronunciationLimitsApi.roster(token),
        pronunciationLimitsApi.get(token).catch(() => null),
      ]);
      setRows(roster.data.agents);
      setGlobalLimits(limits?.data.global ?? {});
      setEnvDefault(limits?.data.environmentDefault.dailyAttemptLimit);
      setError(null);
    } catch (err) {
      setError((err as Error)?.message || 'Could not load practice usage.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  /** What a cleared box would fall back to: the global value, then the server default. */
  const inherited = useCallback((key: LimitKey): string => {
    const g = globalLimits[key];
    if (g !== null && g !== undefined) return `${g}`;
    if (key === 'dailyAttemptLimit' && envDefault !== undefined) return `${envDefault}`;
    return 'no limit';
  }, [globalLimits, envDefault]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyActive && !r.agent.isActive) return false;
      if (!q) return true;
      return personName(r.agent).toLowerCase().includes(q) || r.agent.email.toLowerCase().includes(q);
    });
  }, [rows, query, onlyActive]);

  const totals = useMemo(() => visible.reduce(
    (acc, r) => ({
      attempts: acc.attempts + r.usage[period].attempts,
      minutes: Math.round((acc.minutes + r.usage[period].minutes) * 10) / 10,
    }),
    { attempts: 0, minutes: 0 },
  ), [visible, period]);

  const blockedCount = visible.filter((r) => r.blockedBy).length;

  async function runSave(fn: () => Promise<unknown>, message: string): Promise<void> {
    setSaving(true);
    setDialogError(null);
    try {
      await fn();
      setEditing(null);
      setNotice(message);
      await load();
    } catch (err) {
      setDialogError((err as Error)?.message || 'That change could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bean-card rounded-[18px] border p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-bold tracking-[-0.01em] text-bean-ink">Agents</h2>
          <p className="mt-0.5 max-w-[70ch] text-[12px] text-bean-muted">
            What each agent has used, and what they are allowed. Edit a row to give that agent
            their own limits — anything left empty follows everyone&apos;s.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-[10px] border border-bean-line px-3 py-1.5 text-[12.5px] font-medium text-bean-muted transition hover:border-bean-brand hover:text-bean-ink"
        >
          Refresh
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-[10px] border border-bean-line p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              title={p.hint}
              onClick={() => setPeriod(p.key)}
              className={`rounded-[8px] px-3 py-1.5 text-[12.5px] font-medium transition ${
                period === p.key ? 'bg-bean-brand text-white' : 'text-bean-muted hover:text-bean-ink'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search agents…"
          className="w-56 rounded-[10px] border border-bean-line bg-bean-card px-3 py-1.5 text-[13px] text-bean-ink outline-none transition focus:border-bean-brand"
        />

        <label className="flex items-center gap-2 text-[12.5px] text-bean-muted">
          <input
            type="checkbox"
            checked={onlyActive}
            onChange={(e) => setOnlyActive(e.target.checked)}
            className="h-4 w-4 rounded border-bean-line accent-bean-brand"
          />
          Active agents only
        </label>

        <div className="ml-auto flex items-center gap-4 text-[12.5px]">
          <span className="text-bean-muted">
            <b className="text-bean-ink">{visible.length}</b> agent{visible.length === 1 ? '' : 's'}
          </span>
          <span className="text-bean-muted">
            <b className="text-bean-ink">{totals.attempts}</b> attempts · <b className="text-bean-ink">{totals.minutes}m</b>
          </span>
          {blockedCount > 0 && (
            <span className="rounded-full bg-bean-live/15 px-2.5 py-1 font-mono-ui text-[10px] uppercase tracking-[0.08em] text-bean-live">
              {blockedCount} at limit
            </span>
          )}
        </div>
      </div>

      {notice && (
        <div className="mb-4 rounded-xl border border-bean-brand/30 bg-bean-brand/10 px-4 py-3">
          <span className="text-[13.5px] font-medium text-bean-brand">{notice}</span>
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-xl border border-bean-live/40 bg-bean-live/10 px-4 py-3">
          <span className="text-[13.5px] font-medium text-bean-live">{error}</span>
        </div>
      )}

      {loading ? (
        <p className="text-[14px] text-bean-muted">Loading agents…</p>
      ) : visible.length === 0 ? (
        <p className="text-[14px] text-bean-muted">
          {rows.length === 0 ? 'No agents yet.' : 'No agents match this filter.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-bean-line text-left font-mono-ui text-[10px] uppercase tracking-[0.11em] text-bean-muted">
                <th className="py-2 pr-4 font-medium">Agent</th>
                <th className="py-2 pr-4 font-medium">Attempts used</th>
                <th className="py-2 pr-4 font-medium">Minutes used</th>
                <th className="py-2 pr-4 text-right font-medium">Left</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pl-4 text-right font-medium">Limits</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const caps = capsFor(row, period);
                const used = row.usage[period];
                const blocked = row.blockedBy;
                return (
                  <tr key={row.agent.id} className="border-b border-bean-line/60 align-top last:border-0">
                    <td className="py-3 pr-4">
                      <span className="block font-medium text-bean-ink">{personName(row.agent)}</span>
                      <span className="block text-[12px] text-bean-muted">{row.agent.email}</span>
                      {row.hasOverride && (
                        <span className="mt-1 inline-block rounded-full bg-bean-brand/12 px-2 py-0.5 font-mono-ui text-[9.5px] uppercase tracking-[0.08em] text-bean-brand">
                          own limits
                        </span>
                      )}
                      {!row.agent.isActive && (
                        <span className="ml-1 mt-1 inline-block rounded-full bg-bean-line/50 px-2 py-0.5 font-mono-ui text-[9.5px] uppercase tracking-[0.08em] text-bean-muted">
                          disabled
                        </span>
                      )}
                    </td>

                    <td className="w-[20%] py-3 pr-4">
                      <UsedOfCap used={used.attempts} cap={caps.attempts} />
                      <Meter used={used.attempts} cap={caps.attempts} />
                    </td>

                    <td className="w-[20%] py-3 pr-4">
                      <UsedOfCap used={used.minutes} cap={caps.minutes} unit="m" />
                      <Meter used={used.minutes} cap={caps.minutes} />
                    </td>

                    <td className="py-3 pr-4 text-right font-mono-ui text-[13px]">
                      {caps.attempts === null && caps.minutes === null ? (
                        <span className="text-bean-faint">no limit</span>
                      ) : (
                        <>
                          {caps.attempts !== null && (
                            <span className="block text-bean-ink">{caps.leftAttempts} left</span>
                          )}
                          {caps.minutes !== null && (
                            <span className="block text-bean-muted">{caps.leftMinutes}m left</span>
                          )}
                        </>
                      )}
                    </td>

                    <td className="py-3 pr-4">
                      {blocked ? (
                        <span className="inline-block rounded-full bg-bean-live/15 px-2.5 py-1 font-mono-ui text-[10px] uppercase tracking-[0.08em] text-bean-live">
                          {blocked.limit === 0
                            ? 'turned off'
                            : `at ${periodWord(blocked.period)} ${blocked.measure} limit`}
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-bean-line/40 px-2.5 py-1 font-mono-ui text-[10px] uppercase tracking-[0.08em] text-bean-muted">
                          can practise
                        </span>
                      )}
                    </td>

                    <td className="py-3 pl-4 text-right">
                      <button
                        type="button"
                        onClick={() => { setDialogError(null); setNotice(null); setEditing(row); }}
                        className="rounded-[9px] border border-bean-line px-3 py-1.5 text-[12.5px] font-medium text-bean-muted transition hover:border-bean-brand hover:text-bean-ink"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && token && (
        <LimitsDialog
          // Keyed so reopening on a different agent starts from their values
          // rather than keeping the previous agent's draft.
          key={editing.agent.id}
          row={editing}
          inherited={inherited}
          saving={saving}
          error={dialogError}
          onClose={() => { setEditing(null); setDialogError(null); }}
          onSave={(body) => {
            /**
             * ── EVERY BOX EMPTY MEANS "NO OWN LIMITS" ──────────────────────
             *
             * The API's guard rejects a body where every field is `undefined`,
             * but an emptied form sends explicit `null`s — which passes, and
             * writes an override row that overrides nothing. The agent would
             * then carry an "own limits" badge and a reset button for a row
             * that changes no behaviour at all.
             *
             * Clearing every box is how an admin says "follow everyone else",
             * so it is routed to the same endpoint as the reset button. With
             * no override to begin with there is nothing to do, and the dialog
             * simply closes rather than creating an empty row to delete later.
             */
            const allInherited = Object.values(body).every((v) => v === null);
            if (allInherited) {
              if (!editing.hasOverride) { setEditing(null); return; }
              void runSave(
                () => pronunciationLimitsApi.clearAgent(token, editing.agent.id),
                `${personName(editing.agent)} now follows everyone's limits.`,
              );
              return;
            }
            void runSave(
              () => pronunciationLimitsApi.setAgent(token, editing.agent.id, body),
              `Saved limits for ${personName(editing.agent)}.`,
            );
          }}
          onClear={() => void runSave(
            () => pronunciationLimitsApi.clearAgent(token, editing.agent.id),
            `${personName(editing.agent)} now follows everyone's limits.`,
          )}
        />
      )}
    </section>
  );
}
