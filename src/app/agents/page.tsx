'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import AdminSidebar from '@/components/layout/AdminSidebar';
import EnrollAgentModal from '@/components/agents/EnrollAgentModal';
import { useAuthStore } from '@/store/auth.store';
import { admin } from '@/lib/api';
import { formatDate } from '@/lib/utils';

/**
 * Agent ledger.
 *
 * The one admin section that reads as a printed record rather than part of the
 * console: warm paper, brass accents, a serif title and a mono count of
 * enrolled agents. Scoped to .ledger-scope so nothing here bleeds into the
 * rest of the portal — and the scope's tokens flip with the shell's
 * dark/bright toggle like every other section.
 */

const AVATAR_COLORS = [
  'bg-ledger-gold',
  'bg-ledger-teal',
  'bg-ledger-brand',
  'bg-ledger-brand-deep',
  'bg-ledger-bad',
  'bg-ledger-good',
];

/** Readable temp password: no ambiguous characters for someone reading it aloud. */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export default function AgentsPage() {
  const { token, loadFromStorage } = useAuthStore();
  const [agents, setAgents] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showEnroll, setShowEnroll] = useState(false);

  // The agent whose password reset popover is open. The new password is shown
  // inside that popover — once, right where the click happened — because the
  // old flow put the notice at the top of the page, out of sight on a scrolled
  // ledger, and the browser `confirm()` popped up at the window centre.
  const [resetting, setResetting] = useState<{
    id: string;
    name: string;
    phase: 'confirm' | 'busy' | 'done' | 'error';
    password: string;
    error: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  /** Which accounts the ledger is showing. Filtered here, not on the server. */
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'DISABLED'>('ALL');

  /** The agent whose Disable is waiting on a second click, and the row mid-save. */
  const [confirmingOff, setConfirmingOff] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [statusError, setStatusError] = useState('');

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  useEffect(() => {
    if (!token) return;
    loadAgents();
  }, [token, search]);

  function openReset(agent: any) {
    const full = `${agent.firstName ?? ''} ${agent.lastName ?? ''}`.trim();
    setCopied(false);
    setResetting({ id: agent.id, name: full || 'this agent', phase: 'confirm', password: '', error: '' });
  }

  async function doReset() {
    if (!token || !resetting) return;
    // Only generated now, after the admin confirmed — so a row opened and left
    // alone does not burn a password that is then shown on a later reset.
    const password = generatePassword();
    setResetting((s) => s && ({ ...s, phase: 'busy' }));
    try {
      await admin.resetAgentPassword(token, resetting.id, password);
      setResetting((s) => s && ({ ...s, phase: 'done', password }));
    } catch (err: any) {
      setResetting((s) => s && ({ ...s, phase: 'error', error: err.message || 'Could not reset this password' }));
    }
  }

  async function loadAgents() {
    setLoading(true);
    try {
      const params: any = { limit: '50' };
      if (search) params.search = search;
      const res = await admin.listAgents(token!, params);
      setAgents(res.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  /**
   * Turn an agent's sign-in on or off.
   *
   * Sends the state it should end in rather than "flip it", so the button does
   * what its label says even if this list has gone stale. Disabling keeps
   * every call, score and note the agent has — it only stops them signing in.
   */
  async function setStatus(agent: any, next: boolean) {
    if (!token) return;
    setStatusBusy(agent.id);
    setStatusError('');
    try {
      await admin.toggleAgentStatus(token, agent.id, next);
      setConfirmingOff(null);
      await loadAgents();
    } catch (err: any) {
      setStatusError(err.message || 'Could not change that account.');
    } finally {
      setStatusBusy(null);
    }
  }

  const disabledCount = agents.filter((a) => !a.isActive).length;
  const activeCount = agents.length - disabledCount;
  const totalCalls = agents.reduce((sum, agent) => sum + (agent.agentProfile?.totalCalls || 0), 0);
  const scoredAgents = agents.filter((agent) => Number(agent.agentProfile?.averageScore) > 0);
  const averageScore = scoredAgents.length
    ? Math.round(
        scoredAgents.reduce((sum, agent) => sum + Number(agent.agentProfile?.averageScore || 0), 0) /
          scoredAgents.length,
      )
    : 0;

  const visible =
    statusFilter === 'ALL'
      ? agents
      : agents.filter((a) => (statusFilter === 'ACTIVE' ? a.isActive : !a.isActive));

  const hasFilters = statusFilter !== 'ALL' || !!search.trim();

  return (
    <div className="flex">
      <AdminSidebar />

      <main className="ledger-scope relative ml-64 min-h-screen flex-1 bg-ledger-bg px-6 py-7 text-ledger-ink antialiased lg:px-8">
        <div className="mx-auto w-full max-w-[1500px]">
          {/* Header */}
          <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-ledger-brand" />
                <span className="font-mono-ui text-[11px] font-bold uppercase tracking-[0.12em] text-ledger-faint">
                  People
                </span>
              </div>

              <h1 className="font-serif-ui text-[30px] font-semibold leading-tight tracking-[-0.02em] text-ledger-ink">
                Agent Management
              </h1>

              <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ledger-muted">
                Enroll agents, review activity, manage account access, and issue temporary passwords
                without leaving the roster.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowEnroll(true)}
              className="ledger-btn-primary inline-flex min-h-10 items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap transition"
            >
              <PlusGlyph className="h-4 w-4 stroke-current" />
              Enroll Agent
            </button>
          </header>

          {/* Summary */}
          {!loading && (
            <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <AgentMetric label="Loaded agents" value={agents.length} helper={search ? 'Matching search' : 'Current roster'} />
              <AgentMetric label="Active" value={activeCount} helper="Can sign in" />
              <AgentMetric label="Disabled" value={disabledCount} helper="Access revoked" />
              <AgentMetric
                label={scoredAgents.length ? 'Average score' : 'Total calls'}
                value={scoredAgents.length ? `${averageScore}%` : totalCalls}
                helper={scoredAgents.length ? `${scoredAgents.length} scored agent${scoredAgents.length === 1 ? '' : 's'}` : 'Across loaded agents'}
              />
            </section>
          )}

          {statusError && (
            <div
              role="alert"
              className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-ledger-bad/40 bg-ledger-bad-bg px-4 py-3.5"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ledger-bad/10 text-[12px] font-bold text-ledger-bad">
                  !
                </span>
                <p className="min-w-0 text-[13.5px] font-medium leading-relaxed text-ledger-bad">
                  {statusError}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStatusError('')}
                className="shrink-0 text-[12.5px] font-semibold text-ledger-bad"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Roster header + controls */}
          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ledger-ink">Agent roster</h2>
                <p className="mt-0.5 text-[12.5px] text-ledger-muted">
                  Search by name or email and filter accounts by sign-in status.
                </p>
              </div>

              <span className="font-mono-ui text-[11px] uppercase tracking-[0.08em] text-ledger-faint">
                {loading
                  ? 'Loading…'
                  : `${visible.length} ${statusFilter === 'ALL' ? 'shown' : statusFilter.toLowerCase()}`}
              </span>
            </div>

            <div className="ledger-panel mb-4 rounded-[18px] border p-3.5">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                <div className="relative min-w-0 flex-1 xl:max-w-[480px]">
                  <SearchGlyph className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 stroke-ledger-muted" />
                  <input
                    type="text"
                    className="ledger-input w-full rounded-xl border py-2.5 pl-10 pr-10 text-[13px] focus:outline-none focus:ring-2 focus:ring-ledger-brand/30"
                    placeholder="Search agents by name or email…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search agents"
                  />

                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      aria-label="Clear agent search"
                      className="absolute right-2.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-ledger-muted transition hover:bg-ledger-bg2 hover:text-ledger-ink"
                    >
                      <CloseGlyph className="h-3.5 w-3.5 stroke-current" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter agents by status">
                  {([
                    ['ALL', 'All', agents.length],
                    ['ACTIVE', 'Active', activeCount],
                    ['DISABLED', 'Disabled', disabledCount],
                  ] as const).map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={statusFilter === key}
                      onClick={() => {
                        setStatusFilter(key);
                        setConfirmingOff(null);
                      }}
                      className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[12.5px] font-semibold transition ${
                        statusFilter === key
                          ? 'border-ledger-brand bg-ledger-brand/[0.12] text-ledger-brand'
                          : 'ledger-action-btn text-ledger-muted hover:text-ledger-ink'
                      }`}
                    >
                      {label}
                      <span
                        className={`rounded-full px-1.5 py-0.5 font-mono-ui text-[9.5px] font-bold ${
                          statusFilter === key ? 'bg-ledger-brand/15 text-ledger-brand' : 'bg-ledger-bg2 text-ledger-muted'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  ))}
                </div>

                {hasFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setStatusFilter('ALL');
                      setConfirmingOff(null);
                    }}
                    className="rounded-xl px-3 py-2.5 text-[12.5px] font-semibold text-ledger-muted transition hover:bg-ledger-bg2 hover:text-ledger-brand"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>

            {/* Ledger */}
            <div className="ledger-panel overflow-hidden rounded-[20px] border">
              <div className="overflow-x-auto">
                <div className="ledger-grid grid min-w-[1040px] border-b border-ledger-line bg-ledger-brand/[0.06] px-5 py-3.5 lg:px-6">
                  <HeadCell>Agent</HeadCell>
                  <HeadCell>Email</HeadCell>
                  <HeadCell>Total calls</HeadCell>
                  <HeadCell>Avg score</HeadCell>
                  <HeadCell>Last login</HeadCell>
                  <HeadCell>Status</HeadCell>
                  <HeadCell className="text-right">Actions</HeadCell>
                </div>

                {visible.map((agent, i) => {
                  const full = `${agent.firstName ?? ''} ${agent.lastName ?? ''}`.trim();
                  const initials = `${agent.firstName?.[0] ?? ''}${agent.lastName?.[0] ?? ''}`.toUpperCase();
                  const score = Number(agent.agentProfile?.averageScore || 0);
                  const calls = agent.agentProfile?.totalCalls || 0;

                  return (
                    <div
                      key={agent.id}
                      className="ledger-row ledger-grid grid min-w-[1040px] items-center border-t border-ledger-line px-5 py-4 text-[13px] transition-colors first:border-t-0 lg:px-6"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl font-mono-ui text-[10.5px] font-bold text-white ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}
                        >
                          {initials || '·'}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-ledger-ink">{full || '·'}</span>
                          <span className="mt-0.5 block truncate font-mono-ui text-[9.5px] uppercase tracking-[0.05em] text-ledger-faint">
                            Agent
                          </span>
                        </span>
                      </div>

                      <span className="truncate pr-3 text-[12.5px] font-medium text-ledger-ink">{agent.email}</span>

                      <span className="num font-mono-ui text-[12.5px] font-semibold text-ledger-ink">{calls}</span>

                      {score > 0 ? (
                        <span className="inline-flex w-fit items-center gap-1.5 font-mono-ui text-[12.5px] font-semibold text-ledger-ink">
                          {score}%
                        </span>
                      ) : (
                        <span className="num font-mono-ui text-ledger-faint">—</span>
                      )}

                      <span className="text-[12px] text-ledger-muted">
                        {agent.lastLoginAt ? formatDate(agent.lastLoginAt) : 'Never'}
                      </span>

                      <AccountStatus active={agent.isActive} />

                      <div className="flex items-center justify-end gap-1.5">
                        <Link
                          href={`/agents/${agent.id}`}
                          title={`View ${full || 'agent'}`}
                          aria-label={`View ${full || 'agent'}`}
                          className="ledger-action-btn grid h-8 w-8 place-items-center rounded-lg border transition-colors"
                        >
                          <EyeGlyph className="h-[14px] w-[14px] stroke-current" />
                        </Link>

                        <ResetPasswordPopover
                          open={resetting?.id === agent.id}
                          name={resetting?.name ?? ''}
                          phase={resetting?.phase ?? 'confirm'}
                          password={resetting?.password ?? ''}
                          error={resetting?.error ?? ''}
                          copied={copied}
                          onClose={() => setResetting(null)}
                          onConfirm={doReset}
                          onCopy={() => {
                            if (!resetting?.password) return;
                            navigator.clipboard?.writeText(resetting.password);
                            setCopied(true);
                          }}
                        >
                          <button
                            type="button"
                            title="Reset password"
                            aria-label={`Reset password for ${full || 'agent'}`}
                            onClick={() => openReset(agent)}
                            className="ledger-action-btn grid h-8 w-8 place-items-center rounded-lg border transition-colors"
                          >
                            <KeyGlyph className="h-[14px] w-[14px] stroke-current" />
                          </button>
                        </ResetPasswordPopover>

                        {agent.isActive ? (
                          confirmingOff === agent.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={statusBusy === agent.id}
                                onClick={() => setStatus(agent, false)}
                                className="ledger-action-btn danger rounded-lg border px-2.5 py-1.5 text-[11.5px] font-bold whitespace-nowrap transition-colors disabled:opacity-50"
                              >
                                {statusBusy === agent.id ? 'Working…' : 'Confirm disable'}
                              </button>
                              <button
                                type="button"
                                disabled={statusBusy === agent.id}
                                onClick={() => setConfirmingOff(null)}
                                className="rounded-lg px-2 py-1.5 text-[11.5px] font-semibold text-ledger-muted transition hover:bg-ledger-bg2 hover:text-ledger-ink disabled:opacity-50"
                              >
                                Keep
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              title="Stop this agent signing in"
                              onClick={() => {
                                setConfirmingOff(agent.id);
                                setStatusError('');
                              }}
                              className="ledger-action-btn danger inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-bold whitespace-nowrap transition-colors"
                            >
                              <BanGlyph className="h-[12px] w-[12px] stroke-current" />
                              Disable
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            title="Let this agent sign in again"
                            disabled={statusBusy === agent.id}
                            onClick={() => setStatus(agent, true)}
                            className="ledger-action-btn inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-bold whitespace-nowrap transition-colors disabled:opacity-50"
                          >
                            {statusBusy === agent.id ? 'Working…' : 'Enable'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {loading && agents.length === 0 && <AgentSkeletonRows />}

                {visible.length === 0 && !loading && (
                  <div className="px-6 py-16 text-center">
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-ledger-line bg-ledger-bg2 text-ledger-brand">
                      <PeopleGlyph className="h-5 w-5 stroke-current" />
                    </div>

                    <h3 className="mt-4 text-[15px] font-bold text-ledger-ink">
                      {statusFilter === 'DISABLED' && agents.length > 0
                        ? 'No disabled agents'
                        : statusFilter === 'ACTIVE' && agents.length > 0
                          ? 'No active agents'
                          : search
                            ? 'No agents match that search'
                            : 'No agents enrolled yet'}
                    </h3>

                    <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-ledger-muted">
                      {hasFilters && agents.length > 0
                        ? 'Try changing the current search or status filter.'
                        : search
                          ? 'Try a different name or email.'
                          : 'Enroll your first agent to start building the training roster.'}
                    </p>

                    {hasFilters ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSearch('');
                          setStatusFilter('ALL');
                        }}
                        className="ledger-action-btn mt-5 rounded-xl border px-4 py-2.5 text-[13px] font-semibold"
                      >
                        Clear filters
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowEnroll(true)}
                        className="ledger-btn-primary mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold"
                      >
                        <PlusGlyph className="h-4 w-4 stroke-current" />
                        Enroll Agent
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ledger-line bg-ledger-panel px-4 py-3 text-[11.5px] leading-relaxed text-ledger-muted">
              <span>
                Password resets generate a new temporary password and invalidate the previous one immediately.
              </span>
              <span>
                Disabling an account blocks sign-in but keeps the agent&apos;s calls, scores, and history.
              </span>
            </div>
          </section>
        </div>
      </main>

      {showEnroll && token && (
        <EnrollAgentModal
          token={token}
          onClose={() => setShowEnroll(false)}
          onEnrolled={loadAgents}
        />
      )}
    </div>
  );
}


function AgentMetric({
  label,
  value,
  helper,
}: {
  label: string;
  value: React.ReactNode;
  helper: string;
}) {
  return (
    <div className="ledger-panel rounded-[16px] border px-4 py-3.5">
      <div className="text-[11.5px] font-semibold text-ledger-muted">{label}</div>
      <div className="mt-1 font-mono-ui text-[22px] font-extrabold tracking-[-0.03em] text-ledger-ink">{value}</div>
      <div className="mt-0.5 text-[10.5px] text-ledger-faint">{helper}</div>
    </div>
  );
}

function AccountStatus({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-ledger-good-bg px-2.5 py-1 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.06em] text-ledger-good">
      <span className="h-1.5 w-1.5 rounded-full bg-ledger-good" />
      Active
    </span>
  ) : (
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-ledger-bad-bg px-2.5 py-1 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.06em] text-ledger-bad">
      <span className="h-1.5 w-1.5 rounded-full bg-ledger-bad" />
      Disabled
    </span>
  );
}

function AgentSkeletonRows() {
  return (
    <div className="space-y-px bg-ledger-line/50">
      {[0, 1, 2, 3, 4].map((item) => (
        <div key={item} className="ledger-grid grid min-w-[1040px] items-center gap-5 bg-ledger-panel px-6 py-4">
          <div className="h-9 animate-pulse rounded-xl bg-ledger-bg2" />
          <div className="h-7 animate-pulse rounded-lg bg-ledger-bg2" />
          <div className="h-6 animate-pulse rounded-lg bg-ledger-bg2" />
          <div className="h-6 animate-pulse rounded-lg bg-ledger-bg2" />
          <div className="h-7 animate-pulse rounded-lg bg-ledger-bg2" />
          <div className="h-6 animate-pulse rounded-lg bg-ledger-bg2" />
          <div className="h-8 animate-pulse rounded-lg bg-ledger-bg2" />
        </div>
      ))}
    </div>
  );
}

function HeadCell({
  children,
  className = '',
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`font-mono-ui text-[10px] font-bold uppercase tracking-[0.08em] text-ledger-ink ${className}`}>
      {children}
    </span>
  );
}

/**
 * Reset-password popover, anchored to the row's key button.
 *
 * Replaces the browser `confirm()` — which opened at the window centre with the
 * page's origin in the title and gave no clue which row was about to change —
 * and the top-of-page notice strip, which is out of sight when the ledger is
 * scrolled and made it look like no password had been generated.
 *
 * The panel walks through the whole flow where the click happened: confirm,
 * then the generated password on a success screen with a copy button. The
 * password is shown only here, and the panel stays open until dismissed, so it
 * cannot be lost by scrolling.
 */
function ResetPasswordPopover({
  open,
  name,
  phase,
  password,
  error,
  copied,
  onClose,
  onConfirm,
  onCopy,
  children,
}: {
  open: boolean;
  name: string;
  phase: 'confirm' | 'busy' | 'done' | 'error';
  password: string;
  error: string;
  copied: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onCopy: () => void;
  children: React.ReactNode;
}) {
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  // The popover must inherit the ledger tokens (<--ledger-*> live on
  // .ledger-scope), so it is portaled into that scope element rather than
  // document.body where the variables would be undefined and every ledger
  // class — card fill, borders, brass button — would silently lose its style.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const scope = triggerRef.current?.closest('.ledger-scope') as HTMLElement | null;
    setHost(scope ?? document.body);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!open) {
      setPos(null);
      return;
    }

    // The overlay is anchored to the trigger button's bounds and rendered
    // through a portal with fixed positioning, outside the ledger's overflow
    // containers — an in-flow/absolute sibling inside the row would be
    // clipped and shift the grid, so opening and closing must move nothing.
    // When there is no room below the trigger, flip it above instead.
    const place = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const margin = 8;
      const fitsBelow = rect.bottom + margin + 300 <= window.innerHeight;
      setPos({
        top: fitsBelow ? rect.bottom + margin : undefined,
        bottom: fitsBelow ? undefined : window.innerHeight - rect.top + margin,
        right: Math.max(margin, window.innerWidth - rect.right),
      });
    };
    place();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current && triggerRef.current.contains(t)) return;
      if (menuRef.current && menuRef.current.contains(t)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, onClose]);

  const popover = (
    <div
      ref={menuRef}
      role="dialog"
      aria-label={`Reset password for ${name}`}
      style={{ top: pos?.top, bottom: pos?.bottom, right: pos?.right }}
      className="ledger-panel fixed z-[70] w-[300px] max-w-[calc(100vw-2rem)] rounded-xl border p-3.5 text-left shadow-[0_24px_50px_-24px_rgba(0,0,0,0.55)]"
    >
      {phase === 'confirm' && (
        <>
          <p className="text-[13px] font-bold text-ledger-ink">Reset password for {name}</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ledger-muted">
            Issue a new temporary password? Their current password stops working immediately.
          </p>
          <div className="mt-3.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              autoFocus
              className="rounded-lg border border-ledger-line bg-ledger-panel px-3 py-1.5 text-[12.5px] font-semibold text-ledger-muted transition hover:text-ledger-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-lg bg-ledger-brand px-3 py-1.5 text-[12.5px] font-bold text-white transition hover:brightness-110"
            >
              Issue new password
            </button>
          </div>
        </>
      )}

      {phase === 'busy' && (
        <p className="py-1 text-[13px] font-semibold text-ledger-ink">Resetting password…</p>
      )}

      {phase === 'done' && (
        <>
          <p className="text-[13px] font-bold text-ledger-ink">New temporary password for {name}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ledger-muted">
            Their old password no longer works. They&apos;ll be asked to set their own on first login.
          </p>
          <div className="mt-3 flex items-stretch gap-2">
            <div className="flex min-w-0 flex-1 items-center rounded-lg border border-ledger-line bg-ledger-bg2 px-3 py-2">
              <span className="num truncate font-mono-ui text-[13px] font-bold text-ledger-ink">{password}</span>
            </div>
            <button
              type="button"
              onClick={onCopy}
              className="shrink-0 rounded-lg border border-ledger-line bg-ledger-panel px-3 py-1.5 text-[12.5px] font-semibold text-ledger-muted transition hover:text-ledger-ink"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-2.5 rounded-lg border border-ledger-gold/40 bg-ledger-good-bg px-3 py-2 text-[11.5px] leading-relaxed text-ledger-ink">
            This password is shown only once — copy it before closing. You can issue a fresh one anytime from the
            same button.
          </p>
          <div className="mt-3.5 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-ledger-line bg-ledger-panel px-3 py-1.5 text-[12.5px] font-semibold text-ledger-muted transition hover:text-ledger-ink"
            >
              Done
            </button>
          </div>
        </>
      )}

      {phase === 'error' && (
        <>
          <p className="text-[13px] font-bold text-ledger-bad">Could not reset the password</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ledger-muted">{error}</p>
          <div className="mt-3.5 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-ledger-line bg-ledger-panel px-3 py-1.5 text-[12.5px] font-semibold text-ledger-muted transition hover:text-ledger-ink"
            >
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div ref={triggerRef} className="relative">
      {children}
      {open && pos && host && createPortal(popover, host)}
    </div>
  );
}

// ── glyphs ────────────────────────────────────────────────────
const S = { fill: 'none', strokeWidth: 1.9, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
const d = (path: string) => <path strokeLinecap="round" strokeLinejoin="round" d={path} />;

function SearchGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S} strokeWidth={2}>{d('M21 21l-4.3-4.3M11 18a7 7 0 100-14 7 7 0 000 14z')}</svg>;
}
function PlusGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S} strokeWidth={2.4}>{d('M12 5v14M5 12h14')}</svg>;
}
function EyeGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z')}</svg>;
}
function KeyGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3')}</svg>;
}
function BanGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M12 22a10 10 0 100-20 10 10 0 000 20zM4.9 4.9l14.2 14.2')}</svg>;
}

function CloseGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M6 18 18 6M6 6l12 12')}</svg>;
}

function PeopleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {d('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75')}
    </svg>
  );
}
