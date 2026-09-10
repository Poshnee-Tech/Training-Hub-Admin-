'use client';

/**
 * Voice Delivery, for a supervisor reviewing one call.
 * ─────────────────────────────────────────────────────
 *
 * Reads `evaluation.rawResponse.fronterScorecard.voice` — the backend's
 * measurement of the AGENT'S OWN audio channel. Azure supplies pronunciation,
 * fluency and prosody; pace, pauses, fillers, talk/listen and interruptions
 * are computed from word timings. Nothing is scored here; the points arrive
 * already assigned.
 *
 * ── NOT AN ACCENT SCORE ───────────────────────────────────────────────────
 *
 * en-US is the reference sound inventory, not a judgement of the speaker. The
 * question this answers is whether a US customer would UNDERSTAND the agent —
 * clarity and intelligibility. Nothing here names a nationality, a native
 * language or an accent, and nothing should be added that does. A supervisor
 * acting on this is coaching diction, not origin.
 *
 * ── WHY "NOT ASSESSED" IS SPELLED OUT ─────────────────────────────────────
 *
 * The same reasoning the unscored-call notice on this page already uses: a
 * blank reads as "this agent scored nothing" when the truth is "this was
 * never measured". The 8 points leave the denominator in that case, so the
 * agent is not marked down — and a supervisor needs to see that stated rather
 * than infer it from a gap.
 */

interface WordIssue {
  word: string;
  wrongPercent: number;
  atMs: number;
  turnId: number | null;
  worstPhonemes: Array<{ ipa: string; description: string; accuracy: number }>;
  shouldSound: string;
}

interface SoundPattern {
  ipa: string;
  description: string;
  wordCount: number;
  examples: string[];
}

export interface VoiceAnalysis {
  applicable: boolean;
  reason: string | null;
  azure: { accuracy: number; fluency: number; prosody: number; pronunciation: number } | null;
  pace: { wordsPerMinute: number | null; speakingSeconds: number } | null;
  pauses: { longPauseCount: number } | null;
  /** `occurrences` names the words the backend counted — see fillerSummary. */
  fillers: { count: number; occurrences?: Array<{ word: string }> } | null;
  talkListen: { agentTalkRatio: number | null } | null;
  interruptions: { count: number } | null;
  behavior?: {
    applicable: boolean;
    findings: Array<{
      kind: string;
      startMs: number;
      endMs: number;
      turnId: number | null;
      confidence: 'medium' | 'high';
      signals: string[];
      coaching: string;
    }>;
  } | null;
  wordIssues: WordIssue[];
  soundPatterns: SoundPattern[];
}

interface ScoredSection {
  sectionId: string;
  title: string;
  score: number;
  maxScore: number;
  kpis: Array<{
    kpiId: string;
    subChecks: Array<{ subCheckId: string; score: number; maxScore: number; observed: unknown }>;
  }>;
}

const SUB_CHECK_LABELS: Record<string, string> = {
  pronunciation_clarity: 'Pronunciation',
  speech_fluency: 'Fluency',
  speech_prosody: 'Delivery',
  speech_pacing: 'Pacing',
  us_accent_match: 'US accent match',
  appropriate_voice_behavior: 'Voice behaviour',
};

const VALUE_LABELS: Record<string, string> = {
  clear: 'Clear',
  mostly_clear: 'Mostly clear',
  sometimes_unclear: 'Sometimes unclear',
  hard_to_follow: 'Hard to follow',
  smooth: 'Smooth',
  mostly_smooth: 'Mostly smooth',
  halting: 'Halting',
  natural: 'Natural',
  acceptable: 'Acceptable',
  flat: 'Flat',
  comfortable: 'Comfortable',
  too_fast: 'Too fast',
  too_slow: 'Too slow',
  // The US Accent Match bands. Scorecard v11 subdivided the old flat zero, so
  // every rung needs wording or the card prints the enum token itself.
  '85_100': '85–100%',
  '70_84_9': '70–84.9%',
  '50_69_9': '50–69.9%',
  '30_49_9': '30–49.9%',
  '20_29_9': '20–29.9%',
  '10_19_9': '10–19.9%',
  '5_9_9': '5–9.9%',
  below_5: 'Below 5%',
  below_30: 'Below 30%',
  'n/a': 'Not assessed',
};

/** Modulate's per-window accent labels, as stored on the evaluation. */
export interface AccentClassification {
  overallAccent?: string;
  accent?: string;
  usAccentMatch?: number | null;
  accentBreakdown?: Record<string, number> | null;
  time_series?: Array<{ start_ms: number; duration_ms: number; accent: string }>;
}

/**
 * The accent measurement, as coaching context.
 *
 * US Accent Match is the share of fifteen-second windows Modulate labelled
 * American, and only that share carries points. The overall label and the
 * breakdown are shown because a supervisor asking "why is this zero" needs to
 * see that the model labelled every window something else, rather than
 * guessing at a bug.
 */
function AccentAnalysis({ analysis }: { analysis: AccentClassification | null | undefined }) {
  const overallAccent = analysis?.overallAccent ?? analysis?.accent;
  if (!overallAccent) return null;
  const windows = analysis?.time_series?.length ?? 0;
  const match = typeof analysis?.usAccentMatch === 'number' ? `${analysis.usAccentMatch.toFixed(1)}%` : 'Not assessed';
  const breakdown = analysis?.accentBreakdown ? Object.entries(analysis.accentBreakdown) : [];

  return (
    <div className="mt-5 border-t border-bean-line pt-4">
      <h3 className="text-[13.5px] font-bold text-bean-ink">Accent analysis</h3>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-[12px] border border-bean-line bg-bean-card2 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bean-faint">Overall accent</div>
          <div className="text-[14px] font-bold text-bean-ink">{overallAccent.replaceAll('_', ' ')}</div>
        </div>
        <div className="rounded-[12px] border border-bean-line bg-bean-card2 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bean-faint">Target accent</div>
          <div className="text-[14px] font-bold text-bean-ink">American</div>
        </div>
        <div className="rounded-[12px] border border-bean-line bg-bean-card2 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-bean-faint">US accent match</div>
          <div className="text-[14px] font-bold text-bean-ink">{match}</div>
          <div className="text-[11.5px] text-bean-muted">
            {windows > 0 ? `of ${windows} measured window${windows === 1 ? '' : 's'}` : 'no measured windows'}
          </div>
        </div>
      </div>
      {breakdown.length > 0 && (
        <p className="mt-2 text-[12px] text-bean-muted">
          Window breakdown:{' '}
          {breakdown.map(([label, percent]) => `${label.replaceAll('_', ' ')} ${percent.toFixed(1)}%`).join(' · ')}
        </p>
      )}
    </div>
  );
}

/**
 * The fillers actually counted, most frequent first — "yeah x4 · actually x2".
 *
 * The count alone invites "which words?", and a metric a reader cannot check
 * is one they stop believing. Ordinary words are only counted in filler
 * POSITIONS (see computeFillers on the backend), so naming them is what makes
 * the number auditable rather than assertive.
 */
function fillerSummary(fillers: { occurrences?: Array<{ word: string }> } | null | undefined): string | null {
  const occurrences = fillers?.occurrences ?? [];
  if (occurrences.length === 0) return null;
  const counts = new Map<string, number>();
  for (const item of occurrences) counts.set(item.word, (counts.get(item.word) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([word, n]) => (n > 1 ? `${word} \u00d7${n}` : word))
    .join(' \u00b7 ');
}

function timestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function tone(score: number, maxScore: number): string {
  if (maxScore <= 0) return 'text-bean-muted';
  const ratio = score / maxScore;
  if (ratio >= 0.8) return 'text-bean-brand';
  if (ratio >= 0.5) return 'text-bean-gold';
  return 'text-bean-live';
}

export function VoiceDeliveryPanel({
  voice,
  section,
  accentClassification,
}: {
  voice: VoiceAnalysis | null | undefined;
  section: ScoredSection | null | undefined;
  accentClassification?: AccentClassification | null;
}) {
  // An evaluation from before this feature carries neither; render nothing
  // rather than an empty card claiming something was measured.
  if (!voice && !section && !accentClassification) return null;

  if (!voice?.applicable || !voice?.azure) {
    return (
      <div className="bean-card mb-6 rounded-[18px] border p-6">
        <h2 className="mb-2 text-[17px] font-bold tracking-[-0.01em] text-bean-ink">Voice Delivery</h2>
        <p className="text-[13px] leading-relaxed text-bean-muted">
          Not measured for this call, so its 8 points were removed from the total rather than
          scored as zero &mdash; the agent was not marked down. This happens when no recording was
          available, the audio could not be read, or the agent spoke too briefly to assess.
        </p>
        {/* Accent comes from a DIFFERENT provider than the clarity measures, so
            it can be present on a call whose Azure assessment failed. Hiding it
            here would lose it exactly when a supervisor is asking why. */}
        <AccentAnalysis analysis={accentClassification} />
      </div>
    );
  }

  const azure = voice.azure;
  const subChecks = (section?.kpis ?? []).flatMap((kpi) => kpi.subChecks);
  const words = voice.wordIssues ?? [];
  const patterns = voice.soundPatterns ?? [];
  const talkRatio = voice.talkListen?.agentTalkRatio;
  const behaviorFindings = voice.behavior?.findings ?? [];

  return (
    <div className="bean-card mb-6 rounded-[18px] border p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[17px] font-bold tracking-[-0.01em] text-bean-ink">Voice Delivery</h2>
          <p className="mt-0.5 text-[12px] text-bean-muted">
            Measured from the agent&rsquo;s channel only &mdash; clarity and intelligibility, not accent.
          </p>
        </div>
        {section && section.maxScore > 0 && (
          <div className={`shrink-0 text-[22px] font-bold ${tone(section.score, section.maxScore)}`}>
            {section.score}
            <span className="text-[13px] font-medium text-bean-muted"> / {section.maxScore}</span>
          </div>
        )}
      </div>

      {subChecks.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {subChecks.map((check) => {
            // A boolean sub-check ("kept an appropriate voice") carries true or
            // false, not a token, and rendered as a dash it read as missing.
            const observed = typeof check.observed === 'string' ? check.observed
              : check.observed === true ? (check.maxScore > 0 && check.score >= check.maxScore ? 'No issues found' : 'Yes')
              : check.observed === false ? 'Needs attention'
              : '';
            return (
              <div
                key={check.subCheckId}
                className="rounded-[14px] border border-bean-line bg-bean-card2 px-3 py-4 text-center"
              >
                <div className={`text-[15px] font-bold ${tone(check.score, check.maxScore)}`}>
                  {VALUE_LABELS[observed] ?? (observed || '—')}
                </div>
                <div className="mt-1 text-[12px] font-medium text-bean-muted">
                  {SUB_CHECK_LABELS[check.subCheckId] ?? check.subCheckId.replaceAll('_', ' ')}
                </div>
                <div className="mt-0.5 text-[11px] text-bean-muted">
                  {check.maxScore > 0 ? `${check.score}/${check.maxScore} pts` : 'n/a'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Measured, unscored — context a supervisor needs when coaching. */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Rate', value: voice.pace?.wordsPerMinute ? `${voice.pace.wordsPerMinute} wpm` : '—' },
          { label: 'Long pauses', value: voice.pauses?.longPauseCount ?? '—' },
          { label: 'Fillers', value: voice.fillers?.count ?? '—', note: fillerSummary(voice.fillers) },
          { label: 'Agent talk', value: typeof talkRatio === 'number' ? `${Math.round(talkRatio * 100)}%` : '—' },
          { label: 'Talked over', value: voice.interruptions?.count ?? '—' },
        ].map((item) => (
          <div key={item.label} className="rounded-[14px] border border-bean-line bg-bean-card2 px-3 py-3 text-center">
            <div className="text-[15px] font-bold text-bean-ink">{item.value}</div>
            <div className="mt-0.5 text-[11px] font-medium text-bean-muted">{item.label}</div>
            {'note' in item && item.note && (
              <div className="mt-1 text-[10.5px] leading-tight text-bean-faint">{item.note}</div>
            )}
          </div>
        ))}
      </div>
      <p className="mb-5 text-[11px] text-bean-muted">
        Those five carry no points. Raw speech scores out of 100 &mdash; pronunciation {azure.pronunciation},
        fluency {azure.fluency}, prosody {azure.prosody}.
      </p>

      {behaviorFindings.length > 0 && (
        <div className="mb-5 rounded-[14px] border border-bean-gold/35 bg-bean-gold/[0.08] p-3">
          <h3 className="text-[13px] font-bold text-bean-ink">Voice behavior evidence</h3>
          <p className="mt-0.5 text-[11px] text-bean-muted">Sustained measurements from the agent channel; not transcript or intent guesses.</p>
          <div className="mt-2 space-y-2">
            {behaviorFindings.map((finding, index) => (
              <div key={`${finding.kind}-${finding.startMs}-${index}`} className="rounded-[10px] border border-bean-line bg-bean-card px-3 py-2 text-[12px]">
                <div className="flex flex-wrap justify-between gap-2 font-semibold text-bean-ink">
                  <span>{finding.kind.replaceAll('_', ' ')}</span>
                  <span className="font-normal text-bean-muted">{timestamp(finding.startMs)}–{timestamp(finding.endMs)} · {finding.confidence}</span>
                </div>
                <p className="mt-1 text-bean-muted">{finding.coaching}</p>
                {finding.signals.length > 0 && <p className="mt-1 text-[11px] text-bean-faint">{finding.signals.join(' ')}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {words.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-[13px] font-bold text-bean-ink">Words to coach</h3>
          <div className="space-y-2">
            {words.slice(0, 8).map((issue, index) => (
              <div
                key={`${issue.word}-${issue.atMs}-${index}`}
                className="rounded-[14px] border border-bean-line px-3 py-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-semibold text-bean-ink">&ldquo;{issue.word}&rdquo;</span>
                  <span className="shrink-0 text-[11px] text-bean-muted">
                    {issue.wrongPercent}% off
                    {issue.turnId !== null && <> &middot; turn {issue.turnId}</>}
                    {' '}&middot; {timestamp(issue.atMs)}
                  </span>
                </div>
                {issue.worstPhonemes.length > 0 && (
                  <p className="mt-1 text-[12px] text-bean-muted">
                    Weak sound: {issue.worstPhonemes[0].description}
                    {issue.shouldSound && <> &middot; should sound like <span className="font-mono">{issue.shouldSound}</span></>}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {patterns.length > 0 && (
        <div>
          <h3 className="mb-1 text-[13px] font-bold text-bean-ink">Recurring sounds</h3>
          <p className="mb-2 text-[11px] text-bean-muted">
            One sound weak across several words is a single lesson, not several faults.
          </p>
          <div className="space-y-1.5">
            {patterns.map((pattern) => (
              <div key={pattern.ipa} className="rounded-[14px] bg-bean-card2 px-3 py-2 text-[12px]">
                <span className="font-semibold text-bean-ink">{pattern.description}</span>
                <span className="text-bean-muted">
                  {' '}&mdash; {pattern.wordCount} words: {pattern.examples.join(', ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The accent measurement, beneath the pronunciation detail it is
          most often confused with: clarity is how well the words land,
          accent match is which accent the model heard. */}
      <AccentAnalysis analysis={accentClassification} />
    </div>
  );
}
