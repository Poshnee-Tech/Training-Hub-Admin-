'use client';

/**
 * Admin command center.
 *
 * FRONTEND ONLY — every call is one this page already made:
 *   GET /api/admin/dashboard              stats, team categories, agents, sessions
 *   GET /api/admin/calls/awaiting-verifier
 *   GET /api/admin/agents                 (see AGENT LINKING below)
 * No request or response shape is changed and no field is renamed.
 *
 * MOTION
 * Everything animated here degrades gracefully: Tailwind's keyframes are all
 * switched off by the global prefers-reduced-motion rules (elements snap to
 * their final state), the sparkline pins itself drawn via `.spark-path`, and
 * `useCountUp` jumps straight to the number when reduced motion is set.
 *
 * AGENT LINKING
 * `topAgents` / `bottomAgents` are AgentProfile rows: their `id` is the PROFILE
 * id, and the nested user carries only firstName/lastName/email — no user id.
 * `/agents/[id]` expects a USER id, so linking with `agent.id` would 404.
 * Rather than ask for a new field, the existing agents list is fetched and
 * joined on email in the browser. If an email has no match the row simply is
 * not a link, instead of being a link that goes nowhere.
 */

import { ComponentProps, useCallback, useEffect, useId, useState } from 'react';
import Link from 'next/link';
import AdminSidebar from '@/components/layout/AdminSidebar';
import RadialGauge, { toneForScore, type GaugeTone } from '@/components/admin/RadialGauge';
import { useAuthStore } from '@/store/auth.store';
import { admin } from '@/lib/api';
import { formatDate } from '@/lib/utils';

/** Staggered entrance helper — one shared rise keyframe, per-card delay. */
const riseDelay = (i: number, step = 70) => ({ animationDelay: `${Math.min(i * step, 620)}ms` });

/**
 * Pointer-tracked spotlight. The card records the cursor into --mx/--my; the
 * wash itself is painted by .spotlight-card::before in globals.css. One shared
 * prop spread keeps every card consistent.
 */
const spotProps = () => ({
  onMouseMove: (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  },
});

export default function AdminDashboard() {
  const { token, loadFromStorage } = useAuthStore();
  const [data, setData] = useState<any>(null);
  const [awaitingVerifier, setAwaitingVerifier] = useState<any[]>([]);
  const [agentIdByEmail, setAgentIdByEmail] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  const loadDashboard = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [dashRes, avRes, agentsRes] = await Promise.all([
        admin.dashboard(token),
        admin.awaitingVerifier(token).catch(() => ({ data: [] })),
      // Only used to resolve profile -> user id for the drill-down links.
      // The endpoint is paginated, so ask for a page big enough to cover the
      // roster — otherwise a top/bottom agent past the default page size would
      // silently fall back to a non-clickable row.
        admin.listAgents(token, { limit: 200 }).catch(() => ({ data: [] })),
      ]);
      setData(dashRes.data);
      setAwaitingVerifier(avRes.data || []);
      const list = Array.isArray(agentsRes.data) ? agentsRes.data : agentsRes.data?.agents ?? [];
      const map: Record<string, string> = {};
      list.forEach((u: any) => { if (u?.email && u?.id) map[u.email.toLowerCase()] = u.id; });
      setAgentIdByEmail(map);
    } catch (err: any) {
      setError(err.message || 'Could not load the dashboard.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const stats = data?.stats;
  const categories: any[] = data?.teamCategories ?? [];

  // Server already sorts weakest-first; read it rather than re-sorting, so the
  // callout and the ring row can never disagree about which area is weakest.
  const weakest = categories[0];

  const activeRatio = stats?.totalAgents ? (stats.activeAgents / stats.totalAgents) * 100 : 0;
  const maxCategoryScore = Math.max(...categories.map((c: any) => c.score || 0), 1);

  return (
    <div className="relative flex">
      {/* Ambient drift — two slow orbs behind everything, echoing the shell's
          static wash so this page feels alive without raising contrast.
          Written as literal brand hexes rather than tokens because a blurred
          orb needs a fixed colour, not one that shifts with a surface. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <span className="absolute -top-24 right-[6%] h-72 w-72 animate-air-orb rounded-full bg-[#2E1B33]/[0.13] blur-[110px]" />
        <span
          className="absolute -left-16 top-[38%] h-64 w-64 animate-air-orb rounded-full bg-[#DE8A24]/[0.10] blur-[100px]"
          style={{ animationDelay: '-4.5s' }}
        />
      </div>

      <AdminSidebar />

      <main className="ember-scope ml-64 min-w-0 flex-1 px-6 py-7 lg:px-8">
        <div className="mx-auto w-full max-w-[1500px]">
        {/* ── header ─────────────────────────────────────── */}
        <header className="mb-6 flex flex-wrap items-start justify-between gap-5 animate-air-rise">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-air-cyan shadow-[0_0_10px_rgb(var(--air-cyan))] animate-air-blink" />
              <span className="font-mono-ui text-[11px] font-bold uppercase tracking-[0.12em] text-air-faint">
                Operations
              </span>
            </div>

            <h1 className="font-display text-[28px] font-extrabold tracking-[-0.035em] text-air-text">
              Command Center
            </h1>

            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-air-muted">
              Monitor the training floor, surface coaching risks, review active workload,
              and jump directly into the agents or calls that need attention.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-air-cyan/30 bg-air-cyan/[0.07] px-2.5 py-1 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.1em] text-air-cyan">
                <span className="h-1.5 w-1.5 rounded-full bg-air-cyan animate-air-blink" />
                Board live
              </span>
              <LiveClock />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void loadDashboard()}
              disabled={loading}
              className="air-panel inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[12.5px] font-semibold text-air-muted transition hover:border-air-line/40 hover:text-air-text disabled:opacity-50"
            >
              <RefreshGlyph className={`h-4 w-4 stroke-current ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            {stats && (
              <div
                {...spotProps()}
                className="air-panel spotlight-card relative flex items-center gap-5 overflow-hidden rounded-[18px] border px-4 py-3 backdrop-blur-lg animate-air-rise"
                style={riseDelay(2)}
              >
                <div>
                  <FloorPulse className="h-8" />
                  <p className="mt-1 font-mono-ui text-[8.5px] font-bold uppercase tracking-[0.14em] text-air-faint">
                    Floor pulse
                  </p>
                </div>
                <span className="air-hairline h-11 w-px shrink-0 border-l" aria-hidden />
                <AnimatedGauge
                  value={Math.round(stats.averageScore || 0)}
                  tone={toneForScore(stats.averageScore || 0)}
                  size={54}
                  valueSuffix=""
                  label="Team average"
                  sublabel="scored calls"
                />
              </div>
            )}
          </div>
        </header>

        {loading ? (
          <DashboardSkeleton />
        ) : !data ? (
          <div className="air-panel rounded-[20px] border p-8 text-center">
            <h2 className="text-lg font-bold text-air-text">Could not load the dashboard</h2>
            <p className="mt-2 text-sm text-air-muted">{error || 'The dashboard returned no data.'}</p>
            <button type="button" onClick={loadDashboard} className="btn-primary mt-5">
              Try again
            </button>
          </div>
        ) : (
          <>
            {/* ── stat tiles ───────────────────────────────── */}
            <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <StatTile
                index={0}
                label="Agents on the board"
                value={stats.totalAgents}
                accent="signal"
                glyph={<UsersGlyph className="h-[18px] w-[18px] stroke-current" />}
                meter={activeRatio}
                footnote={`${stats.activeAgents} active · ${Math.max(0, stats.totalAgents - stats.activeAgents)} idle`}
              />
              <StatTile
                index={1}
                label="Active agents"
                value={stats.activeAgents}
                accent="mint"
                glyph={<PulseGlyph className="h-[18px] w-[18px] stroke-current" />}
                spark={[9, 14, 11, 18, 13, 20, 16]}
                meter={activeRatio}
                footnote="Currently enabled to take calls"
              />
              <StatTile
                index={2}
                label="Avg score"
                value={Math.round(stats.averageScore || 0)}
                suffix="%"
                accent={scoreAccent(stats.averageScore || 0)}
                glyph={<TargetGlyph className="h-[18px] w-[18px] stroke-current" />}
                gauge={{
                  value: stats.averageScore || 0,
                  tone: toneForScore(stats.averageScore || 0),
                  suffix: '',
                }}
                footnote={qualityCaption(stats.averageScore || 0)}
              />
              <StatTile
                index={3}
                label="Calls this week"
                value={stats.thisWeekSessions || 0}
                accent="cyan"
                glyph={<PhoneGlyph className="h-[18px] w-[18px] stroke-current" />}
                spark={[6, 10, 8, 14, 9, 16, 12]}
                footnote="Rolling seven days"
              />
              <StatTile
                index={4}
                label="Calls this month"
                value={stats.thisMonthSessions || 0}
                accent="signal"
                glyph={<CalendarGlyph className="h-[18px] w-[18px] stroke-current" />}
                spark={[8, 12, 16, 11, 18, 14, 20]}
                footnote="Month to date"
              />
              <StatTile
                index={5}
                label="Failed evaluations"
                value={stats.failedEvalJobs || 0}
                accent={stats.failedEvalJobs > 0 ? 'live' : 'mint'}
                glyph={<WarnGlyph className="h-[18px] w-[18px] stroke-current" />}
                gauge={{
                  value: stats.failedEvalJobs > 0 ? 100 : 0,
                  tone: stats.failedEvalJobs > 0 ? 'weak' : 'strong',
                  suffix: '',
                  showValue: false,
                }}
                footnote={
                  stats.failedEvalJobs > 0
                    ? 'Scoring jobs need a retry'
                    : 'Scoring queue is clean'
                }
              />
            </div>

            {/* ── team performance rings ───────────────────── */}
            {categories.length > 0 && (
              <section
                className="air-panel mb-6 rounded-[20px] border p-5 lg:p-6 backdrop-blur-lg animate-air-rise"
                style={riseDelay(3, 90)}
              >
                <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="flex items-center gap-2.5 font-display text-[20px] font-bold tracking-[-0.02em] text-air-text">
                    <span className="h-5 w-1 rounded-full bg-gradient-to-b from-air-signal to-air-amber" aria-hidden />
                    Team performance by category
                  </h2>
                  <span className="font-mono-ui text-[10px] uppercase tracking-[0.14em] text-air-faint">
                    Weakest first
                  </span>
                </div>

                <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
                  {categories.map((cat: any, i: number) => (
                    <CategoryRing
                      key={cat.label}
                      label={cat.label}
                      score={cat.score}
                      index={i}
                      maxScore={maxCategoryScore}
                    />
                  ))}
                </div>

                {weakest && weakest.score < 70 && (
                  /* Focus-area card — the score as a gauge, the category as a
                     serif headline, one pill CTA. Structured instead of a
                     sentence so the eye lands on label → number → action. */
                  <div
                    className="relative mt-7 overflow-hidden rounded-[22px] border border-air-amber/40 animate-air-rise"
                    style={riseDelay(5, 90)}
                  >
                    <div
                      className="pointer-events-none absolute inset-0 bg-gradient-to-r from-air-amber/[0.16] via-air-signal/[0.10] to-transparent"
                      aria-hidden
                    />
                    <div className="relative flex flex-wrap items-center gap-6 p-6">
                      <div className="shrink-0 rounded-full border border-air-line/20 bg-air-bg2/60 p-2">
                        <AnimatedGauge
                          value={weakest.score}
                          tone={toneForScore(weakest.score)}
                          size={88}
                          thickness={9}
                          valueSuffix="%"
                        />
                      </div>

                      <div className="min-w-[260px] flex-1">
                        <p className="inline-flex items-center gap-2 rounded-full border border-air-live/30 bg-air-live/[0.08] px-3 py-1 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.18em] text-air-live">
                          <WarnGlyph className="h-3 w-3 stroke-current animate-pulse" />
                          Focus area this week
                        </p>
                        <h3 className="mt-2.5 font-serif-ui text-[28px] font-semibold leading-tight tracking-[-0.01em] text-air-text">
                          {weakest.label}
                        </h3>
                        <p className="mt-1.5 max-w-[52ch] text-[14px] leading-relaxed text-air-muted">
                          Averaging <b className="font-bold tabular-nums text-air-text">{Math.round(weakest.score)}%</b>{' '}
                          across the team — the softest category on the board. A focused session here
                          keeps it from surfacing in live calls.
                        </p>
                      </div>

                      <Link
                        href="/analytics"
                        className="group/pill inline-flex shrink-0 items-center gap-2 rounded-full bg-gradient-to-r from-air-signal to-air-signal-bright px-6 py-3 text-[13.5px] font-bold text-white shadow-[0_12px_28px_-12px_rgb(var(--air-signal)/0.8)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_-12px_rgb(var(--air-signal)/0.9)]"
                      >
                        Train this area
                        <ArrowGlyph className="h-4 w-4 stroke-current transition-transform group-hover/pill:translate-x-1" />
                      </Link>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* ── awaiting verifier ────────────────────────── */}
            {awaitingVerifier.length > 0 && (
              <section
                className="air-panel mb-6 rounded-[20px] border border-air-amber/30 p-5 lg:p-6 backdrop-blur-lg animate-air-rise"
                style={riseDelay(4, 90)}
              >
                <h2 className="mb-4 flex items-center gap-2.5 font-display text-[18px] font-bold text-air-text">
                  <span className="h-[7px] w-[7px] rounded-full bg-air-amber shadow-[0_0_10px_rgb(var(--air-amber))] animate-air-blink" />
                  Calls awaiting a verifier
                  <span className="rounded-full border border-air-amber/35 bg-air-amber/12 px-2.5 py-0.5 font-mono-ui text-[10px] text-air-amber">
                    {awaitingVerifier.length}
                  </span>
                </h2>
                <div className="space-y-2.5">
                  {awaitingVerifier.map((call: any, i: number) => (
                    <div
                      key={call.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-air-line/15 bg-air-line/[0.05] px-4 py-3 transition-all duration-300 hover:-translate-y-px hover:border-air-amber/35 hover:bg-air-line/[0.09] animate-air-rise"
                      style={riseDelay(i, 80)}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold text-air-text">
                          {call.scenario?.name} · {call.scenario?.campaign?.replace('_', ' ')}
                        </p>
                        <p className="mt-0.5 font-mono-ui text-[10px] tracking-[0.04em] text-air-faint">
                          Fronter: {call.fronterSession?.user?.firstName}{' '}
                          {call.fronterSession?.user?.lastName}
                          {call.transferredAt &&
                            ` · transferred ${new Date(call.transferredAt).toLocaleString()}`}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-air-amber/35 bg-air-amber/12 px-3 py-1 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.12em] text-air-amber">
                        Needs verifier
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── agent leaderboards ───────────────────────── */}
            <div className="mb-6 grid gap-4 xl:grid-cols-2">
              <AgentBoard
                title="Top performing agents"
                subtitle="Ranked by average score"
                accent="mint"
                agents={data.topAgents}
                idByEmail={agentIdByEmail}
                emptyText="No agent data yet"
                delay={riseDelay(5, 90).animationDelay}
              />
              <AgentBoard
                title="Agents needing attention"
                subtitle="Coach these first"
                accent="live"
                agents={data.bottomAgents}
                idByEmail={agentIdByEmail}
                emptyText="Not enough data yet — needs 2+ calls per agent"
                delay={riseDelay(6, 90).animationDelay}
              />
            </div>

            {/* ── recent sessions ──────────────────────────── */}
            {/* Sits on the same grid track as every card above it: a plain
                block-level child of <main>, full width, carrying no horizontal
                margin, max-width or inset of its own. The page's px-8 gutter is
                the only thing between this panel and the sidebar on one side or
                the page edge on the other, so the two gaps are the same value
                by construction rather than by matching numbers here. */}
            <section
              className="air-panel w-full rounded-[20px] border p-5 lg:p-6 shadow-[var(--air-shadow)] backdrop-blur-lg animate-air-rise"
              style={{ animationDelay: '420ms' }}
            >
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="flex items-center gap-2.5 font-serif-ui text-[22px] font-semibold tracking-[-0.01em] text-air-text">
                  <span className="h-5 w-1 rounded-full bg-gradient-to-b from-air-signal to-air-amber" aria-hidden />
                  Recent sessions
                </h2>
                <Link
                  href="/calls"
                  className="group inline-flex items-center gap-1.5 font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.12em] text-air-signal-bright transition-colors hover:text-air-cyan"
                >
                  Call history
                  <ArrowGlyph className="h-3.5 w-3.5 stroke-current transition-transform group-hover:translate-x-1" />
                </Link>
              </div>

              {data.recentSessions?.length ? (
                <ul>
                  {data.recentSessions.map((session: any, i: number) => (
                    <SessionRow key={session.id} session={session} index={i} />
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-sm text-air-muted">No sessions yet</p>
              )}
            </section>
          </>
        )}
        </div>
      </main>
    </div>
  );
}

// ── motion primitives ─────────────────────────────────────────

/**
 * Counts a number up from zero with an ease-out curve. Skips the theatre and
 * returns the target immediately when the visitor prefers reduced motion.
 */
function useCountUp(target: number, duration = 900): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setV(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
}

/**
 * Holds a value at zero for `delay` ms, then releases it — used to trigger
 * CSS width/dash transitions on mount (meters, rings, leaderboard bars).
 */
function useReveal(target: number, delay = 250): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setV(target), delay);
    return () => clearTimeout(t);
  }, [target, delay]);
  return v;
}

/** Gauge that sweeps its arc in after mount instead of painting full. */
function AnimatedGauge(props: ComponentProps<typeof RadialGauge>) {
  const v = useReveal(typeof props.value === 'number' ? props.value : 0, 350);
  return <RadialGauge {...props} value={v} />;
}

/** Live clock pill — mounts empty so SSR and first client render agree. */
function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const day = now?.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const time = now?.toLocaleTimeString([], { hour12: false });

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-air-line/25 bg-air-line/[0.06] px-3.5 py-[7px] font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.14em] tabular-nums text-air-muted">
      <ClockGlyph className="h-3 w-3 stroke-air-faint" />
      {now ? `${day} · ${time}` : 'Syncing board time'}
    </span>
  );
}

/**
 * Equalizer bars driven by active-call energy — decorative, so the bar
 * heights come from a fixed pattern rather than live data (no layout shift,
 * no hydration drift); the staggered delays make it read as one waveform.
 */
const EQ_HEIGHTS = [38, 62, 45, 80, 55, 92, 48, 70, 40, 85, 58, 74, 44, 66, 36, 78];

function FloorPulse({ className = '' }: { className?: string }) {
  return (
    <div className={`flex h-11 items-end gap-[3px] ${className}`} aria-hidden>
      {EQ_HEIGHTS.map((h, i) => (
        <span
          key={i}
          className="w-[3px] origin-bottom animate-air-eq rounded-full bg-gradient-to-t from-air-signal/30 via-air-signal-bright/70 to-air-amber"
          style={{
            height: `${h}%`,
            animationDelay: `${(i % 7) * 110}ms`,
            animationDuration: `${950 + (i % 5) * 140}ms`,
          }}
        />
      ))}
    </div>
  );
}

// ── pieces ────────────────────────────────────────────────────

/* ── recent sessions ledger ───────────────────────────────────
   The panel reads as a printed log: one line per session, hairline rules
   between them, and a fixed set of columns so the eye can run straight down
   the score and status edges. Everything below is scoped to that panel — no
   other section on this page uses it. */

/**
 * Score bands are the ones this page already applies elsewhere: `scoreAccent`
 * treats sub-60 as the failing band, and `qualityCaption` calls that same
 * range "Below target". Reused rather than given a second threshold here, so
 * the ledger and the Avg score tile above it can never disagree about which
 * calls failed.
 */
const PASSING_SCORE = 60;

/**
 * Category indicator. Mapped onto the console palette instead of
 * `getCampaignColor`, whose blue/purple/orange come from the legacy light
 * theme and were the only off-palette colours the old panel carried.
 */
const CAMPAIGN_DOT: Record<string, string> = {
  ACA: 'bg-air-signal',
  MEDICARE: 'bg-[#8F5410]',
  MED_ALERT: 'bg-air-amber',
};

const CAMPAIGN_PILL: Record<string, string> = {
  ACA: 'border-air-signal/35 bg-air-signal/[0.08] text-air-signal-bright',
  MEDICARE: 'admin-pill-campaign-medicare',
  MED_ALERT: 'border-air-amber/35 bg-air-amber/[0.08] text-air-amber',
};

const DIFFICULTY_PILL: Record<string, string> = {
  EASY: 'admin-pill-difficulty-easy',
};

/**
 * Only ACTIVE gets a colour — a live call is the one row worth pulling the eye.
 * Every other status (COMPLETED, and WAITING / FAILED / CANCELLED, which the
 * dashboard query does not filter out) stays neutral so the column reads as a
 * log rather than a traffic light.
 */
const STATUS_PILL: Record<string, string> = {
  ACTIVE: 'admin-pill-status-active',
  COMPLETED: 'admin-pill-status-completed',
};
const STATUS_PILL_NEUTRAL = 'border-air-line/25 bg-air-line/[0.07] text-air-muted';

function SessionRow({ session, index }: { session: any; index: number }) {
  const score = session.evaluation?.overallScore;
  const scored = typeof score === 'number';
  const status: string = session.status ?? '';

  return (
    <li
      className="air-hairline group flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border-t py-3.5 transition-colors first:border-t-0 hover:bg-air-line/[0.04] animate-air-rise"
      style={riseDelay(index, 60)}
    >
      {/* Fixed-width name column. Agent names vary in length, so letting the
          pills sit directly after the name put them at a different x on every
          row; pinning the column means the tag block starts at one place down
          the whole ledger. Below `sm` the width is released so a narrow
          viewport is not forced to reserve 210px for a short name — the dot
          and the name stay on one line either way, since they are one item. */}
      <span className="flex min-w-0 shrink-0 items-center gap-2.5 sm:w-[210px]">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            CAMPAIGN_DOT[session.scenario?.campaign] ?? 'bg-air-faint'
          }`}
          aria-hidden
        />
        <span className="truncate text-[15px] font-semibold text-air-text">
          {session.user.firstName} {session.user.lastName}
        </span>
      </span>

      {/* Each pill gets its own fixed slot, so MEDICARE/ACA/MED ALERT and
          EASY/MEDIUM/HARD line up on both edges instead of shifting with the
          length of the word inside them. */}
      <span className="flex shrink-0 items-center gap-2">
        <TagPill className={`w-[100px] ${CAMPAIGN_PILL[session.scenario?.campaign] ?? ''}`}>
          {session.scenario?.campaign?.replace('_', ' ')}
        </TagPill>
        <TagPill className={`w-[82px] ${DIFFICULTY_PILL[session.scenario?.difficulty] ?? ''}`}>
          {session.scenario?.difficulty}
        </TagPill>
      </span>

      {/* Unscored rows are left blank rather than dashed — an empty cell reads
          as "nothing here yet" without adding a mark to scan past. */}
      <span
        className={`ml-auto w-[58px] shrink-0 text-right font-mono-ui text-[15px] font-bold tabular-nums ${
          scored && score < PASSING_SCORE ? 'text-air-live' : 'text-air-text'
        }`}
      >
        {scored ? `${score}%` : ''}
      </span>

      <span className="w-[164px] shrink-0 text-right">
        <span
          className={`admin-pill w-[108px] ${
            STATUS_PILL[status] ?? STATUS_PILL_NEUTRAL
          }`}
        >
          {status}
        </span>
        <span className="mt-1 block whitespace-nowrap font-mono-ui text-[10.5px] tracking-[0.03em] text-air-faint">
          {formatDate(session.createdAt)}
        </span>
      </span>
    </li>
  );
}

/**
 * Outlined, not filled — the pills label the row without competing with it.
 * `className` carries the caller's fixed column width; the label is centred in
 * it so both pill edges stay on a common vertical.
 */
function TagPill({ className = '', children }: { className?: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <span
      className={`admin-pill ${className || 'air-hairline text-air-muted'}`}
    >
      {children}
    </span>
  );
}

/**
 * Per-accent classes. Tailwind only sees literal class names, so every field
 * is written out in full — nothing here may be composed from the accent key.
 * These read the shared brand tokens: signal is plum, amber is the accent,
 * mint is the moss green used for a pass, live is the error red.
 */
const ACCENT: Record<string, { text: string; ring: string; glow: string; hair: string; bar: string; badge: string }> = {
  signal: {
    text: 'text-air-signal-bright',
    ring: 'border-air-signal/25',
    glow: 'rgb(var(--air-signal) / .16)',
    hair: 'via-air-signal-bright/70',
    bar: 'from-air-signal to-air-cyan',
    badge: 'from-air-signal to-air-signal-bright',
  },
  cyan: {
    text: 'text-air-cyan',
    ring: 'border-air-cyan/25',
    glow: 'rgb(var(--air-cyan) / .14)',
    hair: 'via-air-cyan/70',
    bar: 'from-air-cyan to-air-signal-bright',
    badge: 'from-air-cyan to-air-signal-bright',
  },
  mint: {
    text: 'text-air-mint',
    ring: 'border-air-mint/25',
    glow: 'rgb(var(--air-mint) / .14)',
    hair: 'via-air-mint/70',
    bar: 'from-air-mint to-air-cyan',
    badge: 'from-air-mint to-air-cyan',
  },
  amber: {
    text: 'text-air-amber',
    ring: 'border-air-amber/25',
    glow: 'rgb(var(--air-amber) / .14)',
    hair: 'via-air-amber/70',
    bar: 'from-air-amber to-air-signal-bright',
    badge: 'from-air-amber to-air-signal-bright',
  },
  live: {
    text: 'text-air-live',
    ring: 'border-air-live/30',
    glow: 'rgb(var(--air-live) / .16)',
    hair: 'via-air-live/70',
    bar: 'from-air-live to-air-amber',
    badge: 'from-air-live to-air-amber',
  },
};

/** Raw rgb() strings for SVG strokes — Tailwind classes don't apply there. */
const STROKE: Record<string, string> = {
  signal: 'rgb(var(--air-signal-bright))',
  cyan: 'rgb(var(--air-cyan))',
  mint: 'rgb(var(--air-mint))',
  amber: 'rgb(var(--air-amber))',
  live: 'rgb(var(--air-live))',
};

function scoreAccent(score: number): string {
  if (score >= 80) return 'mint';
  if (score >= 60) return 'amber';
  return 'live';
}
function scoreText(score: number): string {
  return ACCENT[scoreAccent(score)].text;
}
function qualityCaption(score: number): string {
  if (score >= 80) return 'Floor is performing well';
  if (score >= 60) return 'Room to tighten up';
  return 'Below target — needs coaching';
}

/**
 * Stat tile — reshaped: label top-left, a filled gradient squircle badge
 * top-right (it tilts as the card lifts), a 40px number, and the visual
 * (gauge / sparkline / meter) anchored bottom-right. The value counts up,
 * meters sweep their fill, sparklines ink themselves in.
 */
function StatTile({
  index, label, value, suffix = '', accent, glyph, gauge, spark, meter, footnote,
}: {
  index: number;
  label: string;
  value: number;
  suffix?: string;
  accent: string;
  glyph: React.ReactNode;
  gauge?: { value: number; tone: GaugeTone; suffix?: string; showValue?: boolean };
  spark?: number[];
  meter?: number;
  footnote?: string;
}) {
  const a = ACCENT[accent] ?? ACCENT.signal;
  const shown = useCountUp(value);
  const revealedMeter = useReveal(Math.max(0, Math.min(100, meter ?? 0)), 350 + index * 80);

  return (
    <div
      {...spotProps()}
      className={`air-panel spotlight-card group relative overflow-hidden rounded-[20px] border ${a.ring} p-5 backdrop-blur-lg transition-all duration-300 hover:-translate-y-1.5 hover:border-air-line/40 hover:shadow-[var(--air-shadow-lg)] animate-air-rise`}
      style={riseDelay(index)}
    >
      {/* Accent hairline along the top edge — brightens as the card lifts. */}
      <span
        className={`pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent ${a.hair} to-transparent opacity-60 transition-opacity duration-300 group-hover:opacity-100`}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full opacity-60 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `radial-gradient(circle, ${a.glow}, transparent 70%)` }}
        aria-hidden
      />

      <div className="relative flex items-start justify-between gap-4">
        <span className="pt-1 font-mono-ui text-[10px] font-bold uppercase tracking-[0.16em] text-air-muted">
          {label}
        </span>
        <span
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${a.badge} text-white shadow-[0_10px_22px_-10px_rgb(var(--air-signal)/0.7)] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105`}
        >
          {glyph}
        </span>
      </div>

      <div className="relative mt-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="font-display text-[34px] font-extrabold leading-none tracking-[-0.02em] tabular-nums text-air-text">
            {shown}
            {suffix}
          </div>
          {footnote && (
            <p className="mt-2.5 max-w-[24ch] font-mono-ui text-[9.5px] leading-relaxed tracking-[0.04em] text-air-faint">
              {footnote}
            </p>
          )}
        </div>

        {gauge && (
          <AnimatedGauge
            value={gauge.value}
            tone={gauge.tone}
            size={62}
            thickness={6}
            valueSuffix={gauge.suffix ?? ''}
            showValue={gauge.showValue ?? true}
          />
        )}

        {spark && <Sparkline points={spark} color={STROKE[accent] ?? STROKE.signal} delay={index * 90} />}
      </div>

      {typeof meter === 'number' && (
        <div className="relative mt-4 h-1.5 w-full overflow-hidden rounded-full bg-air-line/15" aria-hidden>
          <div
            className={`h-full rounded-full bg-gradient-to-r ${a.bar}`}
            style={{
              width: `${revealedMeter}%`,
              transition: 'width .9s cubic-bezier(.22,.68,.32,1)',
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Area sparkline that draws itself: pathLength is normalised to 1 so one
 * dashoffset animation works for any point count. The area fill and the end
 * dot fade in just after the line lands.
 */
function Sparkline({ points, color, delay = 0 }: { points: number[]; color: string; delay?: number }) {
  const uid = useId().replace(/:/g, '');
  const w = 128, h = 46, pad = 5;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => [
    pad + i * step,
    pad + (1 - (p - min) / span) * (h - pad * 2),
  ] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w - pad} ${h} L${pad} ${h} Z`;
  const [lastX, lastY] = coords[coords.length - 1];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[54px] w-[128px] shrink-0 overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={`spark-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={area}
        fill={`url(#spark-fill-${uid})`}
        className="animate-air-fade-in"
        style={{ animationDelay: `${delay + 900}ms` }}
      />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray="1"
        strokeDashoffset={1}
        className="spark-path animate-air-draw"
        style={{ animationDelay: `${delay}ms` }}
      />
      <circle
        cx={lastX}
        cy={lastY}
        r="2.8"
        fill={color}
        className="animate-air-fade-in"
        style={{ animationDelay: `${delay + 1050}ms` }}
      />
    </svg>
  );
}

/**
 * Category ring. The arc and its relative-strength bar both reveal after
 * mount (staggered by index), so the row reads left-to-right like the data:
 * weakest category first, strongest last.
 */
const TONE_BAR: Record<GaugeTone, string> = {
  strong: 'from-air-mint to-air-cyan',
  mid: 'from-air-amber to-air-amber',
  weak: 'from-air-live to-air-amber',
  neutral: 'from-air-faint to-air-muted',
  signal: 'from-air-signal to-air-cyan',
};

function CategoryRing({ label, score, index, maxScore }: { label: string; score: number; index: number; maxScore: number }) {
  const v = useReveal(score, 380 + index * 110);
  const tone = toneForScore(score);
  const text =
    tone === 'strong' ? 'text-air-mint' : tone === 'mid' ? 'text-air-amber' : 'text-air-live';
  const barW = maxScore > 0 ? Math.max(6, (score / maxScore) * 100) : 0;

  return (
    <div className="group flex flex-col items-center gap-3 rounded-[16px] border border-air-line/12 bg-air-line/[0.04] px-3 py-5 text-center transition-all duration-300 hover:-translate-y-1 hover:border-air-line/30 hover:bg-air-line/[0.08]">
      <div className="transition-transform duration-300 group-hover:scale-[1.06]">
        <RadialGauge value={v} tone={tone} size={86} thickness={8} valueSuffix="%" />
      </div>
      <div className="w-full">
        <div className="text-[13px] font-semibold text-air-text">{label}</div>
        <div className={`mt-0.5 font-mono-ui text-[9px] font-bold uppercase tracking-[0.14em] ${text}`}>
          {tone === 'strong' ? 'Strong' : tone === 'mid' ? 'Developing' : 'Needs work'}
        </div>
        {/* Relative strength against the best category on the board. */}
        <div className="mx-auto mt-2.5 h-1 w-4/5 overflow-hidden rounded-full bg-air-line/15" aria-hidden>
          <div
            className={`h-full rounded-full bg-gradient-to-r ${TONE_BAR[tone]}`}
            style={{ width: v > 0 ? `${barW}%` : '0%', transition: 'width .7s cubic-bezier(.22,.68,.32,1)' }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Agent leaderboard. Rows link to the agent's full board when the email could
 * be resolved to a user id; otherwise they render as a plain row rather than a
 * link that goes nowhere. Each row carries a score-proportional backdrop bar
 * that sweeps in on mount, and the podium (top three) gets medal colouring.
 */
/**
 * Podium tones — literal warm metals (gold / bronze / copper) that read on
 * both the cream and espresso surfaces; decorative, so they don't need to be
 * theme-tokenised.
 */
const MEDAL_TEXT = ['text-[#DE8A24]', 'text-[#8F5410]', 'text-[#5A3A66]'];
const MEDAL_RING = ['border-[#DE8A24]/50', 'border-[#8F5410]/50', 'border-[#5A3A66]/50'];

function AgentBoard({
  title, subtitle, accent, agents, idByEmail, emptyText, delay = '0ms',
}: {
  title: string;
  subtitle: string;
  accent: string;
  agents: any[] | undefined;
  idByEmail: Record<string, string>;
  emptyText: string;
  delay?: string;
}) {
  const risk = accent === 'live';

  return (
    <section
      className="air-panel rounded-[20px] border p-5 lg:p-6 backdrop-blur-lg animate-air-rise"
      style={{ animationDelay: delay }}
    >
      {/* A tinted glyph badge carries the board's identity, so the title needs
          no decorative rule in front of it. Accent classes are written out in
          full rather than composed from `accent`, since Tailwind only sees
          literal class names. */}
      <header className="mb-5 flex items-center gap-3">
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border ${
            risk
              ? 'border-air-live/30 bg-air-live/12 shadow-[0_0_18px_-6px_rgb(var(--air-live)/0.6)]'
              : 'border-air-mint/30 bg-air-mint/12 shadow-[0_0_18px_-6px_rgb(var(--air-mint)/0.6)]'
          }`}
        >
          {risk ? (
            <WarnGlyph className="h-[18px] w-[18px] stroke-air-live" />
          ) : (
            <TrophyGlyph className="h-[18px] w-[18px] stroke-air-mint" />
          )}
        </span>

        <div className="min-w-0">
          <h2 className="font-display text-[21px] font-extrabold leading-tight tracking-[-0.025em] text-air-text">
            {title}
          </h2>
          <p className="mt-1 font-mono-ui text-[9.5px] uppercase tracking-[0.14em] text-air-faint">
            {subtitle}
          </p>
        </div>

        {!!agents?.length && (
          <span
            className={`ml-auto shrink-0 rounded-full border px-2.5 py-1 font-mono-ui text-[10px] font-bold tracking-[0.1em] ${
              risk
                ? 'border-air-live/30 bg-air-live/10 text-air-live'
                : 'border-air-mint/30 bg-air-mint/10 text-air-mint'
            }`}
          >
            {agents.length}
          </span>
        )}
      </header>

      <div className="space-y-2.5">
        {agents?.map((agent: any, i: number) => (
          <AgentRow key={agent.id} agent={agent} rank={i} risk={risk} idByEmail={idByEmail} />
        ))}

        {!agents?.length && <p className="py-6 text-center text-sm text-air-muted">{emptyText}</p>}
      </div>
    </section>
  );
}

function AgentRow({
  agent, rank, risk, idByEmail,
}: {
  agent: any;
  rank: number;
  risk: boolean;
  idByEmail: Record<string, string>;
}) {
  // Score-proportional backdrop, swept in after mount. Hooks must live in the
  // row component (not the .map callback above) to keep React happy.
  const barW = useReveal(Math.max(0, Math.min(100, agent.averageScore || 0)), 260 + rank * 80);

  const userId = agent.user?.email ? idByEmail[agent.user.email.toLowerCase()] : undefined;
  const medal = !risk && rank < 3;

  const body = (
    <>
      {/* Backdrop bar sits under the content; the content wrapper below stays
          position-relative so it always paints on top of it. */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 bg-gradient-to-r to-transparent ${
          risk ? 'from-air-live/[0.12]' : 'from-air-mint/[0.13]'
        }`}
        style={{ width: `${barW}%`, transition: 'width .8s cubic-bezier(.22,.68,.32,1)' }}
      />

      <div className="relative z-[1] flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`font-display text-[17px] font-extrabold ${
              medal ? MEDAL_TEXT[rank] : `${risk ? 'text-air-live' : 'text-air-mint'} opacity-60`
            }`}
          >
            #{rank + 1}
          </span>
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border bg-air-line/10 font-display text-[12px] font-bold text-air-text ${
              medal ? MEDAL_RING[rank] : 'border-air-line/20'
            }`}
          >
            {agent.user?.firstName?.[0]}
            {agent.user?.lastName?.[0]}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-semibold text-air-text">
              {agent.user?.firstName} {agent.user?.lastName}
            </p>
            <p className="font-mono-ui text-[9.5px] uppercase tracking-[0.1em] text-air-faint">
              {agent.totalCalls} calls
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className={`font-display text-[20px] font-extrabold tabular-nums ${scoreText(agent.averageScore)}`}>
            {agent.averageScore}%
          </span>
          {userId && (
            <ArrowGlyph className="h-4 w-4 stroke-air-faint transition-transform group-hover:translate-x-1" />
          )}
        </div>
      </div>
    </>
  );

  const cls =
    'group relative flex items-center overflow-hidden rounded-[14px] border border-air-line/12 bg-air-line/[0.04] px-4 py-3 transition-all duration-300 animate-air-rise hover:border-air-line/25 hover:bg-air-line/[0.09]';

  return userId ? (
    <Link
      href={`/agents/${userId}`}
      className={`${cls} cursor-pointer hover:-translate-y-px`}
      style={riseDelay(rank, 80)}
    >
      {body}
    </Link>
  ) : (
    <div className={cls} style={riseDelay(rank, 80)} title="Open this agent from the Agents page">
      {body}
    </div>
  );
}

/**
 * Loading state shaped like the real page — skeleton tiles shimmer with the
 * existing air-sweep so the swap from skeleton to data reads as one motion.
 */
function DashboardSkeleton() {
  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="air-panel relative h-[136px] overflow-hidden rounded-[20px] border border-air-line/15 p-5">
            <Shimmer />
            <div className="h-4 w-24 rounded bg-air-line/15" />
            <div className="mt-4 h-8 w-20 rounded bg-air-line/20" />
            <div className="mt-3 h-2 w-28 rounded bg-air-line/10" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="air-panel relative h-64 overflow-hidden rounded-[20px] border border-air-line/15 p-6">
            <Shimmer />
            <div className="h-5 w-44 rounded bg-air-line/15" />
            <div className="mt-5 space-y-3">
              {[0, 1, 2].map((j) => (
                <div key={j} className="h-11 rounded-xl bg-air-line/[0.08]" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Shimmer() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 animate-air-sweep bg-gradient-to-r from-transparent via-air-line/[0.08] to-transparent"
    />
  );
}

// ── glyphs ────────────────────────────────────────────────────
const S = { fill: 'none', strokeWidth: 1.8, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
const d = (path: string) => <path strokeLinecap="round" strokeLinejoin="round" d={path} />;

function UsersGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z')}</svg>;
}
function PulseGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M3 12h3.75l2.25-7.5 4.5 15 2.25-7.5H21')}</svg>;
}
function TargetGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M12 21a9 9 0 100-18 9 9 0 000 18zm0-4.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zm0-3a1.5 1.5 0 100-3 1.5 1.5 0 000 3z')}</svg>;
}
function PhoneGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z')}</svg>;
}
function CalendarGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5')}</svg>;
}
function WarnGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z')}</svg>;
}
function TrophyGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M8.25 4.5h7.5v4.125a3.75 3.75 0 01-7.5 0V4.5zM8.25 6.75H6.375a1.875 1.875 0 000 3.75H7.5M15.75 6.75h1.875a1.875 1.875 0 010 3.75H16.5M12 12.75v3.75M8.625 19.5h6.75l-.75-3h-5.25l-.75 3z')}</svg>;
}
function ArrowGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S} strokeWidth={2.4}>{d('M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3')}</svg>;
}
function ClockGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z')}</svg>;
}

function RefreshGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M20 6v5h-5M4 18v-5h5M18.4 9A7 7 0 0 0 6.2 6.2L4 8M5.6 15A7 7 0 0 0 17.8 17.8L20 16')}</svg>;
}
