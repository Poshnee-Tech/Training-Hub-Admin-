'use client';

/**
 * Signup requests.
 *
 * Public signup no longer creates an account — it files a request that lands
 * here. Approving is what creates the user; rejecting keeps the row so the
 * same address cannot quietly reapply into a fresh pending state.
 *
 * The applicant is emailed either way, from the server. Rejecting asks for a
 * confirmation rather than a reason — it cannot be undone from this screen, so
 * a single stray click should not decide it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminSidebar from '@/components/layout/AdminSidebar';
import { useAuthStore } from '@/store/auth.store';
import { admin, type SignupRequest, type SignupRequestStatus } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const TABS: { key: SignupRequestStatus | 'ALL'; label: string }[] = [
  { key: 'PENDING', label: 'Waiting' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'ALL', label: 'All' },
];

export default function SignupRequestsPage() {
  const { token, loadFromStorage } = useAuthStore();

  const [tab, setTab] = useState<SignupRequestStatus | 'ALL'>('PENDING');
  const [rows, setRows] = useState<SignupRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  /** The row whose Reject button is waiting on a confirmation. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const load = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError('');

    try {
      const res = await admin.listSignupRequests(
        token,
        tab === 'ALL' ? undefined : tab,
      );
      setRows(res.data);
    } catch (err: any) {
      setError(err.message || 'Could not load signup requests.');
    } finally {
      setLoading(false);
    }
  }, [token, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(row: SignupRequest) {
    if (!token) return;

    setBusyId(row.id);
    setError('');
    setNotice('');

    try {
      await admin.approveSignupRequest(token, row.id);
      setNotice(
        `${row.firstName} ${row.lastName} approved. They have been emailed.`,
      );
      setConfirming(null);
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not approve that request.');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(row: SignupRequest) {
    if (!token) return;

    setBusyId(row.id);
    setError('');
    setNotice('');

    try {
      await admin.rejectSignupRequest(token, row.id);
      setNotice(
        `${row.firstName} ${row.lastName} rejected. They have been emailed.`,
      );
      setConfirming(null);
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not reject that request.');
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(
    () => ({
      total: rows.length,
      pending: rows.filter((row) => row.status === 'PENDING').length,
      approved: rows.filter((row) => row.status === 'APPROVED').length,
      rejected: rows.filter((row) => row.status === 'REJECTED').length,
    }),
    [rows],
  );

  function tabCount(key: SignupRequestStatus | 'ALL') {
    if (key === 'ALL') return counts.total;
    if (key === 'PENDING') return counts.pending;
    if (key === 'APPROVED') return counts.approved;
    return counts.rejected;
  }

  return (
    <div className="flex">
      <AdminSidebar />

      <main className="bean-scope relative ml-64 min-h-screen flex-1 bg-bean-bg px-6 py-7 font-body text-bean-ink antialiased lg:px-8">
        <div className="mx-auto w-full max-w-[1500px]">
          {/* Header */}
          <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-bean-brand" />
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-bean-faint">
                  Access requests
                </span>
              </div>

              <h1 className="font-display text-[28px] font-extrabold tracking-[-0.035em] text-bean-ink">
                Signup Requests
              </h1>

              <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-bean-muted">
                Review people who requested access and confirmed their email.
                Approving creates the account; rejecting keeps the request recorded
                and informs the applicant.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="bean-card inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-semibold text-bean-muted transition hover:border-bean-line2 hover:text-bean-ink disabled:opacity-50"
            >
              <RefreshGlyph
                className={`h-4 w-4 stroke-current ${loading ? 'animate-spin' : ''}`}
              />
              Refresh
            </button>
          </header>

          {/* Summary */}
          {!loading && (
            <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard
                label="Requests shown"
                value={counts.total}
                helper={tab === 'ALL' ? 'All statuses' : `${tab.toLowerCase()} filter`}
              />
              <MetricCard
                label="Waiting"
                value={counts.pending}
                helper="Needs a decision"
              />
              <MetricCard
                label="Approved"
                value={counts.approved}
                helper="Accounts created"
              />
              <MetricCard
                label="Rejected"
                value={counts.rejected}
                helper="Requests declined"
              />
            </section>
          )}

          {/* Status tabs */}
          <section className="bean-card mb-5 rounded-[18px] border p-3">
            <div
              className="flex flex-wrap items-center gap-2"
              role="tablist"
              aria-label="Signup request status"
            >
              {TABS.map((item) => {
                const active = tab === item.key;

                return (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setTab(item.key);
                      setConfirming(null);
                      setNotice('');
                      setError('');
                    }}
                    className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[12.5px] font-semibold transition ${
                      active
                        ? 'border-transparent bg-gradient-to-r from-bean-brand to-bean-brand-bright text-white'
                        : 'border-bean-line bg-bean-card2/40 text-bean-muted hover:border-bean-line2 hover:text-bean-ink'
                    }`}
                  >
                    {item.label}
                    <span
                      className={`rounded-full px-1.5 py-0.5 font-mono-ui text-[9.5px] font-bold ${
                        active
                          ? 'bg-white/20 text-white'
                          : 'bg-bean-card text-bean-muted'
                      }`}
                    >
                      {tabCount(item.key)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {notice && (
            <div
              className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-bean-brand/30 bg-bean-brand/[0.08] px-4 py-3.5"
              role="status"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bean-brand/15 text-[12px] font-bold text-bean-brand">
                  ✓
                </span>
                <p className="min-w-0 text-[13.5px] font-medium leading-relaxed text-bean-ink">
                  {notice}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setNotice('')}
                className="shrink-0 text-[12.5px] font-semibold text-bean-brand hover:text-bean-brand-bright"
              >
                Dismiss
              </button>
            </div>
          )}

          {error && (
            <div
              className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-bean-live/40 bg-bean-live/10 px-4 py-3.5"
              role="alert"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bean-live/15 text-[12px] font-bold text-bean-live">
                  !
                </span>
                <p className="min-w-0 text-[13.5px] font-medium leading-relaxed text-bean-live">
                  {error}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setError('')}
                className="shrink-0 text-[12.5px] font-semibold text-bean-live"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Request list */}
          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold tracking-[-0.01em] text-bean-ink">
                  Request queue
                </h2>
                <p className="mt-0.5 text-[12.5px] text-bean-muted">
                  Approvals create accounts immediately. Rejections are permanent
                  from this screen.
                </p>
              </div>

              <span className="text-[12px] text-bean-faint">
                {loading
                  ? 'Loading…'
                  : `${rows.length} request${rows.length === 1 ? '' : 's'} shown`}
              </span>
            </div>

            {loading ? (
              <RequestSkeletons />
            ) : rows.length === 0 ? (
              <EmptyState tab={tab} />
            ) : (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {rows.map((row) => {
                  const fullName = `${row.firstName} ${row.lastName}`;
                  const isBusy = busyId === row.id;
                  const isConfirming = confirming === row.id;

                  return (
                    <article
                      key={row.id}
                      className="bean-card flex min-h-[190px] flex-col overflow-hidden rounded-[18px] border transition hover:border-bean-line2"
                    >
                      <div className="flex flex-1 flex-col p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-bean-line bg-bean-card2 text-[11px] font-extrabold text-bean-brand">
                              {row.firstName?.[0]}
                              {row.lastName?.[0]}
                            </div>

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="truncate text-[15px] font-bold tracking-[-0.01em] text-bean-ink">
                                  {fullName}
                                </h3>
                                <StatusPill status={row.status} />
                              </div>

                              <p className="mt-1 truncate text-[12.5px] font-medium text-bean-muted">
                                {row.email}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <InfoTile
                            label="Requested"
                            value={formatDate(row.createdAt)}
                          />
                          <InfoTile
                            label="Decision"
                            value={
                              row.reviewedAt
                                ? formatDate(row.reviewedAt)
                                : 'Awaiting review'
                            }
                          />
                        </div>

                        {row.status === 'PENDING' && isConfirming && (
                          <div className="mt-4 rounded-2xl border border-bean-live/30 bg-bean-live/[0.06] p-3.5">
                            <p className="text-[12.5px] font-semibold text-bean-live">
                              Reject {fullName}?
                            </p>
                            <p className="mt-1 text-[11.75px] leading-relaxed text-bean-muted">
                              The applicant will be emailed and this request cannot
                              be returned to Waiting from this page.
                            </p>
                          </div>
                        )}
                      </div>

                      {row.status === 'PENDING' ? (
                        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-bean-line bg-bean-card2/40 px-5 py-3.5">
                          {isConfirming ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setConfirming(null)}
                                disabled={isBusy}
                                className="rounded-xl border border-bean-line bg-bean-card px-3.5 py-2 text-[12.5px] font-semibold text-bean-muted transition hover:border-bean-line2 hover:text-bean-ink disabled:opacity-50"
                              >
                                Keep request
                              </button>

                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void reject(row)}
                                className="rounded-xl bg-bean-live px-3.5 py-2 text-[12.5px] font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                              >
                                {isBusy ? 'Rejecting…' : 'Confirm Reject'}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => {
                                  setConfirming(row.id);
                                  setError('');
                                }}
                                className="rounded-xl border border-bean-live/30 bg-bean-live/[0.05] px-3.5 py-2 text-[12.5px] font-bold text-bean-live transition hover:bg-bean-live/10 disabled:opacity-50"
                              >
                                Reject
                              </button>

                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void approve(row)}
                                className="rounded-xl bg-gradient-to-r from-bean-brand to-bean-brand-bright px-4 py-2 text-[12.5px] font-bold text-white transition hover:-translate-y-px disabled:translate-y-0 disabled:opacity-50"
                              >
                                {isBusy ? 'Approving…' : 'Approve & Create Account'}
                              </button>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="border-t border-bean-line bg-bean-card2/35 px-5 py-3 text-[11.5px] text-bean-faint">
                          {row.status === 'APPROVED'
                            ? 'Account created and applicant notified.'
                            : 'Applicant notified that the request was not approved.'}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: number;
  helper: string;
}) {
  return (
    <div className="bean-card rounded-[16px] border px-4 py-3.5">
      <div className="text-[11.5px] font-semibold text-bean-muted">{label}</div>
      <div className="mt-1 font-display text-[22px] font-extrabold tracking-[-0.03em] text-bean-ink">
        {value}
      </div>
      <div className="mt-0.5 text-[10.5px] text-bean-faint">{helper}</div>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-bean-line bg-bean-card2/50 px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-bean-faint">
        {label}
      </div>
      <div className="mt-1 text-[12px] font-semibold text-bean-ink">{value}</div>
    </div>
  );
}

function EmptyState({ tab }: { tab: SignupRequestStatus | 'ALL' }) {
  const title =
    tab === 'PENDING'
      ? 'No requests are waiting'
      : tab === 'APPROVED'
        ? 'No approved requests'
        : tab === 'REJECTED'
          ? 'No rejected requests'
          : 'No signup requests yet';

  const description =
    tab === 'PENDING'
      ? 'Nobody is waiting for approval right now.'
      : tab === 'ALL'
        ? 'New confirmed signup requests will appear here.'
        : 'No requests have this status yet.';

  return (
    <div className="bean-card flex min-h-[320px] flex-col items-center justify-center rounded-[20px] border border-dashed px-6 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl border border-bean-line bg-bean-card2 text-bean-brand">
        <InboxGlyph className="h-5 w-5 stroke-current" />
      </div>
      <h3 className="mt-4 text-[15px] font-bold text-bean-ink">{title}</h3>
      <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-bean-muted">
        {description}
      </p>
    </div>
  );
}

function RequestSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {[0, 1, 2, 3].map((item) => (
        <div
          key={item}
          className="bean-card min-h-[190px] animate-pulse rounded-[18px] border p-5"
        >
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-bean-card2" />
            <div className="flex-1">
              <div className="h-4 w-1/3 rounded bg-bean-card2" />
              <div className="mt-2 h-3 w-1/2 rounded bg-bean-card2" />
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <div className="h-14 rounded-xl bg-bean-card2" />
            <div className="h-14 rounded-xl bg-bean-card2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: SignupRequestStatus }) {
  const style =
    status === 'APPROVED'
      ? 'border-bean-brand/40 bg-bean-brand/10 text-bean-brand'
      : status === 'REJECTED'
        ? 'border-bean-live/40 bg-bean-live/10 text-bean-live'
        : 'border-bean-gold/45 bg-bean-gold/12 text-bean-gold';

  const label =
    status === 'APPROVED'
      ? 'Approved'
      : status === 'REJECTED'
        ? 'Rejected'
        : 'Waiting';

  return (
    <span
      className={`inline-flex items-center rounded-lg border px-2.5 py-1 font-mono-ui text-[10px] font-bold uppercase tracking-[0.08em] ${style}`}
    >
      {label}
    </span>
  );
}

const S = {
  fill: 'none',
  strokeWidth: 1.9,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
} as const;

const g = (d: string) => (
  <path strokeLinecap="round" strokeLinejoin="round" d={d} />
);

function RefreshGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {g('M20 6v5h-5M4 18v-5h5M18.4 9A7 7 0 0 0 6.2 6.2L4 8M5.6 15A7 7 0 0 0 17.8 17.8L20 16')}
    </svg>
  );
}

function InboxGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {g('M4 4h16v16H4zM4 14h4l2 3h4l2-3h4')}
    </svg>
  );
}
