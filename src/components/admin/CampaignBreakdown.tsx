'use client';

/**
 * Per-campaign performance, split by scenario difficulty.
 *
 * TWO ENCODINGS, KEPT APART
 * The page this replaces coloured difficulty green / yellow / red — the same
 * three colours it used for scores. That conflates two unrelated things: an
 * EASY scenario is not a "good" scenario, and a reader who has learned that
 * red means trouble reads a red HARD chip as a problem when it is just a
 * label. Here difficulty is an *ordinal* series and wears one hue in three
 * steps (light to heavy = easy to hard), while green / amber / red is reserved
 * for what a score means. Nothing on this page uses a status colour for
 * anything but status.
 *
 * The mix bar above the rows answers a question the old list could not: is the
 * floor actually practising the hard scenarios, or padding its average on easy
 * ones?
 */

import ChartFrame, { ChartEmpty } from './ChartFrame';
import { useCountUp, useInView } from '@/lib/use-chart-motion';
import { BAND_WORD, scoreBand } from '@/lib/analytics-series';

/** Fixed order — the API returns whatever the group-by produced. */
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

/** Ordinal ramp: one hue, three weights. Never a rainbow, never status hues. */
const DIFFICULTY_INK: Record<Difficulty, string> = {
  EASY: 'rgb(var(--air-signal) / 0.38)',
  MEDIUM: 'rgb(var(--air-signal) / 0.68)',
  HARD: 'rgb(var(--air-signal))',
};

const BAND = {
  strong: { fill: 'rgb(var(--air-mint))', track: 'rgb(var(--air-mint) / 0.14)', text: 'text-air-mint' },
  mid: { fill: 'rgb(var(--air-amber))', track: 'rgb(var(--air-amber) / 0.14)', text: 'text-air-amber' },
  weak: { fill: 'rgb(var(--air-live))', track: 'rgb(var(--air-live) / 0.14)', text: 'text-air-live' },
} as const;

type Row = { difficulty: string; count: number; averageScore: number };
type Campaign = { campaign?: string; totalSessions?: number; byDifficulty?: Row[] };

export default function CampaignBreakdown({ data }: { data: Record<string, Campaign> }) {
  const [ref, inView] = useInView<HTMLDivElement>(0.15);
  const entries = Object.entries(data);
  const anySessions = entries.some(([, c]) => (c?.totalSessions ?? 0) > 0);

  // With a campaign filter applied there is only one card, so "each campaign"
  // would be describing a comparison the page is no longer making.
  const single = entries.length === 1;

  return (
    <ChartFrame
      title={single ? `${entries[0][0].replace(/_/g, ' ')} breakdown` : 'Campaign breakdown'}
      subtitle={
        single
          ? 'How this campaign is performing, and how its practice is split across scenario difficulty.'
          : 'How each campaign is performing, and how its practice is split across scenario difficulty.'
      }
      table={<CampaignTable data={data} />}
    >
      <div ref={ref}>
        {!anySessions ? (
          <ChartEmpty>No completed sessions on any campaign yet.</ChartEmpty>
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(272px,1fr))]">
            {entries.map(([name, campaign], i) => (
              <CampaignCard
                key={name}
                name={name}
                campaign={campaign}
                active={inView}
                delay={i * 110}
              />
            ))}
          </div>
        )}
      </div>
    </ChartFrame>
  );
}

function CampaignCard({
  name,
  campaign,
  active,
  delay,
}: {
  name: string;
  campaign: Campaign;
  active: boolean;
  delay: number;
}) {
  const rows = DIFFICULTIES.map((difficulty) => {
    const row = campaign?.byDifficulty?.find((r) => r.difficulty === difficulty);
    return { difficulty, count: row?.count ?? 0, averageScore: row?.averageScore ?? 0 };
  });

  const totalSessions = campaign?.totalSessions ?? 0;
  const mixTotal = rows.reduce((sum, r) => sum + r.count, 0);

  /**
   * Campaign average, weighted by how many calls each difficulty carried.
   *
   * Difficulties whose `averageScore` is 0 are left out rather than averaged
   * in: the endpoint reports 0 both for "scored zero" and for "these sessions
   * have no evaluation yet", and counting the second as a zero would drag a
   * campaign's headline number down for calls nobody has graded.
   */
  const graded = rows.filter((r) => r.averageScore > 0 && r.count > 0);
  const gradedCalls = graded.reduce((sum, r) => sum + r.count, 0);
  const average = gradedCalls
    ? graded.reduce((sum, r) => sum + r.averageScore * r.count, 0) / gradedCalls
    : null;

  const band = average === null ? null : BAND[scoreBand(average)];
  const shown = useCountUp(average ?? 0, { active, duration: 900 });

  return (
    <article className="rounded-[16px] border border-air-line/12 bg-air-line/[0.035] p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-[15px] font-bold tracking-[-0.01em] text-air-text">
            {name.replace(/_/g, ' ')}
          </h3>
          <p className="mt-0.5 font-mono-ui text-[9px] uppercase tracking-[0.14em] text-air-faint">
            {totalSessions.toLocaleString()} session{totalSessions === 1 ? '' : 's'}
          </p>
        </div>

        {average === null ? (
          <span className="shrink-0 font-mono-ui text-[9px] uppercase tracking-[0.1em] text-air-faint">
            Unscored
          </span>
        ) : (
          <div className="shrink-0 text-right">
            <div className="font-display text-[24px] font-extrabold leading-none tabular-nums text-air-text">
              {Math.round(shown)}%
            </div>
            <div className={`mt-1 font-mono-ui text-[8.5px] font-bold uppercase tracking-[0.14em] ${band!.text}`}>
              {BAND_WORD[scoreBand(average)]}
            </div>
          </div>
        )}
      </header>

      {/* ── practice mix ─────────────────────────────────── */}
      {mixTotal > 0 && (
        <div className="mt-4">
          <div className="flex h-[9px] w-full gap-[2px] overflow-hidden rounded-[4px]">
            {rows.map((r, i) =>
              r.count === 0 ? null : (
                <span
                  key={r.difficulty}
                  className="h-full first:rounded-l-[4px] last:rounded-r-[4px]"
                  style={{
                    background: DIFFICULTY_INK[r.difficulty],
                    // Flex-basis rather than width so the 2px surface gaps are
                    // taken out of the track, not added on top of it.
                    flexBasis: `${(r.count / mixTotal) * 100}%`,
                    transform: active ? 'scaleX(1)' : 'scaleX(0)',
                    transformOrigin: 'left',
                    transition: `transform 700ms cubic-bezier(.2,.8,.2,1) ${delay + i * 70}ms`,
                  }}
                />
              ),
            )}
          </div>
          <p className="mt-1.5 font-mono-ui text-[8.5px] uppercase tracking-[0.12em] text-air-faint">
            Practice mix
          </p>
        </div>
      )}

      {/* ── per-difficulty scores ────────────────────────── */}
      <ul className="mt-4 space-y-3">
        {rows.map((r, i) => (
          <DifficultyRow
            key={r.difficulty}
            row={r}
            active={active}
            delay={delay + i * 70}
          />
        ))}
      </ul>
    </article>
  );
}

function DifficultyRow({
  row,
  active,
  delay,
}: {
  row: { difficulty: Difficulty; count: number; averageScore: number };
  active: boolean;
  delay: number;
}) {
  const scored = row.averageScore > 0;
  const band = BAND[scoreBand(row.averageScore)];

  return (
    <li>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-[2px]"
            style={{ background: DIFFICULTY_INK[row.difficulty] }}
          />
          <span className="truncate font-mono-ui text-[10px] font-bold uppercase tracking-[0.12em] text-air-muted">
            {row.difficulty}
          </span>
          <span className="shrink-0 font-mono-ui text-[9.5px] text-air-faint">
            {row.count} call{row.count === 1 ? '' : 's'}
          </span>
        </span>

        <span className="shrink-0 font-display text-[13.5px] font-extrabold tabular-nums text-air-text">
          {scored ? `${Math.round(row.averageScore)}%` : '—'}
        </span>
      </div>

      <div
        className="mt-1.5 h-[7px] w-full overflow-hidden rounded-[3px]"
        style={{ background: scored ? band.track : 'rgb(var(--air-line) / 0.10)' }}
      >
        {scored && (
          <div
            className="h-full rounded-r-[3px]"
            style={{
              background: band.fill,
              width: `${active ? Math.min(100, row.averageScore) : 0}%`,
              transition: `width 800ms cubic-bezier(.2,.8,.2,1) ${delay}ms`,
            }}
          />
        )}
      </div>
    </li>
  );
}

function CampaignTable({ data }: { data: Record<string, Campaign> }) {
  const rows = Object.entries(data).flatMap(([name, campaign]) =>
    DIFFICULTIES.map((difficulty) => {
      const row = campaign?.byDifficulty?.find((r) => r.difficulty === difficulty);
      return {
        id: `${name}-${difficulty}`,
        campaign: name.replace(/_/g, ' '),
        difficulty,
        count: row?.count ?? 0,
        averageScore: row?.averageScore ?? 0,
      };
    }),
  );

  return (
    <table className="w-full text-left text-[12.5px]">
      <thead className="sticky top-0 bg-air-panel">
        <tr className="border-b border-air-line/15">
          {['Campaign', 'Difficulty', 'Calls', 'Average'].map((h, i) => (
            <th
              key={h}
              scope="col"
              className={`py-2 pr-3 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.14em] text-air-faint ${
                i > 1 ? 'text-right' : ''
              }`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-air-line/[0.07]">
            <td className="py-2 pr-3 text-air-text">{r.campaign}</td>
            <td className="py-2 pr-3 text-air-muted">{r.difficulty}</td>
            <td className="py-2 pr-3 text-right tabular-nums text-air-muted">{r.count}</td>
            <td className="py-2 pr-3 text-right tabular-nums text-air-text">
              {r.averageScore > 0 ? `${Math.round(r.averageScore)}%` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
