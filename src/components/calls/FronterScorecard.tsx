'use client';

/**
 * THE QA BREAKDOWN, FOR A SUPERVISOR.
 *
 * The scorecard the evaluator produced, rendered whole: the rating and the
 * outcome verdict, the four conduct checks, then every section with its KPIs
 * and — this is the part the trainee's report never showed — each sub-check
 * with the reason it was marked the way it was and the transcript lines that
 * earned it.
 *
 * ── WHY THE EVIDENCE IS HERE AND NOT ONLY THE SCORE ─────────────────────────
 * A supervisor's question is never "what did this call score", it is "why".
 * A section bar answers the first and invites guessing at the second, and a
 * guess is what a coaching conversation must not be built on. Every mark is
 * shown with the words that produced it, so a supervisor can disagree with the
 * evaluator from the same evidence the evaluator had.
 *
 * NOTHING HERE SCORES ANYTHING. Every number arrives precomputed from the
 * backend; this file lays it out.
 */

import { useState } from 'react';

interface SubCheck {
  subCheckId: string;
  type?: string;
  score: number;
  maxScore: number;
  observed?: unknown;
  reason?: string;
  evidence?: string[];
}

interface Kpi {
  kpiId: string;
  title: string;
  score: number;
  maxScore: number;
  dimension?: string;
  subChecks?: SubCheck[];
}

interface Section {
  sectionId: string;
  title: string;
  score: number;
  maxScore: number;
  kpis?: Kpi[];
}

/** Percentage of a section's available marks, or null when nothing was scorable. */
function ratio(score: number, maxScore: number): number | null {
  if (!maxScore || maxScore <= 0) return null;
  return Math.round((score / maxScore) * 1000) / 10;
}

function toneFor(percent: number | null): { text: string; bar: string } {
  if (percent === null) return { text: 'text-bean-muted', bar: 'bg-bean-line' };
  if (percent >= 80) return { text: 'text-bean-brand', bar: 'bg-bean-brand' };
  if (percent >= 60) return { text: 'text-bean-gold', bar: 'bg-bean-gold' };
  return { text: 'text-bean-live', bar: 'bg-bean-live' };
}

/** `us_accent_match` → `Us accent match`. Last resort when a sub-check has no wording of its own. */
function humanise(id: string): string {
  const words = id.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * What the evaluator observed, in words.
 *
 * A boolean sub-check carries `true`/`false`, an enum carries a token like
 * `too_fast`. Printed raw, both read as debug output on a page a supervisor
 * uses in front of an agent.
 */
function observedLabel(check: SubCheck): string | null {
  if (typeof check.observed === 'string') return humanise(check.observed);
  if (check.observed === true) return check.maxScore > 0 && check.score >= check.maxScore ? 'Met' : 'Yes';
  if (check.observed === false) return 'Not met';
  if (typeof check.observed === 'number') return String(check.observed);
  return null;
}

function SubCheckRow({ check }: { check: SubCheck }) {
  const percent = ratio(check.score, check.maxScore);
  const tone = toneFor(percent);
  const observed = observedLabel(check);
  const notScored = !check.maxScore || check.maxScore <= 0;

  return (
    <div className="border-t border-bean-line/70 px-4 py-3 first:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-bean-ink">{humanise(check.subCheckId)}</div>
          {observed && (
            <div className="mt-0.5 text-[12px] text-bean-muted">
              Observed: <span className="font-medium text-bean-ink">{observed}</span>
            </div>
          )}
        </div>
        <div className={`shrink-0 text-[12px] font-bold ${notScored ? 'text-bean-muted' : tone.text}`}>
          {notScored ? 'Not scored' : `${check.score} / ${check.maxScore}`}
        </div>
      </div>

      {check.reason && (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-bean-muted">{check.reason}</p>
      )}

      {/* The transcript lines the mark was drawn from. Quoted, never
          paraphrased: a supervisor has to be able to check the evaluator. */}
      {check.evidence && check.evidence.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {check.evidence.map((line, i) => (
            <li
              key={i}
              className="rounded-[10px] border-l-2 border-bean-line bg-bean-card2 px-3 py-1.5 text-[12.5px] italic leading-relaxed text-bean-ink"
            >
              &ldquo;{line}&rdquo;
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KpiBlock({ kpi }: { kpi: Kpi }) {
  const [open, setOpen] = useState(false);
  const percent = ratio(kpi.score, kpi.maxScore);
  const tone = toneFor(percent);
  const checks = kpi.subChecks ?? [];
  const notScored = !kpi.maxScore || kpi.maxScore <= 0;

  return (
    <div className="overflow-hidden rounded-[14px] border border-bean-line bg-bean-card2/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={checks.length === 0}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-bean-card2 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-[13.5px] font-semibold text-bean-ink">{kpi.title || humanise(kpi.kpiId)}</span>
          {checks.length > 0 && (
            <span className="text-[11px] text-bean-faint">
              {open ? 'hide' : `${checks.length} check${checks.length === 1 ? '' : 's'}`}
            </span>
          )}
        </span>
        <span className={`shrink-0 text-[13px] font-bold ${notScored ? 'text-bean-muted' : tone.text}`}>
          {notScored ? 'N/A' : `${kpi.score} / ${kpi.maxScore}`}
        </span>
      </button>
      {open && checks.length > 0 && (
        <div className="border-t border-bean-line bg-white">
          {checks.map((check, i) => <SubCheckRow key={`${check.subCheckId}-${i}`} check={check} />)}
        </div>
      )}
    </div>
  );
}

function SectionBlock({ section }: { section: Section }) {
  const percent = ratio(section.score, section.maxScore);
  const tone = toneFor(percent);

  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-1.5 flex items-end justify-between gap-3">
        <span className="text-[13.5px] font-semibold text-bean-ink">{section.title}</span>
        <span className={`text-[13px] font-bold ${tone.text}`}>
          {percent === null ? 'N/A' : `${percent}%`}
          <span className="ml-1.5 text-[11.5px] font-medium text-bean-faint">
            {section.score} / {section.maxScore}
          </span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-bean-line/60">
        <div className={`h-2 rounded-full ${tone.bar}`} style={{ width: `${percent ?? 100}%` }} />
      </div>
      {percent === null && (
        <p className="mt-1 text-[12px] text-bean-muted">
          Not scored: the call ended before this work became appropriate.
        </p>
      )}
      {(section.kpis ?? []).length > 0 && (
        <div className="mt-3 space-y-2">
          {(section.kpis ?? []).map((kpi) => <KpiBlock key={kpi.kpiId} kpi={kpi} />)}
        </div>
      )}
    </div>
  );
}

function CheckChip({ label, passed, detail }: { label: string; passed: boolean; detail: string }) {
  return (
    <div className={`rounded-[14px] border px-3.5 py-3 ${passed ? 'border-bean-brand/25 bg-bean-brand/[0.05]' : 'border-bean-gold/35 bg-bean-gold/[0.08]'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-bean-ink">{label}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${passed ? 'bg-bean-brand/15 text-bean-brand' : 'bg-bean-gold/20 text-bean-gold'}`}>
          {passed ? 'Pass' : 'Review'}
        </span>
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-bean-muted">{detail}</p>
    </div>
  );
}

export function FronterScorecard({ scorecard }: { scorecard: any }) {
  if (!scorecard?.score) return null;

  const score = scorecard.score;
  const sections: Section[] = score.sections ?? [];
  const disposition = scorecard.dispositionHandling ?? null;
  const gateClean = score.gate?.applied === 'none';

  /**
   * The conduct signals, read exactly where the agent's report reads them:
   * from the CONFIRMED gate findings and the professionalism KPI's own count.
   * Deriving them any other way would let the two portals disagree about the
   * same call, which is the one thing a QA tool may never do.
   */
  const confirmedGateIds = new Set<string>(
    (score.gate?.findings ?? [])
      .filter((finding: any) => finding.confirmed)
      .map((finding: any) => finding.gateId),
  );
  const abusiveLanguage = confirmedGateIds.has('abusive_language');
  const pressuredAfterStop = confirmedGateIds.has('pressure_after_refusal')
    || confirmedGateIds.has('ignored_dnc_request');
  const professionalismIssues = Number(
    (score.sections ?? [])
      .find((section: any) => section.sectionId === 'communication')
      ?.kpis?.find((kpi: any) => kpi.kpiId === 'professionalism')
      ?.subChecks?.find((check: any) => check.subCheckId === 'issues')?.observed ?? 0,
  );

  return (
    <div className="bean-card mb-6 rounded-[18px] border p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-bold tracking-[-0.01em] text-bean-ink">Official Fronter scorecard</h2>
          <p className="mt-1 text-[12.5px] text-bean-muted">
            Every mark the evaluator gave, with the transcript lines behind it.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[13px] font-bold uppercase tracking-[0.1em] text-bean-ink">
            {String(score.rating ?? '').replaceAll('_', ' ') || '—'}
          </div>
          <div className="mt-0.5 text-[11.5px] text-bean-muted">
            {score.rawScore} / {score.observableMaxScore} observable
            {scorecard.meta?.evaluationVersion ? ` · ${scorecard.meta.evaluationVersion}` : ''}
          </div>
        </div>
      </div>

      {disposition && (
        <div className="mb-5 rounded-[14px] border border-bean-line bg-bean-card2/50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[15px] font-bold ${disposition.handledCorrectly ? 'text-bean-brand' : 'text-bean-gold'}`}>
              {disposition.handledCorrectly ? 'Handled well' : 'Needs review'}
            </span>
            {disposition.label && (
              <span className="admin-pill border-bean-line bg-white text-bean-muted">{disposition.label}</span>
            )}
          </div>
          {disposition.reason && (
            <p className="mt-2 text-[13px] leading-relaxed text-bean-muted">{disposition.reason}</p>
          )}
          {disposition.criteria && (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-bean-faint">
              <span className="font-semibold text-bean-muted">What good handling looks like here: </span>
              {disposition.criteria}
            </p>
          )}
          {Array.isArray(disposition.mismatches) && disposition.mismatches.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 rounded-[12px] border border-bean-gold/30 bg-bean-gold/[0.07] py-2.5 pl-8 pr-3 text-[12.5px] text-bean-ink">
              {disposition.mismatches.map((line: string, i: number) => <li key={i}>{line}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {disposition && (
          <CheckChip
            label="Overall handling"
            passed={Boolean(disposition.handledCorrectly)}
            detail={disposition.handledCorrectly ? 'The outcome was respected.' : 'The outcome or a safety rule was mishandled.'}
          />
        )}
        <CheckChip
          label="Professional conduct"
          passed={!abusiveLanguage && professionalismIssues === 0}
          detail={abusiveLanguage
            ? 'Directed abuse, a threat, or sexual language was confirmed.'
            : professionalismIssues > 0
              ? `${professionalismIssues} professionalism issue${professionalismIssues === 1 ? '' : 's'} found, such as rudeness, slang, or talking down.`
              : 'No abuse, rudeness, slang, or talking down was found.'}
        />
        <CheckChip
          label="Respect after refusal"
          passed={!pressuredAfterStop}
          detail={pressuredAfterStop ? 'The agent pressured or continued after a stop request.' : 'No improper pressure after the outcome was found.'}
        />
        <CheckChip
          label="Compliance"
          passed={gateClean}
          detail={gateClean ? 'No serious compliance issue was confirmed.' : 'A compliance issue needs review.'}
        />
      </div>

      <div className="rounded-[14px] border border-bean-line bg-white p-4 sm:p-5">
        {sections.length === 0
          ? <p className="text-[13px] text-bean-muted">This scorecard recorded no sections.</p>
          : sections.map((section) => <SectionBlock key={section.sectionId} section={section} />)}
      </div>
    </div>
  );
}
