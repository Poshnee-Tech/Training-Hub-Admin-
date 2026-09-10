'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AdminSidebar from '@/components/layout/AdminSidebar';
import { useAuthStore } from '@/store/auth.store';
import { admin } from '@/lib/api';
import { formatDate } from '@/lib/utils';

/** Chip tints in the warm content theme — blue/purple/green are the legacy
    light palette and would punch through the cream surface here. */
function campaignChip(campaign?: string) {
  switch (campaign) {
    case 'ACA':
      return 'border-bean-brand/35 bg-bean-brand/10 text-bean-brand';
    case 'MEDICARE':
      return 'admin-pill-campaign-medicare';
    case 'MED_ALERT':
      return 'border-bean-live/35 bg-bean-live/10 text-bean-live';
    default:
      return 'border-bean-line bg-bean-card2 text-bean-muted';
  }
}

function difficultyChip(difficulty?: string) {
  switch (difficulty) {
    case 'EASY':
      return 'admin-pill-difficulty-easy';
    case 'MEDIUM':
      return 'border-bean-gold/40 bg-bean-gold/12 text-bean-gold';
    case 'HARD':
      return 'border-bean-live/35 bg-bean-live/10 text-bean-live';
    default:
      return 'border-bean-line bg-bean-card2 text-bean-muted';
  }
}

function scoreChip(score: number) {
  return score >= 80
    ? 'border-bean-brand/35 bg-bean-brand/10 text-bean-brand'
    : score >= 60
      ? 'border-bean-gold/40 bg-bean-gold/12 text-bean-gold'
      : 'border-bean-live/35 bg-bean-live/10 text-bean-live';
}

function statusChip(status?: string) {
  switch (status) {
    case 'COMPLETED':
      return 'admin-pill-status-completed';
    case 'ACTIVE':
      return 'admin-pill-status-active';
    case 'FAILED':
      return 'border-bean-live/35 bg-bean-live/10 text-bean-live';
    case 'WAITING':
      return 'border-bean-gold/40 bg-bean-gold/12 text-bean-gold';
    default:
      return 'border-bean-line bg-bean-card2 text-bean-muted';
  }
}

export default function CallsPage() {
  const { token, loadFromStorage } = useAuthStore();

  const [calls, setCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ campaign: '', status: '' });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (!token) return;
    void loadCalls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, page, filters.campaign, filters.status]);

  async function loadCalls() {
    if (!token) return;

    setLoading(true);
    setError('');

    try {
      const params: any = {
        page: String(page),
        limit: '15',
      };

      if (filters.campaign) params.campaign = filters.campaign;
      if (filters.status) params.status = filters.status;

      const res = await admin.listCalls(token, params);
      setCalls(res.data);
      setPagination(res.pagination);
    } catch (err: any) {
      setError(err.message || 'Could not load call history.');
    } finally {
      setLoading(false);
    }
  }

  const hasFilters = !!filters.campaign || !!filters.status;

  const pageStats = useMemo(() => {
    const completed = calls.filter((call) => call.status === 'COMPLETED').length;
    const active = calls.filter((call) => call.status === 'ACTIVE').length;
    const failed = calls.filter((call) => call.status === 'FAILED').length;
    const scores = calls
      .map((call) => call.evaluation?.overallScore)
      .filter((score): score is number => typeof score === 'number');

    const average =
      scores.length > 0
        ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
        : null;

    return {
      completed,
      active,
      failed,
      scored: scores.length,
      average,
    };
  }, [calls]);

  const totalRecords =
    typeof pagination?.total === 'number'
      ? pagination.total
      : typeof pagination?.totalItems === 'number'
        ? pagination.totalItems
        : null;

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
                <span className="font-mono-ui text-[11px] font-bold uppercase tracking-[0.12em] text-bean-faint">
                  Call activity
                </span>
              </div>

              <h1 className="font-display text-[28px] font-extrabold tracking-[-0.035em] text-bean-ink">
                Call History
              </h1>

              <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-bean-muted">
                Review training sessions across agents, campaigns, and scenarios,
                then open any call for its complete evaluation and conversation detail.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void loadCalls()}
              disabled={loading}
              className="bean-card inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-semibold text-bean-muted transition hover:border-bean-line2 hover:text-bean-ink disabled:opacity-50"
            >
              <RefreshGlyph
                className={`h-4 w-4 stroke-current ${loading ? 'animate-spin' : ''}`}
              />
              Refresh
            </button>
          </header>

          {/* Snapshot for currently loaded page */}
          {!loading && (
            <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard
                label={totalRecords !== null ? 'Total matching calls' : 'Calls on this page'}
                value={totalRecords ?? calls.length}
                helper={hasFilters ? 'Current filters' : 'Current history'}
              />

              <MetricCard
                label="Completed"
                value={pageStats.completed}
                helper="On this page"
              />

              <MetricCard
                label="Active"
                value={pageStats.active}
                helper={pageStats.failed > 0 ? `${pageStats.failed} failed on page` : 'On this page'}
              />

              <MetricCard
                label="Average score"
                value={pageStats.average === null ? '—' : `${pageStats.average}%`}
                helper={
                  pageStats.scored
                    ? `${pageStats.scored} scored call${pageStats.scored === 1 ? '' : 's'} on page`
                    : 'No scored calls on page'
                }
              />
            </section>
          )}

          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-bean-live/40 bg-bean-live/10 px-4 py-3.5"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bean-live/15 text-[12px] font-bold text-bean-live">
                  !
                </span>
                <p className="min-w-0 text-[13.5px] font-medium leading-relaxed text-bean-live">
                  {error}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadCalls()}
                  className="text-[12.5px] font-semibold text-bean-live"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => setError('')}
                  className="text-[12.5px] font-semibold text-bean-muted hover:text-bean-ink"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Filters */}
          <section className="bean-card mb-5 rounded-[18px] border p-3.5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
              <div className="min-w-0 flex-1">
                <Label>Campaign</Label>
                <select
                  className={`${FIELD} w-full xl:max-w-[260px]`}
                  value={filters.campaign}
                  onChange={(event) => {
                    setFilters((current) => ({
                      ...current,
                      campaign: event.target.value,
                    }));
                    setPage(1);
                  }}
                >
                  <option value="">All campaigns</option>
                  <option value="ACA">ACA</option>
                  <option value="MEDICARE">Medicare</option>
                  <option value="MED_ALERT">Med Alert</option>
                </select>
              </div>

              <div className="min-w-0 flex-1">
                <Label>Status</Label>
                <select
                  className={`${FIELD} w-full xl:max-w-[260px]`}
                  value={filters.status}
                  onChange={(event) => {
                    setFilters((current) => ({
                      ...current,
                      status: event.target.value,
                    }));
                    setPage(1);
                  }}
                >
                  <option value="">All statuses</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="ACTIVE">Active</option>
                  <option value="WAITING">Waiting</option>
                  <option value="FAILED">Failed</option>
                </select>
              </div>

              {hasFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setFilters({ campaign: '', status: '' });
                    setPage(1);
                  }}
                  className="rounded-xl px-3 py-2.5 text-[12.5px] font-semibold text-bean-muted transition hover:bg-bean-card2 hover:text-bean-brand"
                >
                  Clear filters
                </button>
              )}

              <div className="xl:ml-auto">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bean-faint">
                  {loading
                    ? 'Loading calls…'
                    : `${calls.length} call${calls.length === 1 ? '' : 's'} on this page`}
                </p>
              </div>
            </div>
          </section>

          {/* Calls table */}
          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold tracking-[-0.01em] text-bean-ink">
                  Session ledger
                </h2>
                <p className="mt-0.5 text-[12.5px] text-bean-muted">
                  Open a call to inspect its transcript, scoring, evaluation, and session details.
                </p>
              </div>

              {pagination?.pages > 1 && (
                <span className="font-mono-ui text-[10px] uppercase tracking-[0.1em] text-bean-faint">
                  Page {pagination.page ?? page} of {pagination.pages}
                </span>
              )}
            </div>

            <div className="bean-card overflow-hidden rounded-[20px] border">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1040px]">
                  <thead>
                    <tr className="border-b border-bean-line bg-bean-card2/70 text-left font-mono-ui text-[10px] font-bold uppercase tracking-[0.08em] text-bean-faint">
                      <th className="px-5 py-3.5 lg:px-6">Agent</th>
                      <th className="px-5 py-3.5 lg:px-6">Scenario</th>
                      <th className="px-5 py-3.5 lg:px-6">Campaign</th>
                      <th className="px-5 py-3.5 lg:px-6">Difficulty</th>
                      <th className="px-5 py-3.5 lg:px-6">Score</th>
                      <th className="px-5 py-3.5 lg:px-6">Status</th>
                      <th className="px-5 py-3.5 lg:px-6">Date</th>
                      <th className="px-5 py-3.5 text-right lg:px-6">Action</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-bean-line">
                    {calls.map((call) => {
                      const fullName = `${call.user?.firstName ?? ''} ${call.user?.lastName ?? ''}`.trim();
                      const initials = `${call.user?.firstName?.[0] ?? ''}${call.user?.lastName?.[0] ?? ''}`.toUpperCase();

                      return (
                        <tr
                          key={call.id}
                          className="transition-colors hover:bg-bean-card2/50"
                        >
                          <td className="px-5 py-4 lg:px-6">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-bean-line bg-bean-card2 font-mono-ui text-[10.5px] font-bold text-bean-brand">
                                {initials || '·'}
                              </span>

                              <span className="min-w-0">
                                <span className="block truncate text-[13px] font-semibold text-bean-ink">
                                  {fullName || 'Unknown agent'}
                                </span>

                                {call.user?.email && (
                                  <span className="mt-0.5 block truncate text-[10.5px] text-bean-faint">
                                    {call.user.email}
                                  </span>
                                )}
                              </span>
                            </div>
                          </td>

                          <td className="px-5 py-4 lg:px-6">
                            <div className="min-w-0">
                              <span className="block max-w-[260px] truncate text-[13px] font-medium text-bean-ink">
                                {call.scenario?.name || '—'}
                              </span>

                              {call.scenario?.personaName && (
                                <span className="mt-0.5 block max-w-[260px] truncate text-[10.5px] text-bean-faint">
                                  {call.scenario.personaName}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="px-5 py-4 lg:px-6">
                            <Chip className={campaignChip(call.scenario?.campaign)}>
                              {call.scenario?.campaign?.replace('_', ' ') || '—'}
                            </Chip>
                          </td>

                          <td className="px-5 py-4 lg:px-6">
                            <Chip className={difficultyChip(call.scenario?.difficulty)}>
                              {call.scenario?.difficulty || '—'}
                            </Chip>
                          </td>

                          <td className="px-5 py-4 lg:px-6">
                            {call.evaluation ? (
                              <Chip
                                className={`font-bold ${scoreChip(
                                  call.evaluation.overallScore,
                                )}`}
                              >
                                {call.evaluation.overallScore}%
                              </Chip>
                            ) : (
                              <span className="font-mono-ui text-[12px] text-bean-faint">
                                —
                              </span>
                            )}
                          </td>

                          <td className="px-5 py-4 lg:px-6">
                            <Chip className={statusChip(call.status)}>
                              {call.status || '—'}
                            </Chip>
                          </td>

                          <td className="px-5 py-4 lg:px-6">
                            <span className="text-[12px] text-bean-muted">
                              {formatDate(call.createdAt)}
                            </span>
                          </td>

                          <td className="px-5 py-4 text-right lg:px-6">
                            <Link
                              href={`/calls/${call.id}`}
                              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-bean-brand transition hover:bg-bean-brand/10 hover:text-bean-brand-bright"
                            >
                              View details
                              <ArrowGlyph className="h-3.5 w-3.5 stroke-current" />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {loading && calls.length === 0 && <TableSkeleton />}

              {!loading && calls.length === 0 && (
                <div className="px-6 py-16 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-bean-line bg-bean-card2 text-bean-brand">
                    <PhoneGlyph className="h-5 w-5 stroke-current" />
                  </div>

                  <h3 className="mt-4 text-[15px] font-bold text-bean-ink">
                    {hasFilters ? 'No matching calls' : 'No calls yet'}
                  </h3>

                  <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-bean-muted">
                    {hasFilters
                      ? 'Try widening the campaign or status filters.'
                      : 'Training sessions will appear here once agents start making calls.'}
                  </p>

                  {hasFilters && (
                    <button
                      type="button"
                      onClick={() => {
                        setFilters({ campaign: '', status: '' });
                        setPage(1);
                      }}
                      className="mt-5 rounded-xl border border-bean-line bg-bean-card px-4 py-2.5 text-[13px] font-semibold text-bean-muted transition hover:border-bean-line2 hover:text-bean-ink"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Pagination */}
          {pagination && pagination.pages > 1 && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-bean-line bg-bean-card px-4 py-3.5">
              <div>
                <p className="text-[12.5px] font-semibold text-bean-ink">
                  Page {pagination.page ?? page} of {pagination.pages}
                </p>

                {totalRecords !== null && (
                  <p className="mt-0.5 text-[10.5px] text-bean-faint">
                    {totalRecords} matching call{totalRecords === 1 ? '' : 's'}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Btn
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1 || loading}
                  className="px-3.5 py-2 text-[12px]"
                >
                  <ArrowLeftGlyph className="h-3.5 w-3.5 stroke-current" />
                  Previous
                </Btn>

                <Btn
                  onClick={() => setPage((current) => current + 1)}
                  disabled={page >= pagination.pages || loading}
                  className="px-3.5 py-2 text-[12px]"
                >
                  Next
                  <ArrowGlyph className="h-3.5 w-3.5 stroke-current" />
                </Btn>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/* ── supporting UI ─────────────────────────────────────────── */

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: React.ReactNode;
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

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.06em] text-bean-faint">
      {children}
    </label>
  );
}

function TableSkeleton() {
  return (
    <div className="border-t border-bean-line">
      {[0, 1, 2, 3, 4].map((item) => (
        <div
          key={item}
          className="grid min-w-[1040px] grid-cols-8 items-center gap-5 border-b border-bean-line px-6 py-4 last:border-b-0"
        >
          <div className="h-9 animate-pulse rounded-xl bg-bean-card2" />
          <div className="h-8 animate-pulse rounded-lg bg-bean-card2" />
          <div className="h-6 animate-pulse rounded-lg bg-bean-card2" />
          <div className="h-6 animate-pulse rounded-lg bg-bean-card2" />
          <div className="h-6 animate-pulse rounded-lg bg-bean-card2" />
          <div className="h-6 animate-pulse rounded-lg bg-bean-card2" />
          <div className="h-7 animate-pulse rounded-lg bg-bean-card2" />
          <div className="h-7 animate-pulse rounded-lg bg-bean-card2" />
        </div>
      ))}
    </div>
  );
}

/* ── controls ───────────────────────────────────────────────── */

function Chip({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={`admin-pill ${className}`}>{children}</span>;
}

function Btn({
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl border border-bean-line bg-bean-card px-3.5 py-2 text-[13px] font-semibold text-bean-muted transition duration-150 hover:border-bean-line2 hover:text-bean-ink disabled:cursor-not-allowed disabled:opacity-50';

  return <button {...rest} className={`${base} ${className}`} />;
}

/** Themed text input; the global .input is white-on-grey in the bright theme. */
const FIELD =
  'block rounded-xl border border-bean-line bg-bean-card px-3.5 py-2.5 text-[13.5px] text-bean-ink outline-none transition placeholder:text-bean-faint focus:border-bean-brand';

/* ── glyphs ────────────────────────────────────────────────── */

const S = {
  fill: 'none',
  strokeWidth: 1.9,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
} as const;

const d = (path: string) => (
  <path strokeLinecap="round" strokeLinejoin="round" d={path} />
);

function RefreshGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {d('M20 6v5h-5M4 18v-5h5M18.4 9A7 7 0 0 0 6.2 6.2L4 8M5.6 15A7 7 0 0 0 17.8 17.8L20 16')}
    </svg>
  );
}

function ArrowGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S} strokeWidth={2.2}>
      {d('M5 12h14M13 6l6 6-6 6')}
    </svg>
  );
}

function ArrowLeftGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S} strokeWidth={2.2}>
      {d('M19 12H5m6 6-6-6 6-6')}
    </svg>
  );
}

function PhoneGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {d('M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07A19.5 19.5 0 0 1 5.15 12.8 19.8 19.8 0 0 1 2.08 4.18 2 2 0 0 1 4.07 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.7a16 16 0 0 0 6 6l1.24-1.24a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92Z')}
    </svg>
  );
}
