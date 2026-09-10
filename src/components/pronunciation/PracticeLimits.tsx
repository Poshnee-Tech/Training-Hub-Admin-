'use client';

/**
 * The limits that apply to everyone.
 * ──────────────────────────────────
 *
 * Attempts are billed per second of audio, so these caps are the spend
 * control. Six limits: attempts and minutes, across day / month / total.
 *
 * ── WHY SIX AND NOT ONE ──────────────────────────────────────────────────
 *
 * A daily cap does not stop an agent who quietly uses their whole allowance
 * every day; a monthly one does not bound a fixed training budget; and neither
 * notices that two agents making the same number of attempts can cost very
 * different amounts, which is why minutes sit beside attempts. Every limit that
 * is set is enforced, so the tightest one binds — they are not alternatives.
 *
 * ── PER-AGENT OVERRIDES LIVE WITH THE AGENTS ─────────────────────────────
 *
 * They used to be stacked below this card as one inline form per agent, beside
 * a separate "add an override for" dropdown, and a third panel listed usage.
 * Three places to look for one answer: what is this agent allowed, and what
 * have they used. An admin adding an override had to pick a name from a
 * dropdown before seeing whether that agent needed one.
 *
 * The override is now edited from the agent's own row in `AgentPracticeRoster`,
 * where their usage already is. Every agent is in that list whether or not they
 * have an override, so there is nothing to "add" — only limits to set. The
 * boxes themselves are shared (`limit-fields.tsx`), so the two editors cannot
 * drift apart.
 */

import { useCallback, useEffect, useState } from 'react';
import { pronunciationLimitsApi, type PronunciationLimitsResponse } from '@/lib/api';
import {
  BLANK_DRAFT,
  LimitRows,
  bodyFrom,
  draftFrom,
  type LimitKey,
} from './limit-fields';

export function PracticeLimits({ token, onSaved }: { token: string | null; onSaved?: () => void }) {
  const [data, setData] = useState<PronunciationLimitsResponse | null>(null);
  const [draft, setDraft] = useState(BLANK_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const limits = await pronunciationLimitsApi.get(token);
      setData(limits.data);
      setDraft(draftFrom(limits.data.global));
    } catch (err) {
      setError((err as Error)?.message || 'Could not load practice limits.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const envDefault = data?.environmentDefault.dailyAttemptLimit;

  /** Only daily attempts has a server-provided fallback; the rest are uncapped. */
  const placeholderFor = (key: LimitKey) =>
    key === 'dailyAttemptLimit' && envDefault !== undefined ? `${envDefault}` : 'no limit';

  async function save(): Promise<void> {
    if (!token) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await pronunciationLimitsApi.setGlobal(token, bodyFrom(draft));
      setNotice('Saved. These apply to every agent without their own limits.');
      await load();
      // The agent list shows what each agent inherits, so it has to re-read.
      onSaved?.();
    } catch (err) {
      setError((err as Error)?.message || 'That change could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bean-card rounded-[18px] border p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-bold tracking-[-0.01em] text-bean-ink">Practice limits</h2>
          <p className="mt-0.5 max-w-[70ch] text-[12px] text-bean-muted">
            Applies to every agent without their own limits. Attempts are billed per second of
            audio, and every limit you set is enforced — the tightest one applies. Leave a box{' '}
            <b>empty to inherit</b>; enter <b>0</b> to switch practice off.
          </p>
        </div>
        {envDefault !== undefined && (
          <span className="rounded-full bg-bean-line/40 px-2.5 py-1 font-mono-ui text-[10px] uppercase tracking-[0.08em] text-bean-muted">
            Server default: {envDefault}/day
          </span>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-bean-live/40 bg-bean-live/10 px-3 py-2">
          <span className="text-[13px] font-medium text-bean-live">{error}</span>
        </div>
      )}
      {notice && (
        <div className="mb-3 rounded-xl border border-bean-brand/30 bg-bean-brand/10 px-3 py-2">
          <span className="text-[13px] font-medium text-bean-brand">{notice}</span>
        </div>
      )}

      {loading ? (
        <p className="text-[14px] text-bean-muted">Loading limits…</p>
      ) : (
        <>
          <LimitRows
            draft={draft}
            onChange={(key, value) => setDraft((d) => ({ ...d, [key]: value }))}
            placeholderFor={placeholderFor}
          />
          <div className="mt-4 flex items-center justify-end gap-3">
            {data?.global?.updatedAt && (
              <span className="text-[11.5px] text-bean-faint">
                Last changed {new Date(data.global.updatedAt).toLocaleDateString()}
              </span>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-[10px] bg-bean-brand px-4 py-2 text-[13.5px] font-semibold text-white transition hover:bg-bean-brand-bright disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save limits for everyone'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
