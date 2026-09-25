'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import AdminSidebar from '@/components/layout/AdminSidebar';
import { useAuthStore } from '@/store/auth.store';
import { admin, settingsApi } from '@/lib/api';
import { formatDuration } from '@/lib/utils';
import { VoiceDeliveryPanel } from '@/components/calls/VoiceDeliveryPanel';
import { FronterScorecard } from '@/components/calls/FronterScorecard';

/**
 * The full Fronter scorecard, or null for an evaluation produced by the
 * legacy evaluator. Same discriminator the agent portal's report uses:
 * `rawResponse.evaluator`.
 */
function readFronterScorecard(rawResponse: any) {
  if (rawResponse?.evaluator !== 'fronter-scorecard') return null;
  return rawResponse.fronterScorecard ?? rawResponse.result ?? null;
}

/**
 * The audio-measured KPIs, gathered into the section shape the voice panel
 * expects.
 *
 * Scorecard v9 merged Voice Delivery into Communication, so a lookup by
 * `sectionId === 'voice_delivery'` finds nothing on a v9 evaluation and the
 * panel silently disappears — no error, just a missing feature. Collecting by
 * KPI ID works on BOTH: the KPIs kept their ids across the merge, and older
 * evaluations still carry them inside the retired section.
 *
 * Null when none are present — an evaluation written before the voice layer.
 */
const AUDIO_KPI_IDS = ['speech_clarity', 'speech_pacing', 'us_accent_match'];

function audioKpisAsSection(sections: any[] | undefined | null) {
  const kpis = (sections ?? [])
    .flatMap((section: any) => section?.kpis ?? [])
    .filter((kpi: any) => AUDIO_KPI_IDS.includes(kpi?.kpiId));
  if (kpis.length === 0) return null;

  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    sectionId: 'voice_delivery',
    title: 'Voice Delivery',
    score: round2(kpis.reduce((sum: number, k: any) => sum + (k.score ?? 0), 0)),
    maxScore: round2(kpis.reduce((sum: number, k: any) => sum + (k.maxScore ?? 0), 0)),
    kpis,
  };
}

function campaignChip(campaign?: string) {
  switch (campaign) {
    case 'ACA': return 'border-bean-brand/35 bg-bean-brand/10 text-bean-brand';
    case 'MEDICARE': return 'admin-pill-campaign-medicare';
    default: return 'border-bean-line bg-bean-card2 text-bean-muted';
  }
}

function difficultyChip(difficulty?: string) {
  switch (difficulty) {
    case 'EASY': return 'admin-pill-difficulty-easy';
    case 'MEDIUM': return 'border-bean-gold/40 bg-bean-gold/12 text-bean-gold';
    default: return 'border-bean-live/35 bg-bean-live/10 text-bean-live';
  }
}

/** Annotation kinds the evaluator emits, and how each reads at a glance. */
const ANNOTATION_TONES: Record<string, string> = {
  great_move: 'border-bean-brand/30 bg-bean-brand/[0.06]',
  good_recovery: 'border-bean-brand/30 bg-bean-brand/[0.06]',
  missed_opportunity: 'border-bean-gold/35 bg-bean-gold/[0.08]',
  lost_customer: 'border-bean-live/30 bg-bean-live/[0.06]',
  key_moment: 'border-bean-line bg-bean-card2',
};

function scoreColor(score: number) {
  return score >= 80 ? 'text-bean-brand' : score >= 60 ? 'text-bean-gold' : 'text-bean-live';
}

export default function CallDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { token, loadFromStorage } = useAuthStore();
  const [call, setCall] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  /** Whether the trainee can currently see what is on this page. Null until read. */
  const [agentReportDetail, setAgentReportDetail] = useState<boolean | null>(null);

  /**
   * Re-scoring state. `rescoring` covers the request itself; `scoringPending`
   * stays true while the worker has the job, which is the part that takes two
   * or three minutes.
   */
  const [rescoring, setRescoring] = useState(false);
  const [scoringPending, setScoringPending] = useState(false);
  const [rescoreError, setRescoreError] = useState<string | null>(null);
  /**
   * When the queue took the job, for a call that is still waiting. Scoring is
   * one job at a time and averages several minutes, so "queued" on its own
   * reads as "stuck" — the wait is the part an admin actually wants to see.
   */
  const [queuedSince, setQueuedSince] = useState<string | null>(null);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  const loadCall = useCallback(async () => {
    if (!token || !params.id) return null;
    const res = await admin.getCallDetail(token, params.id as string);
    setCall(res.data);
    return res.data;
  }, [token, params.id]);

  useEffect(() => {
    if (!token || !params.id) return;
    let cancelled = false;
    void (async () => {
      try {
        await loadCall();
      } catch (error) {
        console.error(error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, params.id, loadCall]);

  /**
   * ── ASK WHAT HAPPENED TO THE SCORE, NOT ONLY AFTER PRESSING THE BUTTON ───
   *
   * The status endpoint was consulted only once re-scoring had been STARTED
   * from this page, so a call that arrived already queued, already failed, or
   * never queued at all looked identical: a blank space where the score goes.
   *
   * MEASURED (2026-09-22, production): 21 evaluation jobs PENDING with the
   * oldest waiting 35 minutes, and 22 DEAD carrying the reason they died. All
   * of it was already being returned by this endpoint and thrown away here.
   *
   * So the page asks on load. A job still working hands over to the existing
   * poll — that machinery was always correct, it was simply never started
   * unless the admin had pressed the button themselves.
   */
  useEffect(() => {
    if (!token || !params.id || loading) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await admin.evaluationStatus(token, params.id as string);
        if (cancelled) return;
        const status = res.data?.status;
        if (status === 'queued' || status === 'processing') {
          setQueuedSince(res.data?.queuedAt ?? null);
          setScoringPending(true);
        } else if (status === 'failed' && res.data?.lastError) {
          setRescoreError(`Scoring failed: ${res.data.lastError}`);
        }
      } catch {
        // A status this page could not read is not a scoring failure. The call
        // and its report, if any, are already on screen.
      }
    })();
    return () => { cancelled = true; };
  }, [token, params.id, loading]);

  /**
   * ── RE-EVALUATE (owner ruling 2026-09-15) ────────────────────────────────
   *
   * This button used to be on the trainee's own report. Re-scoring replaces
   * the mark and keeps no copy of the old one, so the person being marked
   * could re-roll their score until they liked it, with no trace. It is a QA
   * action, so it belongs to whoever owns QA.
   *
   * The confirmation is not ceremony: the current report is destroyed by this,
   * and the score can legitimately come back LOWER.
   */
  const reEvaluate = useCallback(async () => {
    if (!token || !params.id || rescoring || scoringPending) return;
    // A call with no report has nothing to lose, so it is not warned about
    // losing one. The destructive warning belongs only to the destructive case.
    const confirmText = call?.evaluation
      ? 'Re-evaluate this call?\n\n'
        + 'The current report is replaced by a newly generated one and the old '
        + 'score is not kept. The new score may be higher or lower.'
      : 'Evaluate this call?\n\n'
        + 'This call has no report yet. Scoring takes a few minutes, and longer '
        + 'if other calls are queued ahead of it.';
    if (!window.confirm(confirmText)) return;

    setRescoreError(null);
    setRescoring(true);
    try {
      await admin.retryEvaluation(token, params.id as string);
      setScoringPending(true);
    } catch (error: any) {
      setRescoreError(error?.message || 'Could not start re-evaluation.');
    } finally {
      setRescoring(false);
    }
  }, [token, params.id, rescoring, scoringPending, call?.evaluation]);

  /**
   * Poll while the worker holds the job, then reload the call so the new
   * scorecard replaces the old one in place.
   *
   * Bounded at fifteen minutes, the same ceiling the agent report uses: a full
   * evaluation with the voice and accent passes runs two to three minutes, and
   * a shorter bound left the page claiming to be working when it had stopped
   * asking.
   */
  useEffect(() => {
    if (!scoringPending || !token || !params.id) return;
    let cancelled = false;
    let attempts = 0;

    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const res = await admin.evaluationStatus(token, params.id as string);
        // `status` is the normalised one. `jobStatus` beside it is the raw
        // enum (PENDING/PROCESSING) and reading that instead stops the poll
        // on its first tick, because it never equals 'queued'.
        const status = res.data?.status;
        if (status !== 'queued' && status !== 'processing') {
          if (cancelled) return;
          setScoringPending(false);
          setQueuedSince(null);
          if (status === 'failed') {
            setRescoreError(
              res.data?.lastError
                ? `Scoring failed: ${res.data.lastError}`
                : 'Scoring failed. The previous report is still shown.',
            );
          }
          await loadCall();
          return;
        }
      } catch {
        // A single failed poll is not a failed evaluation; keep asking.
      }
      if (cancelled) return;
      if (attempts >= 225) {
        setScoringPending(false);
        setRescoreError('Scoring is taking longer than expected. Reload to check again.');
        return;
      }
      timer = setTimeout(() => void tick(), 4000);
    };

    let timer = setTimeout(() => void tick(), 4000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [scoringPending, token, params.id, loadCall]);

  useEffect(() => {
    if (!token) return;
    settingsApi.get(token)
      .then((res) => setAgentReportDetail(res.data.agentReportDetail))
      .catch(() => setAgentReportDetail(null));
  }, [token]);

  // Derived once, read by four blocks below.
  const scorecard = readFronterScorecard(call?.evaluation?.rawResponse);
  const accentClassification = call?.evaluation?.rawResponse?.accentClassification ?? null;
  const annotationsByMessage = new Map<number, any[]>();
  for (const annotation of call?.evaluation?.transcriptAnnotations ?? []) {
    const list = annotationsByMessage.get(annotation.messageIndex) ?? [];
    list.push(annotation);
    annotationsByMessage.set(annotation.messageIndex, list);
  }

  return (
    <div className="flex">
      <AdminSidebar />
      <main
        className="bean-scope relative mt-14 min-w-0 lg:mt-0 lg:ml-64 min-h-screen flex-1 bg-bean-bg p-4 sm:p-6 lg:p-8 font-body text-bean-ink antialiased"
      >
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-bean-brand border-t-transparent" />
          </div>
        ) : (
          <>
            <button
              onClick={() => router.push('/calls')}
              className="mb-4 text-[13.5px] font-medium text-bean-muted transition-colors hover:text-bean-ink"
            >
              &larr; Back to Calls
            </button>

            {/* Header */}
            <div className="bean-card mb-6 rounded-[18px] border p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="font-display text-[22px] font-bold tracking-[-0.02em] text-bean-ink">
                    {call?.scenario?.name}
                  </h1>
                  <p className="mt-1 text-[13.5px] text-bean-muted">
                    Agent: {call?.user?.firstName} {call?.user?.lastName} ({call?.user?.email})
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <Chip className={campaignChip(call?.scenario?.campaign)}>
                      {call?.scenario?.campaign?.replace('_', ' ')}
                    </Chip>
                    <Chip className={difficultyChip(call?.scenario?.difficulty)}>
                      {call?.scenario?.difficulty}
                    </Chip>
                    {call?.durationSeconds && (
                      <Chip className="border-bean-line bg-bean-card2 text-bean-muted">
                        {formatDuration(call.durationSeconds)}
                      </Chip>
                    )}
                  </div>
                </div>
                {/* ── SCORING THE UNSCORED, NOT ONLY THE RESCORED ────────────
                    This block used to render only when `call.evaluation`
                    existed, so a call that was never scored had no button at
                    all. MEASURED (2026-09-22, production): 22 evaluation jobs
                    DEAD and 21 PENDING — every one of those calls shows no
                    score and, until now, offered no way to ask for one. The
                    queue refuses a duplicate while a job is PENDING or
                    PROCESSING, so the button is safe to press at any time. */}
                {call && (
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {call.evaluation ? (
                      <div className={`text-4xl font-extrabold ${scoreColor(call.evaluation.overallScore)}`}>
                        {call.evaluation.overallScore}%
                      </div>
                    ) : (
                      <div className="text-[13.5px] font-semibold text-bean-muted">Not scored</div>
                    )}
                    {/* Re-scoring lives here, not on the trainee's own report.
                        See the reEvaluate comment above for why. */}
                    <button
                      type="button"
                      onClick={() => void reEvaluate()}
                      disabled={rescoring || scoringPending}
                      className="inline-flex min-h-9 items-center justify-center rounded-lg border border-bean-line bg-bean-card px-3.5 py-1.5 text-[12.5px] font-semibold normal-case tracking-normal text-bean-ink transition-colors hover:border-bean-brand/40 hover:bg-bean-brand/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {rescoring
                        ? 'Starting…'
                        : scoringPending
                          ? (call.evaluation ? 'Re-evaluating…' : 'Evaluating…')
                          : (call.evaluation ? 'Re-evaluate' : 'Evaluate')}
                    </button>
                  </div>
                )}
              </div>

              {scoringPending && (
                <p className="mt-4 border-t border-bean-line pt-3 text-[12.5px] text-bean-muted">
                  {queuedSince
                    /* Already waiting when the page opened. Saying "two to three
                       minutes" here would be a guess contradicted by the queue:
                       jobs run one at a time and can wait far longer. */
                    ? `Queued for scoring since ${new Date(queuedSince).toLocaleTimeString()}. `
                      + 'Calls are scored one at a time, so this can wait behind others. '
                      + 'This page updates on its own.'
                    : 'Scoring this call. It takes two to three minutes; the report below '
                      + 'is the previous one until the new score replaces it. This page '
                      + 'updates on its own.'}
                </p>
              )}
              {rescoreError && (
                <p className="mt-4 border-t border-bean-line pt-3 text-[12.5px] text-bean-live">
                  {rescoreError}
                </p>
              )}
            </div>

            {/*
              A call with no evaluation showed the transcript and nothing else,
              which reads as "this call scored nothing" rather than "this call
              was never scored". They are different facts and a supervisor
              needs to know which one they are looking at.
            */}
            {call && !call.evaluation && (
              <div className="bean-card mb-6 rounded-[18px] border p-6">
                <h2 className="mb-2 text-[17px] font-bold tracking-[-0.01em] text-bean-ink">Evaluation</h2>
                <p className="text-[13.5px] leading-relaxed text-bean-muted">
                  This call has not been scored. Scoring runs after a call ends and takes
                  about thirty seconds; a call that was abandoned early, or whose scoring
                  job failed, never receives one. The full transcript is below either way.
                </p>
              </div>
            )}

            {/* Whether the agent can see any of this. A supervisor about to say
                "look at your report" needs to know the answer before they say
                it, so it is stated here rather than only in Settings. */}
            {agentReportDetail !== null && (
              <div className="mb-6 flex flex-wrap items-center gap-2 text-[12.5px] text-bean-muted">
                <span className={`admin-pill ${agentReportDetail ? 'border-bean-brand/30 bg-bean-brand/[0.07] text-bean-brand' : 'border-bean-line bg-bean-card2 text-bean-muted'}`}>
                  {agentReportDetail ? 'Trainees see the full breakdown' : 'Trainees see the score only'}
                </span>
                <Link href="/settings" className="font-medium underline decoration-bean-line underline-offset-2 transition-colors hover:text-bean-ink">
                  Change in Settings
                </Link>
              </div>
            )}

            {/* The QA breakdown, mark by mark. Present only on a call scored by
                the Fronter scorecard; a legacy evaluation falls through to the
                five category boxes below. */}
            {scorecard && <FronterScorecard scorecard={scorecard} />}

            {/* Evaluation */}
            {call?.evaluation && (
              <div className="bean-card mb-6 rounded-[18px] border p-6">
                <h2 className="mb-4 text-[17px] font-bold tracking-[-0.01em] text-bean-ink">Evaluation</h2>
                {/* The five rolled-up categories. Redundant beside the scorecard
                    above, which shows the same marks with their evidence, so
                    they render only for an evaluation that has no scorecard. */}
                {!scorecard && (
                <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
                  {[
                    { label: 'Opening', score: call.evaluation.openingScore },
                    { label: 'Communication', score: call.evaluation.communicationScore },
                    { label: 'Objections', score: call.evaluation.objectionScore },
                    { label: 'Knowledge', score: call.evaluation.knowledgeScore },
                    { label: 'Closing', score: call.evaluation.closingScore },
                  ].map((item) => (
                    <div key={item.label} className="rounded-[14px] border border-bean-line bg-bean-card2 px-3 py-4 text-center">
                      <div className={`text-[22px] font-bold ${scoreColor(item.score)}`}>{item.score}%</div>
                      <div className="mt-1 text-[12px] font-medium text-bean-muted">{item.label}</div>
                    </div>
                  ))}
                </div>
                )}
                <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                  <div className="rounded-[14px] border border-bean-brand/25 bg-bean-brand/[0.05] p-4">
                    <h3 className="mb-2 text-[13px] font-bold text-bean-brand">Strengths</h3>
                    <ul className="space-y-1.5">
                      {call.evaluation.strengths?.map((s: string, i: number) => (
                        <li key={i} className="text-[13px] leading-relaxed text-bean-ink">+ {s}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-[14px] border border-bean-live/25 bg-bean-live/[0.05] p-4">
                    <h3 className="mb-2 text-[13px] font-bold text-bean-live">Weaknesses</h3>
                    <ul className="space-y-1.5">
                      {call.evaluation.weaknesses?.map((w: string, i: number) => (
                        <li key={i} className="text-[13px] leading-relaxed text-bean-ink">- {w}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-[14px] border border-bean-gold/30 bg-bean-gold/[0.06] p-4">
                    <h3 className="mb-2 text-[13px] font-bold text-bean-gold">Suggestions</h3>
                    <ul className="space-y-1.5">
                      {call.evaluation.suggestions?.map((s: string, i: number) => (
                        <li key={i} className="text-[13px] leading-relaxed text-bean-ink">&bull; {s}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                {call.evaluation.summary && (
                  <p className="mt-5 border-t border-bean-line pt-4 text-[13.5px] leading-relaxed text-bean-muted">
                    {call.evaluation.summary}
                  </p>
                )}
              </div>
            )}

            {/* Voice delivery — scored from the agent's own audio channel.
                Renders its own "not measured" notice when the recording was
                unavailable, so a gap is never mistaken for a zero. */}
            {call?.evaluation && (
              <VoiceDeliveryPanel
                voice={scorecard?.voice ?? null}
                section={audioKpisAsSection(scorecard?.score?.sections)}
                accentClassification={accentClassification}
              />
            )}

            {/* What a top performer would have said, against what was said.
                Generated with the score and never shown to the trainee while
                the breakdown is closed. */}
            {(call?.evaluation?.modelResponses ?? []).length > 0 && (
              <div className="bean-card mb-6 rounded-[18px] border p-6">
                <h2 className="mb-1 text-[17px] font-bold tracking-[-0.01em] text-bean-ink">Model answers</h2>
                <p className="mb-4 text-[12.5px] text-bean-muted">
                  Written against specific moments in this call, for the coaching conversation.
                </p>
                <div className="space-y-4">
                  {call.evaluation.modelResponses.map((response: any) => (
                    <div key={response.id} className="rounded-[14px] border border-bean-line p-4">
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-bean-faint">
                        {String(response.category ?? '').replaceAll('_', ' ')}
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="rounded-[12px] border border-bean-live/25 bg-bean-live/[0.05] p-3">
                          <div className="mb-1 text-[11.5px] font-bold text-bean-live">Agent said</div>
                          <p className="text-[13px] leading-relaxed text-bean-ink">{response.agentSaid}</p>
                        </div>
                        <div className="rounded-[12px] border border-bean-brand/25 bg-bean-brand/[0.05] p-3">
                          <div className="mb-1 text-[11.5px] font-bold text-bean-brand">A top performer would say</div>
                          <p className="text-[13px] leading-relaxed text-bean-ink">{response.idealResponse}</p>
                        </div>
                      </div>
                      {response.explanation && (
                        <p className="mt-2 text-[12.5px] italic leading-relaxed text-bean-muted">{response.explanation}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* The coaching the trainee was given DURING the call — useful to a
                supervisor as a record of what they were already told. */}
            {(call?.coachingTips ?? []).length > 0 && (
              <div className="bean-card mb-6 rounded-[18px] border p-6">
                <h2 className="mb-1 text-[17px] font-bold tracking-[-0.01em] text-bean-ink">Live coaching given</h2>
                <p className="mb-4 text-[12.5px] text-bean-muted">
                  Prompts shown to the agent while the call was running.
                </p>
                <div className="space-y-2">
                  {call.coachingTips.map((tip: any) => (
                    <div key={tip.id} className="flex items-start gap-3 rounded-[12px] border border-bean-line bg-bean-card2 px-3.5 py-2.5">
                      <span className="admin-pill shrink-0 border-bean-line bg-white text-bean-muted">
                        turn {tip.turnNumber}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-bean-faint">
                          {String(tip.tipType ?? '').replaceAll('_', ' ')}
                          {tip.priority ? ` · ${tip.priority}` : ''}
                        </div>
                        <p className="text-[13px] leading-relaxed text-bean-ink">{tip.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Transcript */}
            <div className="bean-card rounded-[18px] border p-6">
              <h2 className="mb-4 text-[17px] font-bold tracking-[-0.01em] text-bean-ink">Full Transcript</h2>
              <div className="max-h-[500px] space-y-2.5 overflow-y-auto pr-1">
                {call?.messages?.map((msg: any, i: number) => {
                  const annotations = annotationsByMessage.get(i) ?? [];
                  return (
                  <div key={i} className={`flex flex-col ${msg.role === 'AGENT' ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                        msg.role === 'AGENT'
                          ? 'rounded-br-md bg-gradient-to-r from-bean-brand to-bean-brand-bright text-white'
                          : 'rounded-bl-md border border-bean-line bg-bean-card2 text-bean-ink'
                      }`}
                    >
                      <p className={`mb-1 text-[11px] font-semibold uppercase tracking-wide ${msg.role === 'AGENT' ? 'opacity-75' : 'text-bean-faint'}`}>
                        {msg.role === 'AGENT' ? 'Agent' : 'Customer'}
                      </p>
                      <MessageText msg={msg} />
                    </div>
                    {/* The evaluator's marks against this exact line. */}
                    {annotations.map((annotation: any) => (
                      <div
                        key={annotation.id}
                        className={`mt-1.5 max-w-[75%] rounded-[12px] border px-3 py-2 ${ANNOTATION_TONES[annotation.annotationType] ?? 'border-bean-line bg-bean-card2'}`}
                      >
                        <div className="text-[11.5px] font-bold text-bean-ink">{annotation.label}</div>
                        <p className="mt-0.5 text-[12.5px] leading-relaxed text-bean-muted">{annotation.explanation}</p>
                      </div>
                    ))}
                  </div>
                  );
                })}
                {(!call?.messages || call.messages.length === 0) && (
                  <p className="py-8 text-center text-[13.5px] text-bean-muted">No messages</p>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/* ── controls ───────────────────────────────────────────────── */

function Chip({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={`admin-pill ${className}`}>
      {children}
    </span>
  );
}

/**
 * A customer line the trainee talked over.
 *
 * `content` holds only the whole sentences the trainee actually heard — it is
 * what memory, scoring evidence and consent are built from, so it is never
 * edited for display. When the trainee cut in mid-sentence the backend also
 * records `metadata.displayText`: those heard sentences, an estimate of how far
 * into the next one she got, and "—". The estimated part is shown lighter so a
 * reviewer never mistakes it for a finished statement.
 *
 * Rows from before `displayText` existed still carry `metadata.audible: false`
 * with empty content; those show as cut off rather than as an empty bubble.
 */
const CUT_MARK = '—';

function MessageText({ msg }: { msg: any }) {
  const meta = msg?.metadata && typeof msg.metadata === 'object' ? msg.metadata : {};
  const heard: string = typeof msg?.content === 'string' ? msg.content : '';
  const failed = msg?.role === 'CUSTOMER' && ['tts_incomplete', 'playback_unresolved'].includes(meta.interruptionReason);
  const display: string | null = msg?.role === 'CUSTOMER' && typeof meta.displayText === 'string' ? meta.displayText : failed ? `${heard}…` : null;
  const unheard = msg?.role === 'CUSTOMER' && !display && !heard.trim() && meta.audible === false;

  if (!display && !unheard) {
    return <p className="text-[13.5px] leading-relaxed">{heard}</p>;
  }

  const tag = (
    <span className="ml-2 inline-block rounded-full border border-bean-line px-1.5 py-px align-middle text-[10px] font-semibold uppercase tracking-wide text-bean-faint">
      {failed ? 'Audio problem' : 'Interrupted'}
    </span>
  );

  if (unheard || display === CUT_MARK || display === '…') {
    return (
      <p className="text-[13.5px] italic leading-relaxed text-bean-muted">
        {failed ? 'Audio ended before any words could be confirmed' : 'Cut off before a word was heard'}{tag}
      </p>
    );
  }

  // Heard whole sentences as normal text; the estimated remainder lighter.
  const prefix = heard.trim() && display!.startsWith(heard.trim()) ? heard.trim() : '';
  const rest = display!.slice(prefix.length).trim();
  return (
    <p className="text-[13.5px] leading-relaxed" title={failed ? 'Audio delivery failed. The faded part is an estimate of what played.' : 'The trainee spoke over the customer here. The faded part is an estimate of what was heard before the cut.'}>
      {prefix}
      {prefix && rest ? ' ' : ''}
      <span className="text-bean-muted">{rest}</span>
      {tag}
    </p>
  );
}
