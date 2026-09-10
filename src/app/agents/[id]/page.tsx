'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import AdminSidebar from '@/components/layout/AdminSidebar';
import { useAuthStore } from '@/store/auth.store';
import { admin, assignmentsExtra } from '@/lib/api';
import { formatDate } from '@/lib/utils';

/**
 * Agent profile — one agent's ledger page.
 *
 * Same voice as the agent ledger list: warm paper cards, brass accents, a
 * Fraunces serif title and IBM Plex Mono labels. The header stats count up on
 * load, the score ring draws itself, and each card / row staggers in — except
 * under prefers-reduced-motion, where .ledger-scope's global rule collapses
 * every animation and the place() below renders final values immediately.
 */

const RING_C = 251.2;

const DIFF_PILL: Record<string, string> = {
  EASY: 'admin-pill-difficulty-easy',
  MEDIUM: 'bg-ledger-gold/15 text-ledger-gold',
  HARD: 'bg-ledger-bad-bg text-ledger-bad',
};

const STAGE_PILL: Record<string, string> = {
  PASSED: 'admin-pill-status-completed',
  FAILED: 'bg-ledger-bad-bg text-ledger-bad',
  IN_PROGRESS: 'admin-pill-status-active',
  AVAILABLE: 'bg-ledger-bg border border-ledger-line text-ledger-muted',
  LOCKED: 'bg-ledger-faint/10 text-ledger-faint',
};

const STAGE_LABEL: Record<string, string> = {
  PASSED: 'Completed',
  FAILED: 'Did not pass',
  IN_PROGRESS: 'In progress',
  AVAILABLE: 'Ready',
  LOCKED: 'Locked',
};

function scoreColor(s: number) {
  return s >= 80 ? 'text-ledger-good' : s >= 60 ? 'text-ledger-gold' : 'text-ledger-bad';
}
function scoreStroke(s: number) {
  return s >= 80 ? 'stroke-ledger-good' : s >= 60 ? 'stroke-ledger-gold' : 'stroke-ledger-bad';
}

/** Eased count-up from 0 to target; renders final value immediately under reduced motion. */
function useCountUp(target: number, delay = 0, duration = 700) {
  const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [value, setValue] = useState(reduce ? target : 0);

  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    let start: number | null = null;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(eased * target));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    const t = window.setTimeout(() => { raf = requestAnimationFrame(step); }, delay);
    return () => { window.clearTimeout(t); cancelAnimationFrame(raf); };
  }, [target, delay, duration, reduce]);

  return value;
}

/** IntersectionObserver reveal — cards and rows fade up, staggered. */
function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShow(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`${className} transition-all duration-500 ease-out ${show ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'}`}
      style={{ transitionDelay: show ? `${delay}ms` : '0ms' }}
    >
      {children}
    </div>
  );
}

function Pill({ children, className = '', dot }: { children: React.ReactNode; className?: string; dot?: string }) {
  return (
    <span className={`admin-pill ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      {children}
    </span>
  );
}

function trainingDestination(categoryId: string): string {
  if (categoryId === 'product_knowledge') return '/content/knowledge';
  if (categoryId === 'objection_handling' || categoryId === 'communication') return '/content/clips';
  return '/scenarios';
}

function ScoreRing({ score, size = 'card' }: { score: number; size?: 'card' | 'small' }) {
  const safeScore = Math.max(0, Math.min(100, score));
  const offset = RING_C * (1 - safeScore / 100);
  const dimension = size === 'small' ? 'h-16 w-16' : 'h-[84px] w-[84px]';
  const labelSize = size === 'small' ? 'text-[11px]' : 'text-[13px]';

  return (
    <div className={`relative shrink-0 ${dimension}`}>
      <svg viewBox="0 0 90 90" className="h-full w-full -rotate-90" aria-hidden>
        <circle className="stroke-ledger-bg" cx="45" cy="45" r="40" fill="none" strokeWidth="8" />
        <circle
          className={scoreStroke(safeScore)}
          cx="45" cy="45" r="40" fill="none" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={offset}
        />
      </svg>
      <span className={`num absolute inset-0 grid place-items-center font-mono-ui font-bold ${labelSize} ${scoreColor(safeScore)}`}>
        {Math.round(safeScore)}%
      </span>
    </div>
  );
}

function CategoryScoreCard({ label, score }: { label: string; score: number }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-ledger-line bg-ledger-bg px-3.5 py-3.5 xl:flex-col xl:text-center">
      <ScoreRing score={score} />
      <div className="min-w-0">
        <p className="truncate text-[12.5px] font-semibold text-ledger-ink">{label}</p>
        <p className={`mt-0.5 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.1em] ${scoreColor(score)}`}>
          {score >= 80 ? 'Strong' : score >= 60 ? 'Developing' : 'Needs work'}
        </p>
      </div>
    </div>
  );
}

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { token, loadFromStorage } = useAuthStore();
  const [agent, setAgent] = useState<any>(null);
  const [performance, setPerformance] = useState<any>(null);
  const [journey, setJourney] = useState<any>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  const loadJourney = useCallback(async () => {
    if (!token || !params.id) return;
    try {
      const res = await admin.getAgentJourney(token, params.id as string);
      setJourney(res.data.journey);
    } catch (err: any) {
      setNotice(err.message);
    }
  }, [token, params.id]);

  useEffect(() => {
    if (!token || !params.id) return;
    Promise.all([
      admin.getAgent(token, params.id as string),
      admin.getAgentPerformance(token, params.id as string),
    ]).then(([agentRes, perfRes]) => {
      setAgent(agentRes.data);
      setPerformance(perfRes.data);
    }).catch(console.error).finally(() => setLoading(false));

    // Journey and customer roster load independently — neither should hold up
    // the page if the agent has not started their journey yet.
    loadJourney();
    assignmentsExtra.agentCustomers(token, params.id as string)
      .then((res) => setCustomers(res.data))
      .catch(() => {});
  }, [token, params.id, loadJourney]);

  async function resetStage(stageId: string, title: string) {
    if (!token || !params.id) return;
    if (!confirm(`Reopen "${title}" for this agent? Their previous result is cleared and they can attempt it again.`)) return;
    try {
      await admin.resetAgentStage(token, params.id as string, stageId);
      setNotice(`${title} reopened.`);
      loadJourney();
    } catch (err: any) {
      setNotice(err.message);
    }
  }

  const full = `${agent?.firstName ?? ''} ${agent?.lastName ?? ''}`.trim();
  const initial = agent?.firstName?.[0] ?? agent?.lastName?.[0] ?? '·';
  const calls = agent?.agentProfile?.totalCalls || 0;
  const lead = performance?.campaignAverages?.[0] as any;
  const score = lead ? lead.averageScore : agent?.agentProfile?.averageScore ?? 0;
  const coachingSummary = performance?.coachingSummary;
  const categoryAverages = coachingSummary?.categoryAverages ?? [];
  const focusArea = coachingSummary?.focusArea;

  const headerScore = useCountUp(score, 450);
  const cardScore = useCountUp(score, 650);
  const ringOffset = RING_C * (1 - cardScore / 100);

  // Journey bar draws itself once the section is in view.
  const journeyPct = journey && journey.gatedCount > 0 ? Math.round((journey.completedCount / journey.gatedCount) * 100) : 0;
  const [fill, setFill] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setFill(journeyPct), 150);
    return () => window.clearTimeout(t);
  }, [journeyPct]);

  if (loading) {
    return (
      <div className="flex">
        <AdminSidebar />
        <div className="ledger-scope ml-64 min-h-screen flex-1 bg-ledger-bg">
          <main className="flex min-h-screen w-full items-center justify-center px-10 py-9">
            <div className="flex items-center gap-3 font-mono-ui text-[11px] uppercase tracking-[0.14em] text-ledger-faint">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-ledger-brand border-t-transparent" />
              Opening ledger…
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex">
      <AdminSidebar />
      <div className="ledger-scope ml-64 min-h-screen flex-1 bg-ledger-bg">
        <main className="w-full px-10 py-9">
          {/* Back */}
          <Reveal>
            <button
              onClick={() => router.push('/agents')}
              className="mb-7 inline-flex items-center gap-1.5 font-mono-ui text-[11.5px] tracking-[0.04em] text-ledger-muted transition-colors duration-150 hover:text-ledger-brand"
            >
              <ChevronGlyph className="h-3 w-3 stroke-current" />
              Back to Agents
            </button>
          </Reveal>

          {/* Top row: identity + score */}
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.3fr_1fr]">
            <Reveal delay={90}>
              <section className="ledger-panel flex items-center gap-[18px] rounded-2xl border px-6 py-5">
                <div className="relative h-14 w-14 flex-none rounded-[14px] bg-ledger-brand text-white shadow-[0_4px_12px_rgba(46,27,51,0.3)]">
                  <span className="grid h-full w-full place-items-center font-serif-ui text-[22px] font-semibold uppercase">{initial}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate font-serif-ui text-[23px] font-semibold leading-tight tracking-[-0.01em] text-ledger-ink">
                    {full || '·'}
                  </h1>
                  <p className="mb-2.5 truncate text-[13px] text-ledger-muted">{agent?.email}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {agent?.isActive ? (
                      <Pill className="admin-pill-status-active">
                        Active
                      </Pill>
                    ) : (
                      <Pill className="bg-ledger-bad-bg text-ledger-bad" dot="bg-ledger-bad">
                        Disabled
                      </Pill>
                    )}
                    <Pill className="border border-ledger-line bg-ledger-bg text-ledger-muted">{calls} calls</Pill>
                  </div>
                </div>
                <div className="flex-none border-l border-ledger-line pl-5 text-center">
                  <div className="num font-serif-ui text-2xl font-bold leading-none text-ledger-brand-deep">{headerScore}%</div>
                  <div className="mt-1.5 whitespace-nowrap font-mono-ui text-[9px] uppercase tracking-[0.1em] text-ledger-muted">Avg Score</div>
                </div>
              </section>
            </Reveal>

            <Reveal delay={180}>
              <section className="ledger-panel flex items-center gap-6 rounded-2xl border px-6 py-5">
                <div className="min-w-0 flex-1">
                  {lead && (
                    <Pill className={lead.campaign === 'MEDICARE' ? 'admin-pill-campaign-medicare mb-3' : 'mb-3 border border-ledger-line bg-ledger-bg text-ledger-muted'}>
                      {lead.campaign.replace('_', ' ')}
                    </Pill>
                  )}
                  <div className={`font-serif-ui text-[38px] font-bold leading-none ${scoreColor(score)}`}>
                    <span className="num">{cardScore}%</span>
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-ledger-muted">
                    {lead ? `${lead.totalCalls} calls` : `${calls} calls`}
                  </p>
                </div>
                <div className="relative h-24 w-24 flex-none">
                  <svg viewBox="0 0 90 90" className="h-full w-full -rotate-90">
                    <circle className="stroke-ledger-bg" cx="45" cy="45" r="40" fill="none" strokeWidth="8" />
                    <circle
                      className={`${scoreStroke(score)}`}
                      cx="45" cy="45" r="40" fill="none" strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={RING_C}
                      strokeDashoffset={ringOffset}
                      style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)' }}
                    />
                  </svg>
                  <div className="absolute inset-0 grid place-items-center font-mono-ui text-[12px] font-semibold text-ledger-muted">
                    <span className="num">{cardScore}%</span>
                  </div>
                </div>
              </section>
            </Reveal>
          </div>

          {/* Per-agent coaching: all values below come from this agent's saved
              evaluations, never the team dashboard or placeholder data. */}
          <Reveal delay={250}>
            <section className="ledger-panel mt-3.5 rounded-2xl border px-6 py-5">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h2 className="font-serif-ui text-[17px] font-semibold text-ledger-ink">Performance focus</h2>
                  <p className="mt-1 text-[12.5px] text-ledger-muted">
                    Based on {performance?.totalEvaluations ?? 0} completed evaluation{performance?.totalEvaluations === 1 ? '' : 's'}.
                  </p>
                </div>
                {coachingSummary?.hasEnoughData && (
                  <Pill className="border border-ledger-brand/20 bg-ledger-brand/10 text-ledger-brand">
                    Individual coaching view
                  </Pill>
                )}
              </div>

              {!coachingSummary?.hasEnoughData ? (
                <div className="rounded-xl border border-ledger-line bg-ledger-bg px-4 py-5 text-center">
                  <p className="text-[13.5px] font-semibold text-ledger-ink">More scored calls are needed</p>
                  <p className="mx-auto mt-1.5 max-w-xl text-[12.5px] leading-relaxed text-ledger-muted">
                    Complete at least {coachingSummary?.minimumCallsForFocus ?? 2} evaluations before choosing a reliable training focus for this agent.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    {categoryAverages.map((category: any) => (
                      <CategoryScoreCard key={category.id} label={category.label} score={category.averageScore} />
                    ))}
                  </div>

                  {focusArea && (
                    <div className="mt-4 flex flex-wrap items-center gap-5 rounded-xl border border-ledger-gold/30 bg-ledger-gold/10 px-5 py-4">
                      <ScoreRing score={focusArea.averageScore} size="small" />
                      <div className="min-w-0 flex-1">
                        <Pill className="mb-2 border border-ledger-bad/25 bg-ledger-bad-bg text-ledger-bad">
                          Focus area
                        </Pill>
                        <h3 className="font-serif-ui text-[23px] font-semibold leading-none text-ledger-ink">{focusArea.label}</h3>
                        <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-ledger-muted">
                          {full || 'This agent'} averages <strong className="font-semibold text-ledger-ink">{focusArea.averageScore}%</strong> in {focusArea.label.toLowerCase()}, their lowest measured skill across {performance.totalEvaluations} completed evaluations.
                        </p>
                        {coachingSummary.coachingThemes?.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {coachingSummary.coachingThemes.map((theme: any) => (
                              <span key={theme.text} className="max-w-full truncate rounded-lg border border-ledger-line bg-ledger-bg px-2.5 py-1 text-[11.5px] text-ledger-muted" title={theme.text}>
                                {theme.text}{theme.count > 1 ? ` (${theme.count} calls)` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => router.push(trainingDestination(focusArea.id))}
                        className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-xl bg-ledger-brand px-4 py-2.5 text-[12.5px] font-semibold text-white shadow-[0_4px_12px_rgba(46,27,51,0.22)] transition hover:bg-ledger-brand-deep"
                      >
                        Train this area
                        <ArrowGlyph className="h-3.5 w-3.5 stroke-current" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          </Reveal>

          {/* Session history */}
          <Reveal delay={320}>
            <section className="ledger-panel mt-3.5 rounded-2xl border px-6 py-5">
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <h2 className="font-serif-ui text-[17px] font-semibold text-ledger-ink">Session History</h2>
              </div>
              {agent?.sessions?.length ? (
                <div className="flex flex-col gap-2.5">
                  {agent.sessions.map((session: any, i: number) => {
                    const s = session.evaluation?.overallScore;
                    return (
                      <Reveal key={session.id} delay={i * 70}>
                        {/*
                          Each row opens the full call: score, section
                          breakdown, coaching and the whole transcript. The
                          detail page is keyed on the SESSION id — the same id
                          this row already has — so nothing new was needed on
                          the server; the rows simply were not linked.
                        */}
                        <Link
                          href={`/calls/${session.id}`}
                          aria-label={`Open the call detail for ${session.scenario?.name ?? 'this session'}`}
                          className="group flex items-center justify-between gap-4 rounded-[10px] border border-ledger-line border-l-[3px] border-l-ledger-line bg-ledger-bg px-4 py-3.5 transition-colors duration-150 hover:border-l-ledger-brand hover:bg-ledger-row focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ledger-brand">
                          <div className="flex min-w-0 flex-col gap-1.5">
                            <p className="truncate text-[13.5px] font-semibold text-ledger-ink">{session.scenario?.name}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              {session.scenario?.campaign && (
                                <Pill className={session.scenario.campaign === 'MEDICARE' ? 'admin-pill-campaign-medicare' : 'border border-ledger-line bg-ledger-bg text-ledger-muted'}>
                                  {session.scenario.campaign.replace('_', ' ')}
                                </Pill>
                              )}
                              {session.scenario?.difficulty && (
                                <Pill className={DIFF_PILL[session.scenario.difficulty] ?? 'border border-ledger-line bg-ledger-bg text-ledger-muted font-semibold'}>
                                  {session.scenario.difficulty}
                                </Pill>
                              )}
                              <span className="font-mono-ui text-[10.5px] text-ledger-muted">{formatDate(session.createdAt)}</span>
                            </div>
                          </div>
                          <span className="flex flex-none items-center gap-2.5">
                            {s != null ? (
                              <span className={`num font-serif-ui text-[19px] font-bold ${scoreColor(s)}`}>{s}%</span>
                            ) : (
                              <span className="font-mono-ui text-[10.5px] text-ledger-muted">not scored</span>
                            )}
                            {/* Affordance: without it the row gives no sign it opens anything. */}
                            <span aria-hidden="true" className="text-ledger-muted transition-transform duration-150 group-hover:translate-x-0.5">&rsaquo;</span>
                          </span>
                        </Link>
                      </Reveal>
                    );
                  })}
                </div>
              ) : (
                <p className="py-6 text-center font-mono-ui text-[11px] uppercase tracking-[0.12em] text-ledger-faint">
                  No sessions yet
                </p>
              )}
            </section>
          </Reveal>

          {/* Training journey */}
          {journey && (
            <Reveal delay={410}>
              <section className="ledger-panel mt-3.5 rounded-2xl border px-6 py-5">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                  <h2 className="font-serif-ui text-[17px] font-semibold text-ledger-ink">Training Journey</h2>
                  <span className="whitespace-nowrap font-mono-ui text-[10.5px] uppercase tracking-[0.05em] text-ledger-muted">
                    {journey.completedCount} of {journey.gatedCount} steps complete
                  </span>
                </div>

                <div className="mb-[18px] h-[5px] overflow-hidden rounded-full border border-ledger-line bg-ledger-bg">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-ledger-brand-bright to-ledger-brand"
                    style={{ width: `${fill}%`, transition: 'width 1.1s cubic-bezier(.2,.8,.2,1)' }}
                  />
                </div>

                <div className="divide-y divide-ledger-line">
                  {journey.stages.map((stage: any, i: number) => (
                    <Reveal key={stage.id} delay={i * 70}>
                      <div className="py-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                            <p className="text-sm font-semibold text-ledger-ink">{stage.title}</p>
                            <Pill className={STAGE_PILL[stage.status] ?? 'bg-ledger-bg border border-ledger-line text-ledger-muted'}>
                              {STAGE_LABEL[stage.status] ?? stage.status}
                            </Pill>
                            {stage.alwaysAvailable && (
                            <Pill className="bg-ledger-bad/10 text-ledger-bad">Always open</Pill>
                            )}
                          </div>
                          <div className="ml-auto flex items-center gap-3">
                            {(stage.status === 'FAILED' || stage.status === 'PASSED') && !stage.alwaysAvailable && (
                              <button
                                onClick={() => resetStage(stage.id, stage.title)}
                                className="font-mono-ui text-[11px] uppercase tracking-[0.05em] text-ledger-brand transition-colors duration-150 hover:border-b hover:border-ledger-brand"
                              >
                                Reopen
                              </button>
                            )}
                            <StatusIcon status={stage.status} />
                          </div>
                        </div>
                        {(stage.bestScorePct != null || stage.attemptsAllowed != null || (stage.locked && stage.lockReason)) && (
                          <p className="mt-1.5 text-[12px] text-ledger-muted">
                            {stage.bestScorePct != null && `Score ${stage.bestScorePct}% · `}
                            {stage.attemptsAllowed != null && `${stage.attemptsUsed}/${stage.attemptsAllowed} attempts used`}
                            {stage.locked && stage.lockReason && ` · ${stage.lockReason}`}
                          </p>
                        )}
                      </div>
                    </Reveal>
                  ))}
                </div>

                <p className="mt-3.5 rounded-lg border border-ledger-line bg-ledger-bg px-4 py-3 text-[12px] leading-relaxed text-ledger-muted">
                  Quizzes allow a single attempt by default. Use <strong className="font-semibold text-ledger-ink">Reopen</strong> to
                  give an agent another try after a failure.
                </p>
              </section>
            </Reveal>
          )}

          {/* Assigned customers */}
          <Reveal delay={500}>
            <section className="ledger-panel mt-3.5 rounded-2xl border px-6 py-5">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-serif-ui text-[17px] font-semibold text-ledger-ink">Assigned customers</h2>
                <span className="whitespace-nowrap font-mono-ui text-[10.5px] uppercase tracking-[0.05em] text-ledger-muted">
                  {customers.length} active
                </span>
              </div>

              {customers.length === 0 ? (
                <div className="py-6 text-center">
                  <PersonGlyph className="mx-auto mb-2.5 h-7 w-7 animate-bounce stroke-ledger-faint" />
                  <p className="text-[13px] text-ledger-muted">
                    No customers assigned yet. The mock call stage stays unusable until this agent has at least one.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {customers.map((a: any) => (
                    <div key={a.id} className="rounded-xl border border-ledger-line bg-ledger-bg px-4 py-3.5">
                      <p className="truncate text-[13.5px] font-semibold text-ledger-ink">{a.scenario.personaName}</p>
                      <p className="mt-0.5 truncate text-[12.5px] text-ledger-muted">{a.scenario.name}</p>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {a.scenario.campaign && (
                          <Pill className={a.scenario.campaign === 'MEDICARE' ? 'admin-pill-campaign-medicare' : 'border border-ledger-line bg-ledger-bg text-ledger-muted'}>
                            {a.scenario.campaign.replace('_', ' ')}
                          </Pill>
                        )}
                        {a.scenario.difficulty && (
                          <Pill className={DIFF_PILL[a.scenario.difficulty] ?? 'border border-ledger-line bg-ledger-bg text-ledger-muted font-semibold'}>
                            {a.scenario.difficulty}
                          </Pill>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </Reveal>

          {notice && (
            <div className="mt-4 flex items-start justify-between gap-4 rounded-xl border border-ledger-line bg-ledger-bg2 px-4 py-3">
              <p className="text-[13px] font-medium text-ledger-ink">{notice}</p>
              <button onClick={() => setNotice('')} className="font-mono-ui text-[11px] uppercase tracking-[0.08em] text-ledger-brand hover:brightness-110">
                Dismiss
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'PASSED') {
    return (
      <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-ledger-good-bg">
        <svg viewBox="0 0 24 24" className="h-3 w-3 stroke-ledger-good" fill="none" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l5 5L19 7" />
        </svg>
      </span>
    );
  }
  if (status === 'FAILED') {
    return (
      <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-ledger-bad-bg">
        <svg viewBox="0 0 24 24" className="h-3 w-3 stroke-ledger-bad" fill="none" strokeWidth={2.6} strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </span>
    );
  }
  if (status === 'LOCKED') {
    return (
      <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-ledger-faint/10">
        <svg viewBox="0 0 24 24" className="h-3 w-3 stroke-ledger-faint" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V7a4 4 0 018 0v4" />
        </svg>
      </span>
    );
  }
  return (
    <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-ledger-brand/15">
      <span className="h-[13px] w-[13px] animate-spin rounded-full border-2 border-ledger-brand-bright border-t-ledger-brand-deep" />
    </span>
  );
}

// ── glyphs ────────────────────────────────────────────────────
const S = { fill: 'none', strokeWidth: 1.9, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
const d = (path: string) => <path strokeLinecap="round" strokeLinejoin="round" d={path} />;

function ChevronGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S} strokeWidth={2.3}>{d('M15 18l-6-6 6-6')}</svg>;
}
function ArrowGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S} strokeWidth={2.2}>{d('M5 12h14m-5-5 5 5-5 5')}</svg>;
}
function PersonGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c1.2-3.6 4.2-5.5 8-5.5s6.8 1.9 8 5.5')}</svg>;
}
