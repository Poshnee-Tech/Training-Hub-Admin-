'use client';

/**
 * Analytics — the console's drill-down view.
 *
 * SCOPE
 * Every panel on this page answers the same question for whatever slice the
 * filter bar names: the whole floor, one campaign, one agent, or one agent on
 * one campaign. The scope is held here and passed to every request, so two
 * panels can never disagree about what they are counting.
 *
 *   GET /api/admin/analytics/overview?campaign=&agentId=
 *   GET /api/admin/analytics/trends?campaign=&agentId=
 *   GET /api/admin/analytics/campaign/{ACA,MEDICARE,MED_ALERT}?agentId=
 *
 * The two query parameters are new; the response shapes are unchanged, and
 * omitting both gives exactly the floor-wide numbers this page showed before.
 *
 * WHY THE FILTERS ARE SERVER-SIDE
 * Narrowing in the browser would have worked for the evaluation list, and for
 * nothing else: the completed-call count, the category averages and the daily
 * buckets are aggregated in SQL and never ship the rows they were computed
 * from. A campaign filter that silently only applied to two of five panels is
 * worse than no filter.
 *
 * REFETCH KEEPS THE FRAME
 * Changing scope does not blank the page. The previous render is held at
 * reduced opacity until the new numbers land, so nothing jumps and the reader
 * keeps their place.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminSidebar from '@/components/layout/AdminSidebar';
import { HeroAverage, Tile } from '@/components/admin/AnalyticsTiles';
import AnalyticsFilters, {
  agentLabel,
  campaignLabel,
  type Agent,
} from '@/components/admin/AnalyticsFilters';
import ScoreTrendChart from '@/components/admin/ScoreTrendChart';
import CategoryBars from '@/components/admin/CategoryBars';
import VolumeColumns from '@/components/admin/VolumeColumns';
import CampaignBreakdown from '@/components/admin/CampaignBreakdown';
import { useAuthStore } from '@/store/auth.store';
import { admin } from '@/lib/api';
import {
  CATEGORIES,
  WINDOW_DAYS,
  categoryStats,
  dailyScores,
  dailyVolume,
  overallDelta,
  passRate,
} from '@/lib/analytics-series';

const ALL_CAMPAIGNS = ['ACA', 'MEDICARE', 'MED_ALERT'] as const;

export default function AnalyticsPage() {
  const { token, loadFromStorage } = useAuthStore();

  const [campaign, setCampaign] = useState('');
  const [agent, setAgent] = useState<Agent | null>(null);

  const [overview, setOverview] = useState<any>(null);
  const [trends, setTrends] = useState<any>(null);
  const [campaignData, setCampaignData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  // Only the campaigns in scope are fetched. With one selected that is a single
  // request instead of three, and the breakdown below cannot show a campaign
  // the rest of the page has excluded.
  const campaignsInScope = useMemo(
    () => (campaign ? [campaign] : [...ALL_CAMPAIGNS]),
    [campaign],
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    // First load blocks on a spinner; a scope change holds the old render.
    if (overview) setRefreshing(true);

    const scope = { campaign: campaign || undefined, agentId: agent?.id };

    Promise.all([
      admin.analyticsOverview(token, scope),
      admin.trends(token, scope),
      ...campaignsInScope.map((c) => admin.campaignAnalytics(token, c, agent?.id)),
    ])
      .then(([overviewRes, trendsRes, ...campaignRes]) => {
        if (cancelled) return;
        setFailed(false);
        setOverview(overviewRes.data);
        setTrends(trendsRes.data);
        setCampaignData(
          Object.fromEntries(campaignsInScope.map((c, i) => [c, campaignRes[i].data])),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setFailed(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => { cancelled = true; };
    // `overview` is deliberately not a dependency — it is read only to decide
    // between the spinner and the held frame, and including it would refetch
    // every time the data it just fetched arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, campaign, agent?.id, campaignsInScope, refreshKey]);

  const evaluations = trends?.evaluations ?? [];

  const series = useMemo(
    () => ({
      score: dailyScores(evaluations),
      volume: dailyVolume(overview?.dailyCalls ?? []),
      categories: categoryStats(evaluations, overview?.categoryAverages ?? {}),
      onTarget: passRate(evaluations),
      delta: overallDelta(evaluations),
    }),
    [evaluations, overview],
  );

  const windowCalls = series.volume.reduce((sum, d) => sum + d.count, 0);
  const scoredCount = trends?.totalEvaluations ?? 0;
  const totalCalls = overview?.totalCompletedCalls ?? 0;

  // The overview reports 0 both for "averaged zero" and for "nothing scored".
  // The evaluation count is what separates them, and the hero renders an em
  // dash rather than a damning 0% for an agent nobody has graded yet.
  const average = scoredCount > 0 ? (overview?.averageScore ?? 0) : null;
  const empty = totalCalls === 0 && scoredCount === 0;

  const scopeLine = useMemo(() => {
    const who = agent ? agentLabel(agent) : 'Every agent';
    const what = campaign ? campaignLabel(campaign) : 'all campaigns';
    return `${who} · ${what}`;
  }, [agent, campaign]);

  const onCampaign = useCallback((next: string) => setCampaign(next), []);
  const onAgent = useCallback((next: Agent | null) => setAgent(next), []);

  return (
    <div className="flex">
      <AdminSidebar />

      <main className="ml-64 min-w-0 flex-1 px-6 py-7 lg:px-8">
        <div className="mx-auto w-full max-w-[1500px]">
          {/* Header */}
          <header className="mb-6 flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-air-signal shadow-[0_0_10px_rgb(var(--air-signal))] animate-air-blink" />
                <span className="font-mono-ui text-[11px] font-bold uppercase tracking-[0.12em] text-air-faint">
                  Performance intelligence
                </span>
              </div>

              <h1 className="font-display text-[28px] font-extrabold tracking-[-0.035em] text-air-text">
                Analytics
              </h1>

              <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-air-muted">
                {agent
                  ? `See how ${agentLabel(agent)} is trending, which skills need attention, and where practice volume is going.`
                  : 'Track floor-wide performance, skill gaps, call volume, and campaign trends from one consistent view.'}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-air-signal/25 bg-air-signal/[0.07] px-2.5 py-1 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.1em] text-air-signal-bright">
                  Rolling {WINDOW_DAYS} days
                </span>
                <span className="inline-flex items-center rounded-full border border-air-line bg-air-panel px-2.5 py-1 text-[11px] font-semibold text-air-muted">
                  {scopeLine}
                </span>
                {refreshing && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-air-line bg-air-panel px-2.5 py-1 text-[11px] font-semibold text-air-muted">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-air-signal" />
                    Updating
                  </span>
                )}
              </div>
            </div>

            {!loading && !failed && overview && (
              <div className="shrink-0">
                <HeroAverage
                  average={average}
                  delta={series.delta}
                  label={agent ? `${agentLabel(agent)} average` : 'Team average'}
                />
              </div>
            )}
          </header>

          {/* Filters */}
          <section className="air-panel mb-6 rounded-[18px] border p-3.5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[13.5px] font-bold text-air-text">Analytics scope</h2>
                <p className="mt-0.5 text-[11.5px] text-air-muted">
                  Every chart below uses the same campaign and agent selection.
                </p>
              </div>

              {(campaign || agent) && (
                <button
                  type="button"
                  onClick={() => {
                    setCampaign('');
                    setAgent(null);
                  }}
                  disabled={refreshing}
                  className="rounded-xl border border-air-line bg-air-panel px-3 py-2 text-[12px] font-semibold text-air-muted transition hover:text-air-text disabled:opacity-50"
                >
                  Clear scope
                </button>
              )}
            </div>

            <AnalyticsFilters
              token={token}
              campaign={campaign}
              agent={agent}
              onCampaign={onCampaign}
              onAgent={onAgent}
              busy={refreshing}
            />
          </section>

          {loading ? (
            <AnalyticsSkeleton />
          ) : failed || !overview ? (
            <div className="air-panel flex min-h-[320px] flex-col items-center justify-center rounded-[20px] border px-6 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl border border-air-line bg-air-panel text-air-signal-bright">
                <AlertGlyph className="h-5 w-5" />
              </div>
              <h2 className="mt-4 font-display text-[16px] font-bold text-air-text">
                Could not load analytics
              </h2>
              <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-air-muted">
                The current analytics scope could not be loaded. Try again without losing your selected campaign or agent.
              </p>
              <button
                type="button"
                onClick={() => setRefreshKey((key) => key + 1)}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-air-signal px-4 py-2.5 text-[12.5px] font-bold text-white transition hover:brightness-110"
              >
                <RefreshGlyph className="h-4 w-4" />
                Try again
              </button>
            </div>
          ) : (
            <div
              className={`space-y-6 transition-opacity duration-200 ${
                refreshing ? 'pointer-events-none opacity-55' : 'opacity-100'
              }`}
              aria-busy={refreshing}
            >
              {empty && (
                <div className="air-panel rounded-[20px] border border-dashed px-6 py-10 text-center">
                  <div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl border border-air-line bg-air-panel text-air-signal-bright">
                    <ChartGlyph className="h-5 w-5" />
                  </div>
                  <p className="mt-4 font-display text-[16px] font-bold text-air-text">
                    Nothing recorded for this selection
                  </p>
                  <p className="mx-auto mt-1.5 max-w-lg text-[13px] leading-relaxed text-air-muted">
                    {scopeLine} has no completed calls or scored evaluations yet. Widen the filters above to see more.
                  </p>
                </div>
              )}

              {/* KPI row */}
              <section>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-bold tracking-[-0.01em] text-air-text">
                      Performance snapshot
                    </h2>
                    <p className="mt-0.5 text-[12px] text-air-muted">
                      High-level activity and scoring for the current scope.
                    </p>
                  </div>
                  <span className="font-mono-ui text-[9.5px] uppercase tracking-[0.12em] text-air-faint">
                    {scopeLine}
                  </span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Tile
                    label="Completed calls"
                    value={totalCalls}
                    accent="signal"
                    footnote={campaign ? `All time on ${campaignLabel(campaign)}` : 'All time, across every campaign'}
                  />
                  <Tile
                    label={`Calls · last ${WINDOW_DAYS} days`}
                    value={windowCalls}
                    accent="cyan"
                    footnote={`Averaging ${(windowCalls / WINDOW_DAYS).toFixed(1)} a day`}
                  />
                  <Tile
                    label={`Evaluations · last ${WINDOW_DAYS} days`}
                    value={scoredCount}
                    accent="signal"
                    footnote="Calls the evaluator has scored"
                  />
                  <Tile
                    label="Hitting the 80 target"
                    value={series.onTarget === null ? null : Math.round(series.onTarget)}
                    suffix="%"
                    accent="mint"
                    meter={series.onTarget}
                    footnote={
                      series.onTarget === null
                        ? 'Nothing scored in the window yet'
                        : 'Share of scored calls at or above 80'
                    }
                  />
                </div>
              </section>

              <ScoreTrendChart days={series.score} />

              <CategoryBars
                stats={series.categories}
                subject={agent ? agentLabel(agent) : 'the floor'}
              />

              <VolumeColumns days={series.volume} />

              <CampaignBreakdown data={campaignData} />

              <div className="air-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3">
                <span className="text-[11.5px] text-air-muted">
                  All panels are calculated from the same server-side scope.
                </span>
                <span className="font-mono-ui text-[9.5px] uppercase tracking-[0.12em] text-air-faint">
                  UTC buckets · {CATEGORIES.length} scored categories · target 80
                </span>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="air-panel h-[132px] animate-pulse rounded-[18px] border p-4">
            <div className="h-3 w-24 rounded bg-air-line" />
            <div className="mt-5 h-8 w-20 rounded bg-air-line" />
            <div className="mt-4 h-3 w-32 rounded bg-air-line" />
          </div>
        ))}
      </div>

      {[0, 1, 2].map((item) => (
        <div key={item} className="air-panel h-[280px] animate-pulse rounded-[20px] border p-5">
          <div className="h-4 w-40 rounded bg-air-line" />
          <div className="mt-6 h-[190px] rounded-2xl bg-air-line/60" />
        </div>
      ))}
    </div>
  );
}

const ICON = {
  fill: 'none',
  strokeWidth: 1.9,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
} as const;

function AlertGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...ICON} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

function RefreshGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...ICON} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 6v5h-5M4 18v-5h5M18.4 9A7 7 0 0 0 6.2 6.2L4 8M5.6 15A7 7 0 0 0 17.8 17.8L20 16" />
    </svg>
  );
}

function ChartGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...ICON} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 19V9m6 10V5m6 14v-7m4 7H2" />
    </svg>
  );
}
