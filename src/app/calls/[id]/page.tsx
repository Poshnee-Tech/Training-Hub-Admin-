'use client';

import { useEffect, useState } from 'react';
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
    case 'MED_ALERT': return 'border-bean-live/35 bg-bean-live/10 text-bean-live';
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

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  useEffect(() => {
    if (!token || !params.id) return;
    admin.getCallDetail(token, params.id as string)
      .then((res) => setCall(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, params.id]);

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
        className="bean-scope relative ml-64 min-h-screen flex-1 bg-bean-bg p-8 font-body text-bean-ink antialiased"
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
                {call?.evaluation && (
                  <div className={`shrink-0 text-4xl font-extrabold ${scoreColor(call.evaluation.overallScore)}`}>
                    {call.evaluation.overallScore}%
                  </div>
                )}
              </div>
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
                      <p className="text-[13.5px] leading-relaxed">{msg.content}</p>
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
