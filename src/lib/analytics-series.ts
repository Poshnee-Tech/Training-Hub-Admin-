/**
 * Shapes the three analytics endpoints into series the charts can draw.
 *
 * Pure functions, no React — the page stays a layout file and the arithmetic
 * that decides what a reader sees lives in one place that can be reasoned
 * about on its own.
 *
 * NO NEW REQUESTS. Everything here is derived from payloads the analytics page
 * already fetches:
 *   /api/admin/analytics/overview   totalCompletedCalls, averageScore,
 *                                   categoryAverages, dailyCalls
 *   /api/admin/analytics/trends     30 days of per-evaluation category scores
 *   /api/admin/analytics/campaign/* totalSessions, byDifficulty
 * The old page threw most of that away: `dailyCalls` was never drawn at all,
 * and `trends.evaluations` was rendered as one bar per evaluation, which is a
 * chart of row order rather than of time.
 *
 * DAY KEYS ARE UTC.
 * `dailyCalls.date` is a Postgres DATE and arrives as an ISO string; the
 * evaluations carry full ISO timestamps. Both are bucketed on the first ten
 * characters of their ISO form, and every label is formatted with
 * `timeZone: 'UTC'`. One clock for both series is what lets a spike in call
 * volume line up with the dip in score that came with it — bucketing one
 * locally and one in UTC would slide them a day apart either side of midnight.
 */

export const WINDOW_DAYS = 30;

/** The five scored categories, in the order the evaluator reports them. */
export const CATEGORIES = [
  { key: 'openingScore', label: 'Opening' },
  { key: 'communicationScore', label: 'Communication' },
  { key: 'objectionScore', label: 'Objection handling' },
  { key: 'knowledgeScore', label: 'Product knowledge' },
  { key: 'closingScore', label: 'Closing' },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]['key'];

export type Evaluation = {
  evaluatedAt: string;
  overallScore: number;
} & Partial<Record<CategoryKey, number | null>>;

/** One calendar day. `avg` is null on days with no evaluations — see below. */
export type DayPoint = {
  key: string;
  label: string;
  avg: number | null;
  count: number;
  trailing: number | null;
};

export type CategoryStat = {
  key: CategoryKey;
  label: string;
  score: number;
  delta: number | null;
  spark: number[];
};

/** ISO string or Date to a `YYYY-MM-DD` UTC day key. */
function dayKey(value: string | Date): string {
  const iso = typeof value === 'string' ? value : value.toISOString();
  return iso.slice(0, 10);
}

function labelFor(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The `WINDOW_DAYS` calendar days ending today, oldest first.
 *
 * Built from the calendar rather than from the data, so a quiet week renders
 * as a quiet week instead of silently compressing into whatever days happen to
 * carry rows.
 */
function windowKeys(now = new Date()): string[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = 86_400_000;
  return Array.from({ length: WINDOW_DAYS }, (_, i) =>
    dayKey(new Date(end - (WINDOW_DAYS - 1 - i) * day)),
  );
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Daily average overall score across the window, plus a trailing 7-day mean.
 *
 * A day with no evaluations gets `avg: null`, not 0. Zero would be a claim
 * that the floor scored nothing that day; null is the truth — nobody was
 * scored — and the chart draws a gap rather than a crash to the axis.
 *
 * The trailing average spans real days, not the last seven *scored* days: on a
 * floor that runs Monday to Friday, averaging the last seven scored days
 * quietly reaches back a week and a half and smooths away the weekend it was
 * meant to show.
 */
export function dailyScores(evaluations: Evaluation[] = [], window = 7): DayPoint[] {
  const buckets = new Map<string, number[]>();
  for (const e of evaluations) {
    if (!e?.evaluatedAt || typeof e.overallScore !== 'number') continue;
    const k = dayKey(e.evaluatedAt);
    const bucket = buckets.get(k);
    if (bucket) bucket.push(e.overallScore);
    else buckets.set(k, [e.overallScore]);
  }

  const days = windowKeys().map((key) => {
    const scores = buckets.get(key) ?? [];
    return { key, label: labelFor(key), avg: mean(scores), count: scores.length };
  });

  return days.map((day, i) => {
    const slice = days.slice(Math.max(0, i - window + 1), i + 1);
    const scored = slice.filter((d) => d.avg !== null);
    return {
      ...day,
      // Below half a window of scored days the trailing mean is noise wearing
      // a smooth line's clothes, so it simply does not start yet.
      trailing:
        scored.length >= Math.ceil(window / 2)
          ? mean(scored.map((d) => d.avg as number))
          : null,
    };
  });
}

/** Completed calls per day across the same window, zero-filled. */
export function dailyVolume(
  dailyCalls: Array<{ date: string; count: number }> = [],
): DayPoint[] {
  const byDay = new Map<string, number>();
  for (const row of dailyCalls) {
    if (!row?.date) continue;
    byDay.set(dayKey(row.date), Number(row.count) || 0);
  }

  // Zero IS the fact here, unlike the score series: a day with no completed
  // calls genuinely had none, so the column is drawn flat at the baseline.
  return windowKeys().map((key) => ({
    key,
    label: labelFor(key),
    avg: null,
    count: byDay.get(key) ?? 0,
    trailing: null,
  }));
}

/**
 * Per-category standing, ranked weakest first.
 *
 * `score` prefers the overview's all-time average — the number the rest of the
 * console quotes — and falls back to the 30-day window only when the overview
 * supplied none, so a category never renders blank because two endpoints
 * disagree about how far back to look.
 *
 * `delta` compares the second half of the window against the first, and stays
 * null unless both halves carry at least three evaluations. A "+18 pts" built
 * from one call on each side is a coin flip presented as a trend.
 */
export function categoryStats(
  evaluations: Evaluation[] = [],
  overviewAverages: Partial<Record<CategoryKey, number | null>> = {},
): CategoryStat[] {
  const midpoint = Date.now() - (WINDOW_DAYS / 2) * 86_400_000;
  const MIN_PER_HALF = 3;

  const stats = CATEGORIES.map(({ key, label }) => {
    const scored = evaluations.filter((e) => typeof e?.[key] === 'number');

    const older: number[] = [];
    const recent: number[] = [];
    for (const e of scored) {
      (new Date(e.evaluatedAt).getTime() >= midpoint ? recent : older).push(e[key] as number);
    }

    const windowAvg = mean(scored.map((e) => e[key] as number));
    const overview = overviewAverages?.[key];
    const score = typeof overview === 'number' ? overview : (windowAvg ?? 0);
    const canCompare = older.length >= MIN_PER_HALF && recent.length >= MIN_PER_HALF;

    return {
      key,
      label,
      score,
      delta: canCompare ? (mean(recent) as number) - (mean(older) as number) : null,
      // Sparkline of the days that were actually scored. Gaps are closed here
      // rather than drawn: at 60px wide a gap reads as a rendering fault.
      spark: dailySeriesFor(scored, key),
    };
  });

  // Weakest first — the console's convention, and the order someone coaching
  // the floor wants: the thing to fix is the first thing on the page.
  return stats.sort((a, b) => a.score - b.score);
}

function dailySeriesFor(evaluations: Evaluation[], key: CategoryKey): number[] {
  const buckets = new Map<string, number[]>();
  for (const e of evaluations) {
    const value = e[key];
    if (typeof value !== 'number') continue;
    const k = dayKey(e.evaluatedAt);
    const bucket = buckets.get(k);
    if (bucket) bucket.push(value);
    else buckets.set(k, [value]);
  }
  return windowKeys()
    .map((k) => mean(buckets.get(k) ?? []))
    .filter((v): v is number => v !== null);
}

/** Share of evaluations in the window that cleared the 80-point target. */
export function passRate(evaluations: Evaluation[] = []): number | null {
  const scored = evaluations.filter((e) => typeof e?.overallScore === 'number');
  if (!scored.length) return null;
  return (scored.filter((e) => e.overallScore >= 80).length / scored.length) * 100;
}

/**
 * Change in team average across the window: the recent half against the half
 * before it. Null when either side is too thin to carry a claim.
 */
export function overallDelta(evaluations: Evaluation[] = []): number | null {
  const midpoint = Date.now() - (WINDOW_DAYS / 2) * 86_400_000;
  const older: number[] = [];
  const recent: number[] = [];

  for (const e of evaluations) {
    if (typeof e?.overallScore !== 'number') continue;
    (new Date(e.evaluatedAt).getTime() >= midpoint ? recent : older).push(e.overallScore);
  }

  if (older.length < 3 || recent.length < 3) return null;
  return (mean(recent) as number) - (mean(older) as number);
}

/** Score band shared by every mark on the page. Mirrors RadialGauge's tones. */
export function scoreBand(score: number): 'strong' | 'mid' | 'weak' {
  if (score >= 80) return 'strong';
  if (score >= 60) return 'mid';
  return 'weak';
}

export const BAND_WORD: Record<'strong' | 'mid' | 'weak', string> = {
  strong: 'On target',
  mid: 'Developing',
  weak: 'Needs work',
};
