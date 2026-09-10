'use client';

/**
 * Admin settings: what trainees may see, and this admin's own credentials.
 *
 * The backend change-password endpoint is generic (Bearer or cookie, verifies
 * the current password, stores the new hash), so this page works out of the
 * box with the admin token; no new backend surface was needed.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminSidebar from '@/components/layout/AdminSidebar';
import { useAuthStore } from '@/store/auth.store';
import { auth, settingsApi } from '@/lib/api';

export default function SettingsPage() {
  const { token, loadFromStorage } = useAuthStore();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  /**
   * ── WHAT TRAINEES SEE ON THEIR OWN REPORTS ────────────────────────────────
   * `null` while it is being read, so the switch is never drawn in a position
   * it might not actually be in.
   */
  const [reportDetail, setReportDetail] = useState<boolean | null>(null);
  const [savingDetail, setSavingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  useEffect(() => {
    if (!token) return;
    settingsApi.get(token)
      .then((res) => setReportDetail(res.data.agentReportDetail))
      .catch(() => setDetailError('Could not read the current setting.'));
  }, [token]);

  const toggleReportDetail = async () => {
    if (!token || reportDetail === null || savingDetail) return;
    const next = !reportDetail;
    setSavingDetail(true);
    setDetailError('');
    try {
      const res = await settingsApi.update(token, { agentReportDetail: next });
      setReportDetail(res.data.agentReportDetail);
    } catch {
      // The switch stays where it was: a failed save must not look like a
      // successful one.
      setDetailError('That did not save. Try again.');
    } finally {
      setSavingDetail(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (form.next.length < 8) {
      setError('The new password must be at least 8 characters.');
      return;
    }
    if (form.next !== form.confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    if (form.next === form.current) {
      setError('The new password must be different from the current one.');
      return;
    }

    setLoading(true);
    try {
      await auth.changePassword(form.current, form.next);
      setForm({ current: '', next: '', confirm: '' });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Could not change the password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex">
      <AdminSidebar />

      <main className="ml-64 min-w-0 flex-1 px-6 py-7 lg:px-8">
        {/* Contained and centred, like every other admin page: two `max-w-lg`
            cards in a full-width main left most of the screen empty and the
            page reading as unfinished. */}
        <div className="mx-auto w-full max-w-[1100px]">
        <header className="mb-8">
          <span className="mb-3 inline-flex items-center gap-2.5 rounded-full border border-air-amber/30 bg-air-amber/[0.07] px-3.5 py-[7px] font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.2em] text-air-amber">
            <span className="h-[7px] w-[7px] rounded-full bg-air-amber shadow-[0_0_10px_rgb(var(--air-amber))] animate-air-blink" />
            Settings
          </span>
          <h1 className="font-display text-[26px] font-extrabold tracking-[-0.02em] text-air-text">
            Settings
          </h1>
          <p className="mt-1.5 max-w-xl text-[13.5px] leading-relaxed text-air-muted">
            What trainees are shown on their own reports, and the password for your admin sign-in.
          </p>
        </header>

        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        {/* ── QA report visibility ──────────────────────────────────────── */}
        <section className="air-panel rounded-2xl border p-7">
          <h2 className="font-display text-[17px] font-bold tracking-[-0.01em] text-air-text">
            QA breakdown for trainees
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-air-muted">
            Off, a trainee sees the score their call earned and the transcript of their own call,
            and nothing else. On, their report shows the full breakdown: every section and check,
            the written feedback, the voice and accent measurements, and their coaching.
            Your own view here is never affected.
          </p>

          {detailError && (
            <div className="mt-4 rounded-xl border border-air-live/30 bg-air-live/10 px-4 py-3 text-[13.5px] font-semibold text-air-live">
              {detailError}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-air-line bg-air-panel/40 px-4 py-3.5">
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-air-text">
                Trainees can see the detailed QA breakdown
              </div>
              <div className="mt-0.5 text-[12.5px] text-air-muted">
                {reportDetail === null
                  ? 'Reading the current setting…'
                  : reportDetail
                    ? 'On — trainees see the full report for their own calls.'
                    : 'Off — trainees see the score only.'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={reportDetail === true}
              aria-label="Trainees can see the detailed QA breakdown"
              data-testid="agent-report-detail-toggle"
              disabled={reportDetail === null || savingDetail}
              onClick={() => void toggleReportDetail()}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${reportDetail ? 'bg-air-mint' : 'bg-air-line'}`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${reportDetail ? 'left-6' : 'left-1'}`}
              />
            </button>
          </div>
          {savingDetail && <p className="mt-2 text-[12.5px] text-air-faint">Saving…</p>}
        </section>

        {/* ── Credentials ───────────────────────────────────────────────── */}
        <div className="air-panel rounded-2xl border p-7">
          <h2 className="mb-1.5 font-display text-[17px] font-bold tracking-[-0.01em] text-air-text">
            Change password
          </h2>
          <p className="mb-6 text-[13.5px] leading-relaxed text-air-muted">
            Updates the password for your own admin sign-in. Your next session uses the new one;
            existing sessions stay valid.
          </p>
          {success && (
            <div className="mb-6 rounded-xl border border-air-mint/30 bg-air-mint/10 px-4 py-3 text-[13.5px] font-semibold text-air-mint">
              Password updated successfully.
            </div>
          )}

          {error && (
            <div className="mb-6 rounded-xl border border-air-live/30 bg-air-live/10 px-4 py-3 text-[13.5px] font-semibold text-air-live">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" suppressHydrationWarning>
            <div>
              <label htmlFor="current" className="mb-1.5 block text-[13px] font-semibold text-air-text">
                Current password
              </label>
              <input
                id="current"
                type="password"
                required
                autoComplete="current-password"
                className="input"
                placeholder="Your current admin password"
                value={form.current}
                onChange={(e) => setForm({ ...form, current: e.target.value })}
                suppressHydrationWarning
              />
            </div>

            <div>
              <label htmlFor="next" className="mb-1.5 block text-[13px] font-semibold text-air-text">
                New password
              </label>
              <input
                id="next"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="input"
                placeholder="Min. 8 characters"
                value={form.next}
                onChange={(e) => setForm({ ...form, next: e.target.value })}
                suppressHydrationWarning
              />
              <p className="mt-1.5 text-xs text-air-faint">At least 8 characters.</p>
            </div>

            <div>
              <label htmlFor="confirm" className="mb-1.5 block text-[13px] font-semibold text-air-text">
                Confirm new password
              </label>
              <input
                id="confirm"
                type="password"
                required
                autoComplete="new-password"
                className="input"
                placeholder="Repeat the new password"
                value={form.confirm}
                onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                suppressHydrationWarning
              />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? 'Saving…' : 'Update password'}
              </button>
              <Link
                href="/dashboard"
                className="text-[13px] font-semibold text-air-muted transition-colors hover:text-air-text"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>
        </div>
        </div>
      </main>
    </div>
  );
}