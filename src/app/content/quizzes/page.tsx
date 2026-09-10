'use client';

/**
 * Quiz administration — settings, question builder, and marking.
 *
 * The question bank used to be editable only as raw JSON, which assumed the
 * person maintaining a quiz could hand-write it. They can't be assumed to, so
 * the builder here is the primary way in: type or paste a question, type or
 * paste its options, save. Edit and delete work per question, and nothing
 * touches the other questions in the paper.
 *
 * The JSON editor is still here, one click away under "Import JSON", because
 * pasting a prepared 70-question bank in one go is a real workflow — it is just
 * no longer the only one.
 *
 * PASTING. `parsePastedOptions` takes whatever shape an option list arrives in
 * — "A) Bronze", "1. Bronze", "- Bronze", or one per line — and turns it into
 * option rows. A paper being transcribed from a document is the common case,
 * and retyping four options per question is the thing this page exists to
 * avoid.
 */

import { useCallback, useEffect, useState } from 'react';
import AdminSidebar from '@/components/layout/AdminSidebar';
import { useAuthStore } from '@/store/auth.store';
import { contentApi } from '@/lib/api';

type Kind = 'MULTIPLE_CHOICE' | 'WRITTEN';

type OptionDraft = { text: string; isCorrect: boolean };

type QuestionDraft = {
  kind: Kind;
  prompt: string;
  explanation: string;
  points: number;
  minLines: number | '';
  maxLines: number | '';
  options: OptionDraft[];
  scenarioTag: string;
  scenarioTitle: string;
  scenarioNarrative: string;
  heading: string;
};

const SAMPLE = `[
  {
    "kind": "MULTIPLE_CHOICE",
    "prompt": "Which metal tier has the lowest monthly premium?",
    "explanation": "Bronze plans trade a low premium for higher out-of-pocket costs.",
    "heading": "Medicare MCQs",
    "options": [
      { "text": "Bronze", "isCorrect": true },
      { "text": "Silver", "isCorrect": false },
      { "text": "Gold", "isCorrect": false }
    ]
  },
  {
    "kind": "WRITTEN",
    "prompt": "List the mistakes the agent made on this call.",
    "explanation": "Model answer: unconfirmed provider, unconfirmed age, invalid ZIP...",
    "heading": "87 questions",
    "points": 6,
    "minLines": 5,
    "maxLines": 7
  }
]`;

function emptyDraft(kind: Kind): QuestionDraft {
  return {
    kind,
    prompt: '',
    explanation: '',
    points: kind === 'WRITTEN' ? 5 : 1,
    minLines: kind === 'WRITTEN' ? 5 : '',
    maxLines: kind === 'WRITTEN' ? 7 : '',
    options: kind === 'WRITTEN' ? [] : [
      { text: '', isCorrect: true },
      { text: '', isCorrect: false },
      { text: '', isCorrect: false },
      { text: '', isCorrect: false },
    ],
    scenarioTag: '',
    scenarioTitle: '',
    scenarioNarrative: '',
    heading: '',
  };
}

function draftFrom(question: any): QuestionDraft {
  return {
    kind: question.kind ?? 'MULTIPLE_CHOICE',
    prompt: question.prompt ?? '',
    explanation: question.explanation ?? '',
    points: question.points ?? 1,
    minLines: question.minLines ?? '',
    maxLines: question.maxLines ?? '',
    options: (question.options ?? []).map((o: any) => ({ text: o.text, isCorrect: o.isCorrect })),
    scenarioTag: question.scenarioTag ?? '',
    scenarioTitle: question.scenarioTitle ?? '',
    scenarioNarrative: question.scenarioNarrative ?? '',
    heading: question.heading ?? '',
  };
}

/**
 * Turn pasted text into option rows.
 *
 * Strips the label an option was written with — "A)", "B.", "3)", "-", "•" —
 * because that label is positional: it means nothing once the option is a row
 * that can be reordered, and leaving it in would print "A) A) Bronze" on the
 * paper. Blank lines are dropped so a double-spaced paste still works.
 */
function parsePastedOptions(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[A-Ha-h][).:]|\d{1,2}[).:]|[-•*])\s*/, '').trim())
    .filter(Boolean);
}

/** Non-empty lines, which is what a "write 5 lines" instruction actually counts. */
function countLines(text: string): number {
  return text.split('\n').filter((l) => l.trim().length > 0).length;
}

export default function QuizzesAdminPage() {
  const { token, loadFromStorage } = useAuthStore();
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  // The quiz whose questions are open in the builder, with its questions.
  const [builder, setBuilder] = useState<{ id: string; title: string; questions: any[] } | null>(null);
  const [editingBank, setEditingBank] = useState<{ id: string; title: string; json: string; originalJson: string } | null>(null);
  const [savingBank, setSavingBank] = useState(false);

  // Marking queue.
  const [pending, setPending] = useState<any[]>([]);
  const [marking, setMarking] = useState<any | null>(null);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [quizRes, pendingRes] = await Promise.all([
        contentApi.listQuizzes(token),
        contentApi.listPendingMarking(token),
      ]);
      setQuizzes(quizRes.data);
      setPending(pendingRes.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function saveSettings(quiz: any, patch: Record<string, unknown>) {
    if (!token) return;
    try {
      await contentApi.updateQuiz(token, quiz.id, patch);
      setNotice(`Updated ${quiz.title}.`);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function openBuilder(quiz: any) {
    if (!token) return;
    try {
      const res = await contentApi.getQuiz(token, quiz.id);
      setBuilder({ id: quiz.id, title: quiz.title, questions: res.data.questions });
      setEditingBank(null);
      setMarking(null);
    } catch (err: any) {
      setError(err.message);
    }
  }

  /** Re-read the open quiz after any per-question write, so ordering and numbering stay true. */
  async function refreshBuilder() {
    if (!token || !builder) return;
    const res = await contentApi.getQuiz(token, builder.id);
    setBuilder((b) => b && { ...b, questions: res.data.questions });
    load();
  }

  async function openBank(quiz: any) {
    if (!token) return;
    try {
      const res = await contentApi.getQuiz(token, quiz.id);
      const questions = res.data.questions.map((q: any) => ({
        kind: q.kind,
        prompt: q.prompt,
        explanation: q.explanation ?? undefined,
        points: q.points,
        ...(q.scenarioTag ? { scenarioTag: q.scenarioTag } : {}),
        ...(q.scenarioTitle ? { scenarioTitle: q.scenarioTitle } : {}),
        ...(q.scenarioNarrative ? { scenarioNarrative: q.scenarioNarrative } : {}),
        ...(q.heading ? { heading: q.heading } : {}),
        ...(q.kind === 'WRITTEN'
          ? { minLines: q.minLines ?? undefined, maxLines: q.maxLines ?? undefined }
          : { options: q.options.map((o: any) => ({ text: o.text, isCorrect: o.isCorrect })) }),
      }));
      const json = questions.length > 0 ? JSON.stringify(questions, null, 2) : SAMPLE;
      setEditingBank({
        id: quiz.id,
        title: quiz.title,
        json,
        originalJson: json,
      });
      setBuilder(null);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function saveBank(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !editingBank) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(editingBank.json);
    } catch (err: any) {
      setError(`That isn't valid JSON: ${err.message}`);
      return;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      setError('The question bank must be a non-empty JSON array.');
      return;
    }

    setSavingBank(true);
    setError('');
    try {
      await contentApi.replaceQuestions(token, editingBank.id, parsed as any[]);
      setEditingBank(null);
      setNotice('Question bank replaced.');
      load();
    } catch (err: any) {
      // The server names the offending question — surface it verbatim.
      setError(err.message);
    } finally {
      setSavingBank(false);
    }
  }

  function closeBank() {
    if (!editingBank) return;
    const changed = editingBank.json !== editingBank.originalJson;
    if (changed && !confirm('Discard your unsaved JSON changes and return to the quiz library?')) return;
    setEditingBank(null);
  }

  async function openMarking(attempt: any) {
    if (!token) return;
    try {
      const res = await contentApi.getAttemptForMarking(token, attempt.id);
      setMarking(res.data);
      setBuilder(null);
      setEditingBank(null);
    } catch (err: any) {
      setError(err.message);
    }
  }

  /**
   * The Shuffle button — re-roll the paper and show what it picked.
   *
   * Works for every quiz: the multiple-choice questions and their options are
   * always reordered. Quizzes with a scenario pool also re-roll which scenario
   * sets land on the paper — the notice only mentions scenarios when there are
   * any to mention.
   */
  async function shuffle(quiz: any, scenariosPerPaper: number) {
    if (!token) return;
    try {
      const res = await contentApi.shuffleQuiz(token, quiz.id, scenariosPerPaper);
      const picked = res.data.activeScenarioTags ?? [];
      setNotice(
        picked.length > 0
          ? `Paper shuffled — ${picked.length} scenario${picked.length === 1 ? '' : 's'} on the paper` +
              ` (${picked.join(', ')}), multiple-choice questions and options reordered.`
          : 'Paper shuffled — multiple-choice questions and options reordered.',
      );
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  // The quiz whose "Assign to agents" panel is open. An agent is "selected"
  // when this quiz is the paper they are currently handed at its stage.
  const [assigning, setAssigning] = useState<{
    quizId: string;
    title: string;
    stages: any[];
    agents: any[];
    saving: boolean;
  } | null>(null);

  async function openAssign(quiz: any) {
    if (!token) return;
    try {
      const res = await contentApi.listQuizAssignments(token, quiz.id);
      setAssigning({
        quizId: quiz.id,
        title: quiz.title,
        stages: res.data.stages,
        agents: res.data.agents.map((a: any) => ({
          ...a,
          // An agent has THIS quiz when it is the paper handed to them at every
          // quiz station they have been given a custom paper for.
          selected: (a.assigned ?? []).length > 0 && (a.assigned ?? []).every((x: any) => x.quizId === quiz.id),
        })),
        saving: false,
      });
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function saveAssign() {
    if (!token || !assigning) return;
    setAssigning({ ...assigning, saving: true });
    try {
      await contentApi.setQuizAssignments(
        token,
        assigning.quizId,
        assigning.agents.filter((a: any) => a.selected).map((a: any) => a.id),
      );
      setNotice(`Assignments saved — ${assigning.title} is now handed to the agents you selected.`);
      setAssigning(null);
      load();
    } catch (err: any) {
      setError(err.message);
      setAssigning((s) => s && ({ ...s, saving: false }));
    }
  }

  const publishedCount = quizzes.filter((q) => q.isPublished).length;
  const totalQuestions = quizzes.reduce((sum, q) => sum + (q._count?.questions ?? 0), 0);
  const totalAttempts = quizzes.reduce((sum, q) => sum + (q._count?.attempts ?? 0), 0);

  return (
    <div className="flex">
      <AdminSidebar />
      <main className="bean-scope relative ml-64 min-h-screen flex-1 bg-bean-bg px-6 py-7 font-body text-bean-ink antialiased lg:px-8">
        <div className="mx-auto w-full max-w-[1500px]">
          <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-bean-brand" />
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-bean-faint">Training content</span>
              </div>
              <h1 className="font-display text-[28px] font-extrabold tracking-[-0.035em] text-bean-ink">Quiz Management</h1>
              <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-bean-muted">
                Manage papers, pass rules, question banks, assignments, shuffling, and manual marking from one place.
              </p>
            </div>
            {pending.length > 0 && (
              <div className="rounded-2xl border border-bean-gold/30 bg-bean-gold/[0.08] px-4 py-3 text-right">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-bean-gold">Needs attention</p>
                <p className="mt-0.5 text-[14px] font-bold text-bean-ink">{pending.length} paper{pending.length === 1 ? '' : 's'} awaiting marking</p>
              </div>
            )}
          </header>

          {!marking && !builder && (
            <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <DashboardMetric label="Total quizzes" value={quizzes.length} helper="Configured papers" />
              <DashboardMetric label="Published" value={publishedCount} helper={`${quizzes.length - publishedCount} draft${quizzes.length - publishedCount === 1 ? '' : 's'}`} />
              <DashboardMetric label="Questions" value={totalQuestions} helper="Across all quizzes" />
              <DashboardMetric label="Attempts" value={totalAttempts} helper="Recorded submissions" />
            </section>
          )}

          {notice && (
            <div className="mb-4 flex items-start justify-between gap-4 rounded-2xl border border-bean-brand/30 bg-bean-brand/[0.08] px-4 py-3.5 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bean-brand/15 text-[12px] font-bold text-bean-brand">✓</span>
                <p className="text-[13.5px] font-medium leading-relaxed text-bean-ink">{notice}</p>
              </div>
              <button onClick={() => setNotice('')} className="shrink-0 text-[12.5px] font-semibold text-bean-brand hover:text-bean-brand-bright">Dismiss</button>
            </div>
          )}

          {error && (
            <div className="mb-4 flex items-start justify-between gap-4 rounded-2xl border border-bean-live/40 bg-bean-live/10 px-4 py-3.5 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bean-live/15 text-[12px] font-bold text-bean-live">!</span>
                <p className="text-[13.5px] font-medium leading-relaxed text-bean-live">{error}</p>
              </div>
              <button onClick={() => setError('')} className="shrink-0 text-[12.5px] font-semibold text-bean-live">Dismiss</button>
            </div>
          )}

          {marking ? (
            <MarkingPanel
              attempt={marking}
              onClose={() => { setMarking(null); load(); }}
              onSaved={(message) => { setNotice(message); load(); }}
              onError={setError}
            />
          ) : builder ? (
            <QuestionBuilder
              quiz={builder}
              onClose={() => setBuilder(null)}
              onChanged={refreshBuilder}
              onError={setError}
              onNotice={setNotice}
            />
          ) : (
            <>
              {editingBank && (
                <form onSubmit={saveBank} className="bean-card mb-6 overflow-hidden rounded-[20px] border">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-bean-line bg-bean-card2/60 px-6 py-5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[17px] font-bold tracking-[-0.01em] text-bean-ink">Import question bank</h2>
                        <span className="rounded-full border border-bean-line bg-bean-card px-2.5 py-0.5 text-[11px] font-semibold text-bean-muted">{editingBank.title}</span>
                      </div>
                      <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-bean-muted">
                        Advanced bulk workflow. Saving here replaces every question in this quiz, while historical attempt scores remain intact.
                      </p>
                    </div>
                    <Btn type="button" onClick={closeBank}>← Back to Quiz Library</Btn>
                  </div>

                  <div className="grid gap-5 p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div>
                      <Label>Question bank JSON</Label>
                      <textarea
                        rows={22}
                        className={`${FIELD} mt-1 font-mono text-[12px] leading-relaxed`}
                        value={editingBank.json}
                        onChange={(e) => setEditingBank((state) => state && ({ ...state, json: e.target.value }))}
                        spellCheck={false}
                      />
                    </div>
                    <aside className="rounded-2xl border border-bean-line bg-bean-card2/60 p-4">
                      <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-bean-faint">Before replacing</p>
                      <div className="mt-3 space-y-3 text-[12.5px] leading-relaxed text-bean-muted">
                        <p><strong className="font-semibold text-bean-ink">Multiple choice:</strong> exactly one option must have <code className="rounded bg-bean-card px-1 py-0.5 text-[11px]">isCorrect: true</code>.</p>
                        <p><strong className="font-semibold text-bean-ink">Written:</strong> use <code className="rounded bg-bean-card px-1 py-0.5 text-[11px]">kind: WRITTEN</code> with optional min/max lines.</p>
                        <p><strong className="font-semibold text-bean-ink">Safer edits:</strong> use Edit questions when changing only one or two questions.</p>
                      </div>
                      <div className="mt-5 rounded-xl border border-bean-live/25 bg-bean-live/[0.06] p-3 text-[12px] leading-relaxed text-bean-live">
                        This action replaces the entire current question bank.
                      </div>
                    </aside>
                  </div>

                  <div className="flex flex-wrap justify-end gap-3 border-t border-bean-line px-6 py-4">
                    <Btn type="button" onClick={closeBank}>Cancel and go back</Btn>
                    <Btn tone="solid" type="submit" disabled={savingBank}>{savingBank ? 'Replacing…' : 'Replace all questions'}</Btn>
                  </div>
                </form>
              )}

              {pending.length > 0 && (
                <section className="bean-card mb-6 overflow-hidden rounded-[20px] border border-bean-gold/25">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bean-line bg-bean-gold/[0.06] px-5 py-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="grid h-8 w-8 place-items-center rounded-xl bg-bean-gold/15 text-[14px] font-extrabold text-bean-gold">{pending.length}</span>
                        <div>
                          <h2 className="text-[15px] font-bold text-bean-ink">Marking queue</h2>
                          <p className="text-[12px] text-bean-muted">Written answers must be reviewed before these agents can continue.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
                    {pending.map((attempt) => (
                      <button
                        key={attempt.id}
                        type="button"
                        onClick={() => openMarking(attempt)}
                        className="group flex min-w-0 items-center gap-3 rounded-2xl border border-bean-line bg-bean-card px-4 py-3 text-left transition hover:-translate-y-px hover:border-bean-gold/45 hover:shadow-sm"
                      >
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-bean-line bg-bean-card2 text-[12px] font-bold text-bean-ink">
                          {attempt.agent.firstName?.[0]}{attempt.agent.lastName?.[0]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold text-bean-ink">{attempt.agent.firstName} {attempt.agent.lastName}</span>
                          <span className="mt-0.5 block truncate text-[11.5px] text-bean-muted">{attempt.quiz.title} · Attempt {attempt.attemptNumber}</span>
                          <span className="mt-0.5 block text-[11px] text-bean-faint">{attempt.unmarkedCount} answer{attempt.unmarkedCount === 1 ? '' : 's'} left</span>
                        </span>
                        <span className="shrink-0 text-[12px] font-bold text-bean-gold transition group-hover:translate-x-0.5">Mark →</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {loading ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {[0, 1, 2, 3].map((n) => <QuizCardSkeleton key={n} />)}
                </div>
              ) : quizzes.length === 0 ? (
                <div className="bean-card rounded-[20px] border px-6 py-16 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-bean-line bg-bean-card2 text-[20px]">?</div>
                  <p className="mt-4 text-[15px] font-semibold text-bean-ink">No quizzes yet</p>
                  <p className="mx-auto mt-1 max-w-lg text-[13px] leading-relaxed text-bean-muted">
                    Seed the training journey to create your initial ACA Quiz and Grand Test.
                  </p>
                  <code className="mt-3 inline-block rounded-lg border border-bean-line bg-bean-card2 px-2 py-1 text-[11px] text-bean-ink">npm run db:seed:journey</code>
                </div>
              ) : (
                <section>
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-[15px] font-bold tracking-[-0.01em] text-bean-ink">Quiz library</h2>
                      <p className="mt-0.5 text-[12.5px] text-bean-muted">Settings save when you leave each field.</p>
                    </div>
                    <p className="text-[12px] text-bean-faint">{quizzes.length} quiz{quizzes.length === 1 ? '' : 'zes'}</p>
                  </div>

                  <div className="grid items-stretch gap-4 xl:auto-rows-fr xl:grid-cols-2">
                    {quizzes.map((quiz) => {
                      const openAssignPanel = assigning?.quizId === quiz.id ? assigning : null;
                      return (
                        <article key={quiz.id} className="bean-card flex h-full min-h-[510px] flex-col overflow-hidden rounded-[20px] border transition duration-150 hover:border-bean-line2 hover:shadow-sm">
                          <div className="flex flex-1 flex-col p-5">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="truncate text-[16px] font-extrabold tracking-[-0.015em] text-bean-ink">{quiz.title}</h3>
                                  <StatusPill published={quiz.isPublished} />
                                  <span className="rounded-full border border-bean-line bg-bean-card2 px-2.5 py-0.5 text-[10.5px] font-semibold text-bean-muted">{quiz.scope}</span>
                                </div>
                                <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-bean-muted">{quiz.description}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => saveSettings(quiz, { isPublished: !quiz.isPublished })}
                                className={`relative h-6 w-11 shrink-0 rounded-full border transition ${quiz.isPublished ? 'border-bean-brand bg-bean-brand' : 'border-bean-line2 bg-bean-card2'}`}
                                aria-label={quiz.isPublished ? `Unpublish ${quiz.title}` : `Publish ${quiz.title}`}
                                title={quiz.isPublished ? 'Published — click to unpublish' : 'Draft — click to publish'}
                              >
                                <span className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-all ${quiz.isPublished ? 'left-[22px]' : 'left-0.5'}`} />
                              </button>
                            </div>

                            <div className="mt-4 grid grid-cols-3 gap-2">
                              <MiniMetric label="Questions" value={quiz._count.questions} />
                              <MiniMetric label="Attempts" value={quiz._count.attempts} />
                              <MiniMetric label="Stages" value={quiz.stages?.length ?? 0} />
                            </div>

                            <div className="mt-4 grid gap-3 rounded-2xl border border-bean-line bg-bean-card2/45 p-3 sm:grid-cols-2">
                              <div>
                                <Label htmlFor={`pass-mark-${quiz.id}`}>Pass mark</Label>
                                <div className="relative">
                                  <input
                                    id={`pass-mark-${quiz.id}`}
                                    type="number"
                                    min={0}
                                    max={100}
                                    defaultValue={quiz.passThresholdPct}
                                    onBlur={(e) => {
                                      const value = Number(e.target.value);
                                      if (value !== quiz.passThresholdPct) saveSettings(quiz, { passThresholdPct: value });
                                    }}
                                    className={`${FIELD} pr-9`}
                                  />
                                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-bean-faint">%</span>
                                </div>
                              </div>
                              <div>
                                <Label htmlFor={`attempts-${quiz.id}`}>Attempts allowed</Label>
                                <input
                                  id={`attempts-${quiz.id}`}
                                  type="number"
                                  min={1}
                                  max={50}
                                  defaultValue={quiz.maxAttempts}
                                  onBlur={(e) => {
                                    const value = Number(e.target.value);
                                    if (value !== quiz.maxAttempts) saveSettings(quiz, { maxAttempts: value });
                                  }}
                                  className={FIELD}
                                />
                              </div>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-bean-faint">
                              <span>Stage: <strong className="font-medium text-bean-muted">{quiz.stages?.map((s: any) => s.title).join(', ') || 'Not linked'}</strong></span>
                              {quiz.lastShuffledAt && <span>Last shuffled: <strong className="font-medium text-bean-muted">{new Date(quiz.lastShuffledAt).toLocaleString()}</strong></span>}
                            </div>

                            {/* Keep the lower setup zone identical on every card so rows stay visually aligned. */}
                            <div className="mt-auto pt-4">
                              {quiz.scenarioPoolCount > 0 ? (
                                <div className="flex min-h-[98px] items-center rounded-2xl border border-bean-gold/25 bg-bean-gold/[0.055] p-3.5">
                                  <div className="flex w-full flex-wrap items-center justify-between gap-3">
                                    <div>
                                      <p className="text-[12.5px] font-bold text-bean-ink">Mock-call scenario pool</p>
                                      <p className="mt-0.5 text-[11.5px] text-bean-muted">{quiz.scenarioPoolCount} scenario question{quiz.scenarioPoolCount === 1 ? '' : 's'} available</p>
                                    </div>
                                    <div className="flex items-end gap-2">
                                      <div>
                                        <Label htmlFor={`scenarios-per-paper-${quiz.id}`}>Per paper</Label>
                                        <input
                                          id={`scenarios-per-paper-${quiz.id}`}
                                          type="number"
                                          min={1}
                                          max={20}
                                          defaultValue={quiz.scenariosPerPaper}
                                          onBlur={(e) => {
                                            const value = Number(e.target.value);
                                            if (value !== quiz.scenariosPerPaper) saveSettings(quiz, { scenariosPerPaper: value });
                                          }}
                                          className={`${FIELD} w-20 py-2`}
                                        />
                                      </div>
                                      <Btn onClick={() => shuffle(quiz, quiz.scenariosPerPaper)} className="py-2">Shuffle now</Btn>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex min-h-[98px] items-center rounded-2xl border border-bean-line bg-bean-card2/45 p-3.5">
                                  <div>
                                    <p className="text-[12.5px] font-bold text-bean-ink">Standard question paper</p>
                                    <p className="mt-0.5 max-w-md text-[11.5px] leading-relaxed text-bean-muted">
                                      No mock-call scenario pool. Questions and answer choices can still be randomized with Shuffle paper.
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-bean-line bg-bean-card2/40 px-5 py-3.5">
                            <Btn tone="solid" onClick={() => openBuilder(quiz)}>Edit questions</Btn>
                            {quiz.stages?.length > 0 && <Btn onClick={() => openAssign(quiz)}>Assign agents</Btn>}
                            <Btn onClick={() => shuffle(quiz, quiz.scenariosPerPaper)}>Shuffle paper</Btn>
                            <Btn onClick={() => openBank(quiz)}>Import JSON</Btn>
                          </div>

                          {openAssignPanel && (
                            <div className="border-t border-bean-brand/20 bg-bean-brand/[0.04] p-5">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <h4 className="text-[14px] font-bold text-bean-ink">Assign agents</h4>
                                  <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-bean-muted">
                                    Selected agents receive this quiz at their quiz stations. Saving also rolls a fresh question and scenario order for them.
                                  </p>
                                </div>
                                <span className="rounded-full border border-bean-brand/25 bg-bean-brand/10 px-2.5 py-1 text-[11px] font-bold text-bean-brand">
                                  {openAssignPanel.agents.filter((a: any) => a.selected).length} selected
                                </span>
                              </div>

                              <div className="mt-4 max-h-64 space-y-2 overflow-y-auto pr-1">
                                {openAssignPanel.agents.length === 0 && <p className="py-4 text-center text-[12.5px] text-bean-faint">No active agents yet.</p>}
                                {openAssignPanel.agents.map((a: any) => (
                                  <label key={a.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition ${a.selected ? 'border-bean-brand/40 bg-bean-brand/[0.07]' : 'border-bean-line bg-bean-card hover:border-bean-line2'}`}>
                                    <input
                                      type="checkbox"
                                      checked={a.selected}
                                      onChange={() => setAssigning((state) => state && ({
                                        ...state,
                                        agents: state.agents.map((x: any) => x.id === a.id ? { ...x, selected: !x.selected } : x),
                                      }))}
                                      className="h-4 w-4 accent-bean-brand"
                                    />
                                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-bean-line bg-bean-card2 text-[10.5px] font-bold text-bean-ink">{a.firstName?.[0]}{a.lastName?.[0]}</span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-[12.5px] font-semibold text-bean-ink">{a.firstName} {a.lastName}</span>
                                      <span className="block truncate text-[11px] text-bean-faint">{a.email}</span>
                                    </span>
                                  </label>
                                ))}
                              </div>

                              <div className="mt-4 flex flex-wrap justify-end gap-2">
                                <Btn onClick={() => setAssigning(null)}>Cancel</Btn>
                                <Btn tone="solid" onClick={saveAssign} disabled={openAssignPanel.saving}>
                                  {openAssignPanel.saving ? 'Saving…' : `Save assignment${openAssignPanel.agents.filter((a: any) => a.selected).length === 1 ? '' : 's'}`}
                                </Btn>
                              </div>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// ── Question builder ─────────────────────────────────────────

function QuestionBuilder({
  quiz, onClose, onChanged, onError, onNotice,
}: {
  quiz: { id: string; title: string; questions: any[] };
  onClose: () => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const { token } = useAuthStore();
  // `adding` is the kind being added, or null; `editingId` is the question open
  // for edit. Only one form is ever open, so a half-typed question cannot be
  // lost by opening another.
  const [adding, setAdding] = useState<Kind | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'ALL' | Kind>('ALL');

  const formOpen = adding !== null || editingId !== null;
  const reorderLocked = query.trim().length > 0 || kindFilter !== 'ALL';

  function requestCloseBuilder() {
    if (busy) return;
    if (formOpen && !confirm('Discard the question you are editing and return to the quiz library?')) return;
    onClose();
  }

  function cancelQuestionForm() {
    if (busy) return;
    setAdding(null);
    setEditingId(null);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      if (formOpen) cancelQuestionForm();
      else requestCloseBuilder();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [formOpen, busy]);

  async function create(draft: QuestionDraft) {
    if (!token) return;
    setBusy(true);
    try {
      await contentApi.createQuestion(token, quiz.id, toBody(draft));
      setAdding(null);
      setQuery('');
      setKindFilter('ALL');
      onNotice('Question added.');
      await onChanged();
    } catch (err: any) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function update(questionId: string, draft: QuestionDraft) {
    if (!token) return;
    setBusy(true);
    try {
      await contentApi.updateQuestion(token, questionId, toBody(draft));
      setEditingId(null);
      onNotice('Question updated.');
      await onChanged();
    } catch (err: any) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(questionId: string) {
    if (!token) return;
    setBusy(true);
    try {
      await contentApi.deleteQuestion(token, questionId);
      setConfirmDelete(null);
      onNotice('Question deleted.');
      await onChanged();
    } catch (err: any) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /** Move one question up or down, sending the whole new order. */
  async function move(index: number, delta: number) {
    if (!token) return;
    const next = [...quiz.questions];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];

    setBusy(true);
    try {
      await contentApi.reorderQuestions(token, quiz.id, next.map((q) => q.id));
      await onChanged();
    } catch (err: any) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const mcqCount = quiz.questions.filter((q) => q.kind !== 'WRITTEN').length;
  const writtenCount = quiz.questions.length - mcqCount;
  const scenarioSets = new Set(quiz.questions.map((q) => q.scenarioTag).filter(Boolean)).size;
  const filteredQuestions = quiz.questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => {
      if (kindFilter !== 'ALL' && question.kind !== kindFilter) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [question.prompt, question.explanation, question.heading, question.scenarioTag, question.scenarioTitle]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });

  return (
    <div>
      <div className="bean-card mb-4 overflow-hidden rounded-[20px] border">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-bean-line px-5 py-[18px]">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={requestCloseBuilder}
                className="inline-flex items-center gap-1.5 rounded-xl border border-bean-line bg-bean-card px-3 py-1.5 text-[12px] font-semibold text-bean-muted transition hover:border-bean-line2 hover:text-bean-ink"
              >
                ← Back to Quiz Library
              </button>
              <span className="text-bean-faint">/</span>
              <span className="text-[12px] font-semibold text-bean-brand">Question manager</span>
            </div>
            <h2 className="text-[19px] font-extrabold tracking-[-0.02em] text-bean-ink">{quiz.title}</h2>
            <p className="mt-1 text-[12.5px] text-bean-muted">Build, review, search, and reorder the paper without leaving this screen.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn
              onClick={() => { setEditingId(null); setAdding('WRITTEN'); }}
              disabled={busy || formOpen}
            >
              + Written
            </Btn>
            <Btn
              tone="solid"
              onClick={() => { setEditingId(null); setAdding('MULTIPLE_CHOICE'); }}
              disabled={busy || formOpen}
            >
              + Multiple choice
            </Btn>
          </div>
        </div>

        <div className="grid grid-cols-3 divide-x divide-bean-line border-b border-bean-line bg-bean-card2/35">
          <BuilderMetric label="Multiple choice" value={mcqCount} />
          <BuilderMetric label="Written" value={writtenCount} />
          <BuilderMetric label="Scenario sets" value={scenarioSets} />
        </div>

        <div className="flex flex-wrap items-center gap-2.5 p-4">
          <div className="relative min-w-[220px] flex-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search questions, sections, or scenarios…"
              className={`${FIELD} pl-9`}
            />
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-bean-faint">⌕</span>
          </div>
          <div className="flex rounded-xl border border-bean-line bg-bean-card2 p-1">
            {(['ALL', 'MULTIPLE_CHOICE', 'WRITTEN'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setKindFilter(kind)}
                className={`rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition ${kindFilter === kind ? 'bg-bean-card text-bean-ink shadow-sm' : 'text-bean-muted hover:text-bean-ink'}`}
              >
                {kind === 'ALL' ? 'All' : kind === 'WRITTEN' ? 'Written' : 'MCQ'}
              </button>
            ))}
          </div>
          <span className="text-[11.5px] text-bean-faint">{filteredQuestions.length} shown</span>
        </div>

        {reorderLocked && (
          <div className="border-t border-bean-line bg-bean-brand/[0.04] px-4 py-2.5 text-[11.5px] text-bean-muted">
            <strong className="font-semibold text-bean-brand">Reordering paused:</strong>{' '}
            clear search and question-type filters before moving questions, so the visible order always matches the paper order.
          </div>
        )}

        {(writtenCount > 0 || scenarioSets > 0) && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-bean-line bg-bean-gold/[0.04] px-4 py-2.5 text-[11.5px] text-bean-muted">
            {writtenCount > 0 && <span><strong className="font-semibold text-bean-gold">Written answers:</strong> submissions wait for marking.</span>}
            {scenarioSets > 0 && <span><strong className="font-semibold text-bean-gold">Scenario pool:</strong> Shuffle decides which sets appear.</span>}
          </div>
        )}
      </div>

      <ol className="space-y-3">
        {filteredQuestions.map(({ question, index }) => {
          const isScenarioStart =
            question.scenarioTag && question.scenarioTag !== quiz.questions[index - 1]?.scenarioTag;
          return (
          <li key={question.id}>
            {isScenarioStart && (
              <div className="mb-3 rounded-[14px] border border-bean-gold/30 bg-bean-gold/[0.08] px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-bean-ink">
                    Mock call scenario: {question.scenarioTitle || question.scenarioTag}
                  </span>
                  <span className="rounded-[6px] border border-bean-gold/35 bg-bean-gold/12 px-[7px] py-[2px] text-[9px] font-bold uppercase tracking-[0.1em] text-bean-gold">
                    Tag: {question.scenarioTag}
                  </span>
                </div>
                {question.scenarioNarrative && (
                  <p className="mt-2 line-clamp-3 whitespace-pre-wrap rounded-[10px] border border-bean-line/60 bg-bean-card px-3 py-2 text-[13px] leading-relaxed text-bean-muted">
                    {question.scenarioNarrative}
                  </p>
                )}
              </div>
            )}
            <div className="bean-card rounded-[16px] border p-5">
            {editingId === question.id ? (
              <div>
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-bean-line pb-4">
                  <div>
                    <button
                      type="button"
                      onClick={cancelQuestionForm}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-bean-muted transition hover:text-bean-ink disabled:opacity-50"
                    >
                      ← Back to questions
                    </button>
                    <p className="mt-1.5 text-[13.5px] font-bold text-bean-ink">Editing question {index + 1}</p>
                  </div>
                  <span className="rounded-full border border-bean-brand/25 bg-bean-brand/10 px-2.5 py-1 text-[10.5px] font-bold text-bean-brand">Edit mode</span>
                </div>
                <QuestionForm
                  initial={draftFrom(question)}
                  busy={busy}
                  submitLabel="Save changes"
                  onCancel={cancelQuestionForm}
                  cancelLabel="Back to questions"
                  onSubmit={(draft) => update(question.id, draft)}
                />
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-bean-line bg-bean-card2 text-[12px] font-bold text-bean-muted">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                        question.kind === 'WRITTEN'
                          ? 'border-bean-gold/40 bg-bean-gold/12 text-bean-gold'
                          : 'border-bean-line bg-bean-card2 text-bean-muted'
                      }`}>
                        {question.kind === 'WRITTEN' ? 'Written' : 'Multiple choice'}
                      </span>
                      {question.scenarioTag && (
                        <span className="inline-flex items-center rounded-full border border-bean-gold/40 bg-bean-gold/12 px-2.5 py-0.5 text-[11px] font-semibold text-bean-gold">Scenario</span>
                      )}
                      {question.heading && (
                        <span className="inline-flex items-center rounded-full border border-bean-brand/35 bg-bean-brand/10 px-2.5 py-0.5 text-[11px] font-semibold text-bean-brand">Section: {question.heading}</span>
                      )}
                      <span className="text-[12px] text-bean-faint">
                        {question.points} point{question.points === 1 ? '' : 's'}
                        {question.kind === 'WRITTEN' && question.minLines
                          ? ` · ${question.minLines}${question.maxLines ? `–${question.maxLines}` : '+'} lines`
                          : ''}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[14px] font-medium leading-relaxed text-bean-ink">{question.prompt}</p>

                    {question.kind === 'WRITTEN' ? (
                      question.explanation && (
                        <p className="mt-2 rounded-[10px] border border-bean-line bg-bean-card2 px-3 py-2 text-[13px] text-bean-muted">
                          <span className="font-semibold text-bean-ink">Model answer: </span>
                          {question.explanation}
                        </p>
                      )
                    ) : (
                      <ul className="mt-2 space-y-1">
                        {question.options.map((option: any) => (
                          <li
                            key={option.id}
                            className={`flex items-start gap-2 text-[13.5px] ${
                              option.isCorrect ? 'font-semibold text-bean-brand' : 'text-bean-muted'
                            }`}
                          >
                            <span className="shrink-0">{option.isCorrect ? '✓' : '·'}</span>
                            {option.text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-center gap-1.5">
                    <div className="flex gap-1">
                      <IconBtn
                        label="Move up"
                        onClick={() => move(index, -1)}
                        disabled={busy || reorderLocked || index === 0}
                      >
                        <ArrowUpGlyph className="h-3.5 w-3.5" />
                      </IconBtn>
                      <IconBtn
                        label="Move down"
                        onClick={() => move(index, 1)}
                        disabled={busy || reorderLocked || index === quiz.questions.length - 1}
                      >
                        <ArrowDownGlyph className="h-3.5 w-3.5" />
                      </IconBtn>
                    </div>
                    <IconBtn
                      label="Edit this question"
                      onClick={() => { setAdding(null); setEditingId(question.id); }}
                      disabled={busy || formOpen}
                    >
                      <PencilGlyph className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn label="Delete this question" danger disabled={busy || formOpen} onClick={() => setConfirmDelete(question.id)}>
                      <TrashGlyph className="h-3.5 w-3.5" />
                    </IconBtn>
                  </div>
                </div>

                {confirmDelete === question.id && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-bean-live/35 bg-bean-live/10 px-4 py-3">
                    <p className="text-[13px] text-bean-live">
                      Delete this question? Agents who already answered it keep their recorded score.
                    </p>
                    <div className="flex gap-2">
                      <Btn onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 text-[12px]">
                        Keep it
                      </Btn>
                      <Btn danger onClick={() => remove(question.id)} disabled={busy} className="px-3 py-1.5 text-[12px]">
                        Delete
                      </Btn>
                    </div>
                  </div>
                )}
              </>
            )}
            </div>
          </li>
          );
        })}
        {filteredQuestions.length === 0 && (
          <li className="bean-card rounded-[18px] border px-5 py-12 text-center">
            <p className="text-[13.5px] font-semibold text-bean-ink">No questions match</p>
            <p className="mt-1 text-[12px] text-bean-muted">Try a different search or question type.</p>
          </li>
        )}
      </ol>

      {adding ? (
        <div className="bean-card mt-3 rounded-[16px] border p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-bean-line pb-4">
            <div>
              <button
                type="button"
                onClick={cancelQuestionForm}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-bean-muted transition hover:text-bean-ink disabled:opacity-50"
              >
                ← Back to questions
              </button>
              <p className="mt-1.5 text-[13.5px] font-bold text-bean-ink">New {adding === 'WRITTEN' ? 'written' : 'multiple-choice'} question</p>
            </div>
            <span className="rounded-full border border-bean-brand/25 bg-bean-brand/10 px-2.5 py-1 text-[10.5px] font-bold text-bean-brand">Add mode</span>
          </div>
          <QuestionForm
            initial={emptyDraft(adding)}
            busy={busy}
            submitLabel="Add question"
            onCancel={cancelQuestionForm}
            cancelLabel="Back to questions"
            onSubmit={create}
          />
        </div>
      ) : (
        <div className="bean-card mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-dashed p-4">
          <p className="text-[12.5px] text-bean-muted">Add another question to the end of this paper.</p>
          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => setAdding('WRITTEN')} disabled={busy || editingId !== null}>+ Written</Btn>
            <Btn tone="solid" onClick={() => setAdding('MULTIPLE_CHOICE')} disabled={busy || editingId !== null}>+ Multiple choice</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/** Draft → request body. Sends only the fields the question's kind actually uses. */
function toBody(draft: QuestionDraft) {
  const base = {
    kind: draft.kind,
    prompt: draft.prompt.trim(),
    explanation: draft.explanation.trim() || null,
    points: draft.points,
    scenarioTag: draft.scenarioTag.trim() || null,
    scenarioTitle: draft.scenarioTitle.trim() || null,
    scenarioNarrative: draft.scenarioNarrative.trim() || null,
    heading: draft.heading.trim() || null,
  };

  if (draft.kind === 'WRITTEN') {
    return {
      ...base,
      minLines: draft.minLines === '' ? null : Number(draft.minLines),
      maxLines: draft.maxLines === '' ? null : Number(draft.maxLines),
      options: [],
    };
  }

  return {
    ...base,
    minLines: null,
    maxLines: null,
    options: draft.options
      .map((o) => ({ text: o.text.trim(), isCorrect: o.isCorrect }))
      .filter((o) => o.text.length > 0),
  };
}

function QuestionForm({
  initial, busy, submitLabel, onCancel, onSubmit, cancelLabel = 'Cancel',
}: {
  initial: QuestionDraft;
  busy: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (draft: QuestionDraft) => void;
  cancelLabel?: string;
}) {
  const [draft, setDraft] = useState<QuestionDraft>(initial);
  const [bulk, setBulk] = useState('');
  const [localError, setLocalError] = useState('');

  const isWritten = draft.kind === 'WRITTEN';

  function set<K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setOption(index: number, patch: Partial<OptionDraft>) {
    setDraft((d) => ({
      ...d,
      options: d.options.map((o, i) => (i === index ? { ...o, ...patch } : o)),
    }));
  }

  /** Exactly one option is correct, so choosing one clears the rest. */
  function markCorrect(index: number) {
    setDraft((d) => ({
      ...d,
      options: d.options.map((o, i) => ({ ...o, isCorrect: i === index })),
    }));
  }

  function switchKind() {
    const nextKind: Kind = isWritten ? 'MULTIPLE_CHOICE' : 'WRITTEN';
    setDraft((current) => {
      const next = emptyDraft(nextKind);
      return {
        ...next,
        prompt: current.prompt,
        explanation: current.explanation,
        points: current.points,
        scenarioTag: current.scenarioTag,
        scenarioTitle: current.scenarioTitle,
        scenarioNarrative: current.scenarioNarrative,
        heading: current.heading,
      };
    });
    setLocalError('');
  }

  function removeOption(index: number) {
    setDraft((current) => {
      const removedWasCorrect = current.options[index]?.isCorrect;
      const options = current.options.filter((_, i) => i !== index);
      if (removedWasCorrect && options.length > 0 && !options.some((option) => option.isCorrect)) {
        options[0] = { ...options[0], isCorrect: true };
      }
      return { ...current, options };
    });
  }

  function applyBulk() {
    const texts = parsePastedOptions(bulk);
    if (texts.length < 2) {
      setLocalError('Paste at least two options, one per line.');
      return;
    }
    setLocalError('');
    setDraft((d) => ({
      ...d,
      // The first option is marked correct as a starting point — the admin then
      // clicks the real one. Leaving none selected would let a question be
      // saved with no answer, which the server rejects anyway.
      options: texts.slice(0, 8).map((text, i) => ({ text, isCorrect: i === 0 })),
    }));
    setBulk('');
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.prompt.trim()) {
      setLocalError('The question needs a prompt.');
      return;
    }
    if (!isWritten) {
      const filled = draft.options.filter((o) => o.text.trim());
      if (filled.length < 2) {
        setLocalError('A multiple-choice question needs at least two options.');
        return;
      }
      if (filled.filter((o) => o.isCorrect).length !== 1) {
        setLocalError('Mark exactly one option as the correct answer.');
        return;
      }
    }
    if (isWritten && draft.minLines !== '' && draft.maxLines !== '' && Number(draft.maxLines) < Number(draft.minLines)) {
      setLocalError('The maximum number of lines is below the minimum.');
      return;
    }
    setLocalError('');
    onSubmit(draft);
  }

  return (
    <form onSubmit={submit}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
          isWritten
            ? 'border-bean-gold/40 bg-bean-gold/12 text-bean-gold'
            : 'border-bean-line bg-bean-card2 text-bean-muted'
        }`}>
          {isWritten ? 'Written answer' : 'Multiple choice'}
        </span>
        <button
          type="button"
          onClick={switchKind}
          className="text-[12.5px] font-medium text-bean-brand hover:text-bean-brand-bright"
        >
          Switch to {isWritten ? 'multiple choice' : 'written answer'}
        </button>
      </div>

      <Label>Question</Label>
      <textarea
        rows={2}
        className={FIELD}
        value={draft.prompt}
        onChange={(e) => set('prompt', e.target.value)}
        placeholder="Paste or type the question…"
      />

      <Label className="mt-4">Section heading (optional)</Label>
      <input
        className={FIELD}
        value={draft.heading}
        onChange={(e) => set('heading', e.target.value)}
        placeholder="e.g. 87 questions — put it on every question of the block"
      />
      <Hint>
        Names the section this question starts on the paper, instead of the default title. A
        different heading starts a new section — spread the same heading across every question of
        the block.
      </Hint>

      <details className="mt-4 rounded-[12px] border border-bean-gold/25 bg-bean-gold/[0.05] px-4 py-3">
        <summary className="cursor-pointer text-[12.5px] font-semibold text-bean-gold">
          Mock call scenario {draft.scenarioTag ? `: ${draft.scenarioTag}` : '(optional)'}
        </summary>
        <p className="mt-2 text-[12.5px] leading-relaxed text-bean-muted">
          Questions sharing a <strong className="font-semibold text-bean-ink">scenario tag</strong> form one set in the scenario pool. The
          Shuffle button picks a few sets at random and appends them at the end of the paper; the
          title and the call script are shown to the agent above the set&apos;s questions.
        </p>
        <Label className="mt-3">Scenario tag</Label>
        <input
          className={FIELD}
          value={draft.scenarioTag}
          onChange={(e) => set('scenarioTag', e.target.value)}
          placeholder="e.g. scenario-1 — same tag on every question of the set"
        />
        <Label className="mt-3">Scenario title</Label>
        <input
          className={FIELD}
          value={draft.scenarioTitle}
          onChange={(e) => set('scenarioTitle', e.target.value)}
          placeholder="e.g. ACA Marketplace Customer — Ambetter + Age 62"
        />
        <Label className="mt-3">Call script (shown above the questions)</Label>
        <textarea
          rows={6}
          className={`${FIELD} leading-relaxed`}
          value={draft.scenarioNarrative}
          onChange={(e) => set('scenarioNarrative', e.target.value)}
          placeholder={'Agent: Hi, this is ___. How are you doing today?\nCX: …'}
        />
      </details>

      {isWritten ? (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label>Minimum lines</Label>
              <input
                type="number"
                min={1}
                max={100}
                className={FIELD}
                value={draft.minLines}
                onChange={(e) => set('minLines', e.target.value === '' ? '' : Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Maximum lines</Label>
              <input
                type="number"
                min={1}
                max={100}
                className={FIELD}
                value={draft.maxLines}
                onChange={(e) => set('maxLines', e.target.value === '' ? '' : Number(e.target.value))}
              />
              <Hint>Leave blank for no upper limit.</Hint>
            </div>
            <div>
              <Label>Points</Label>
              <input
                type="number"
                min={1}
                max={100}
                className={FIELD}
                value={draft.points}
                onChange={(e) => set('points', Number(e.target.value) || 1)}
              />
              <Hint>You award 0 to this many when marking.</Hint>
            </div>
          </div>

          <Label className="mt-4">
            Model answer (shown to whoever marks it, and to the agent afterwards)
          </Label>
          <textarea
            rows={4}
            className={FIELD}
            value={draft.explanation}
            onChange={(e) => set('explanation', e.target.value)}
            placeholder="What a full-marks answer should contain…"
          />
        </>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <Label>
              Options: click the circle to mark the correct one
            </Label>
            <input
              type="number"
              min={1}
              max={100}
              className={`${FIELD} w-24 py-1.5 text-[13px]`}
              value={draft.points}
              onChange={(e) => set('points', Number(e.target.value) || 1)}
              aria-label="Points"
            />
          </div>

          <div className="mt-2 space-y-2">
            {draft.options.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => markCorrect(index)}
                  aria-label={`Mark option ${index + 1} correct`}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold transition ${
                    option.isCorrect
                      ? 'border-bean-brand bg-bean-brand text-white'
                      : 'border-bean-line text-transparent hover:border-bean-faint'
                  }`}
                >
                  ✓
                </button>
                <input
                  className={`${FIELD} flex-1`}
                  value={option.text}
                  onChange={(e) => setOption(index, { text: e.target.value })}
                  placeholder={`Option ${String.fromCharCode(65 + index)}`}
                />
                <IconBtn
                  label={`Remove option ${index + 1}`}
                  onClick={() => removeOption(index)}
                >
                  <XGlyph className="h-3.5 w-3.5" />
                </IconBtn>
              </div>
            ))}
          </div>

          {draft.options.length < 8 && (
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, options: [...d.options, { text: '', isCorrect: false }] }))}
              className="mt-2 text-[12.5px] font-medium text-bean-brand hover:text-bean-brand-bright"
            >
              + Add another option
            </button>
          )}

          <details className="mt-4">
            <summary className="cursor-pointer text-[12.5px] font-medium text-bean-muted">
              Paste options from a document
            </summary>
            <Hint className="mt-2">
              One per line. Labels like <code className="rounded-[5px] border border-bean-line bg-bean-card2 px-1 py-0.5 text-[11px] text-bean-ink">A)</code>, <code className="rounded-[5px] border border-bean-line bg-bean-card2 px-1 py-0.5 text-[11px] text-bean-ink">1.</code> or <code className="rounded-[5px] border border-bean-line bg-bean-card2 px-1 py-0.5 text-[11px] text-bean-ink">-</code> are removed
              automatically; mark the correct one after pasting.
            </Hint>
            <textarea
              rows={4}
              className={`${FIELD} mt-2 text-[13px]`}
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              placeholder={'A) Bronze\nB) Silver\nC) Gold\nD) Platinum'}
            />
            <Btn type="button" onClick={applyBulk} className="mt-2 px-3 py-1.5 text-[12px]">
              Use these options
            </Btn>
          </details>

          <Label className="mt-4">
            Explanation (optional — shown on the agent&apos;s result screen)
          </Label>
          <textarea
            rows={2}
            className={FIELD}
            value={draft.explanation}
            onChange={(e) => set('explanation', e.target.value)}
            placeholder="Why the correct answer is correct…"
          />
        </>
      )}

      {localError && (
        <p className="mt-3 rounded-[10px] border border-bean-live/35 bg-bean-live/10 px-3 py-2 text-[12.5px] text-bean-live">{localError}</p>
      )}

      <div className="mt-4 flex gap-3">
        <Btn type="button" onClick={onCancel} disabled={busy}>← {cancelLabel}</Btn>
        <Btn tone="solid" type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Btn>
      </div>
    </form>
  );
}

// ── Marking ──────────────────────────────────────────────────

/**
 * Mark one submitted paper.
 *
 * Written answers are the job; the auto-scored ones are shown read-only so the
 * marker can see the whole paper. Marks can be saved part-way — the attempt
 * only leaves the queue and reaches the agent once nothing is unmarked, which
 * the server decides, not this form.
 */
function MarkingPanel({
  attempt, onClose, onSaved, onError,
}: {
  attempt: any;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { token } = useAuthStore();
  const written = attempt.answers.filter((a: any) => a.question.kind === 'WRITTEN');

  const makeInitialMarks = () =>
    Object.fromEntries(
      written.map((a: any) => [
        a.id,
        { pointsAwarded: a.pointsAwarded ?? '', markerNote: a.markerNote ?? '' },
      ]),
    ) as Record<string, { pointsAwarded: number | ''; markerNote: string }>;

  const [marks, setMarks] = useState<Record<string, { pointsAwarded: number | ''; markerNote: string }>>(makeInitialMarks);
  const [savedMarks, setSavedMarks] = useState<Record<string, { pointsAwarded: number | ''; markerNote: string }>>(makeInitialMarks);
  const [busy, setBusy] = useState(false);

  const hasUnsavedMarks = JSON.stringify(marks) !== JSON.stringify(savedMarks);

  function requestCloseMarking() {
    if (busy) return;
    if (hasUnsavedMarks && !confirm('Discard unsaved marks and return to the marking queue?')) return;
    onClose();
  }

  const autoPoints = attempt.answers
    .filter((a: any) => a.question.kind !== 'WRITTEN')
    .reduce((n: number, a: any) => n + (a.pointsAwarded ?? 0), 0);
  const autoPossible = attempt.answers
    .filter((a: any) => a.question.kind !== 'WRITTEN')
    .reduce((n: number, a: any) => n + a.question.points, 0);

  async function save() {
    if (!token) return;

    for (const answer of written) {
      const value = marks[answer.id]?.pointsAwarded;
      if (value === '') continue;
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > answer.question.points) {
        onError(`Points for "${answer.question.prompt}" must be between 0 and ${answer.question.points}.`);
        return;
      }
    }

    const payload = Object.entries(marks)
      .filter(([, m]) => m.pointsAwarded !== '')
      .map(([answerId, m]) => ({
        answerId,
        pointsAwarded: Number(m.pointsAwarded),
        markerNote: m.markerNote.trim() || undefined,
      }));

    if (payload.length === 0) {
      onError('Award points on at least one answer before saving.');
      return;
    }

    setBusy(true);
    try {
      const res = await contentApi.markAttempt(token, attempt.id, payload);
      const stillPending = res.data.pendingReview;
      onSaved(
        stillPending
          ? `Saved. ${res.data.unmarkedCount} answer${res.data.unmarkedCount === 1 ? '' : 's'} still to mark.`
          : `Marked — ${res.data.scorePct}%, ${res.data.passed ? 'passed' : 'not passed'}. The agent can see their result now.`,
      );
      if (stillPending) setSavedMarks({ ...marks });
      else onClose();
    } catch (err: any) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="bean-card mb-4 overflow-hidden rounded-[20px] border">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-bean-line px-5 py-[18px]">
        <div>
          <button type="button" onClick={requestCloseMarking} className="mb-2 inline-flex items-center gap-1.5 rounded-xl border border-bean-line bg-bean-card px-3 py-1.5 text-[12px] font-semibold text-bean-muted transition hover:border-bean-line2 hover:text-bean-ink">← Back to Marking Queue</button>
          <h2 className="text-[19px] font-extrabold tracking-[-0.02em] text-bean-ink">
            {attempt.agent.firstName} {attempt.agent.lastName}
          </h2>
          <p className="mt-1 text-[13.5px] text-bean-muted">
            {attempt.quiz.title} · attempt {attempt.attemptNumber} · submitted{' '}
            {new Date(attempt.submittedAt).toLocaleString()}
          </p>
          <p className="mt-1 text-[12px] text-bean-faint">
            Multiple choice scored automatically: {autoPoints} of {autoPossible}. Pass mark{' '}
            {attempt.thresholdPct ?? attempt.quiz.passThresholdPct}%.
          </p>
        </div>
        <span className="rounded-full border border-bean-gold/30 bg-bean-gold/10 px-3 py-1 text-[11px] font-bold text-bean-gold">Manual review</span>
        </div>
      </div>

      <ol className="space-y-3">
        {attempt.answers.map((answer: any, index: number) => (
          <li key={answer.id} className="bean-card rounded-[16px] border p-5">
            <div className="flex flex-wrap items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-bean-line bg-bean-card2 text-[12px] font-bold text-bean-muted">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium leading-relaxed text-bean-ink">{answer.question.prompt}</p>

                {answer.question.kind === 'WRITTEN' ? (
                  <>
                    <div className="mt-2 whitespace-pre-wrap rounded-[10px] border border-bean-line bg-bean-card2 px-4 py-3 text-[13.5px] leading-relaxed text-bean-ink">
                      {answer.answerText || (
                        <span className="italic text-bean-faint">Left blank.</span>
                      )}
                    </div>
                    <p className="mt-1 text-[12px] text-bean-faint">
                      {countLines(answer.answerText ?? '')} line
                      {countLines(answer.answerText ?? '') === 1 ? '' : 's'}
                      {answer.question.minLines
                        ? ` · asked for ${answer.question.minLines}${answer.question.maxLines ? `–${answer.question.maxLines}` : '+'}`
                        : ''}
                    </p>

                    {answer.question.explanation && (
                      <p className="mt-2 rounded-[10px] border border-bean-brand/25 bg-bean-brand/[0.07] px-3 py-2 text-[13px] text-bean-ink">
                        <span className="font-semibold">Model answer: </span>
                        {answer.question.explanation}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      <div>
                        <Label>Points (0–{answer.question.points})</Label>
                        <input
                          type="number"
                          min={0}
                          max={answer.question.points}
                          className={`${FIELD} w-28`}
                          value={marks[answer.id]?.pointsAwarded ?? ''}
                          onChange={(e) =>
                            setMarks((m) => ({
                              ...m,
                              [answer.id]: {
                                ...m[answer.id],
                                pointsAwarded: e.target.value === '' ? '' : Number(e.target.value),
                              },
                            }))
                          }
                        />
                      </div>
                      <div className="min-w-[240px] flex-1">
                        <Label>Feedback for the agent (optional)</Label>
                        <input
                          className={FIELD}
                          value={marks[answer.id]?.markerNote ?? ''}
                          onChange={(e) =>
                            setMarks((m) => ({
                              ...m,
                              [answer.id]: { ...m[answer.id], markerNote: e.target.value },
                            }))
                          }
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <p className={`mt-2 text-[13.5px] ${answer.isCorrect ? 'font-semibold text-bean-brand' : 'font-semibold text-bean-live'}`}>
                    {answer.isCorrect ? '✓ ' : '✕ '}
                    {answer.selectedOption?.text ?? <span className="font-normal italic text-bean-faint">Left blank.</span>}
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="bean-card sticky bottom-4 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border px-5 py-4 shadow-lg">
        <p className="text-[13.5px] text-bean-muted">
          {Object.values(marks).filter((m) => m.pointsAwarded !== '').length} of {written.length}{' '}
          written answer{written.length === 1 ? '' : 's'} marked
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Btn onClick={requestCloseMarking} disabled={busy}>← Back to queue</Btn>
          <Btn tone="solid" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save marks'}
          </Btn>
        </div>
      </div>
    </div>
  );
}


function DashboardMetric({ label, value, helper }: { label: string; value: React.ReactNode; helper: string }) {
  return (
    <div className="bean-card rounded-[18px] border px-4 py-3.5">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-bean-faint">{label}</p>
      <p className="mt-1 text-[22px] font-extrabold tracking-[-0.03em] text-bean-ink">{value}</p>
      <p className="mt-0.5 text-[11px] text-bean-muted">{helper}</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-bean-line bg-bean-card2/45 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-bean-faint">{label}</p>
      <p className="mt-0.5 text-[15px] font-extrabold text-bean-ink">{value}</p>
    </div>
  );
}

function BuilderMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-4 py-3 text-center">
      <p className="text-[16px] font-extrabold text-bean-ink">{value}</p>
      <p className="mt-0.5 text-[10.5px] font-semibold text-bean-faint">{label}</p>
    </div>
  );
}

function StatusPill({ published }: { published: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold ${
      published
        ? 'border-bean-brand/30 bg-bean-brand/10 text-bean-brand'
        : 'border-bean-gold/35 bg-bean-gold/10 text-bean-gold'
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${published ? 'bg-bean-brand' : 'bg-bean-gold'}`} />
      {published ? 'Published' : 'Draft'}
    </span>
  );
}

function QuizCardSkeleton() {
  return (
    <div className="bean-card animate-pulse rounded-[20px] border p-5">
      <div className="h-4 w-2/5 rounded bg-bean-card2" />
      <div className="mt-3 h-3 w-4/5 rounded bg-bean-card2" />
      <div className="mt-1.5 h-3 w-3/5 rounded bg-bean-card2" />
      <div className="mt-5 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((n) => <div key={n} className="h-14 rounded-xl bg-bean-card2" />)}
      </div>
      <div className="mt-4 h-20 rounded-2xl bg-bean-card2" />
    </div>
  );
}

// ── controls ─────────────────────────────────────────────────

/**
 * The two button weights this page uses. `solid` is the one action a panel is
 * for; `quiet` is everything else. Local to this page because the global
 * .btn-primary / .btn-secondary classes are built on white and grey and only
 * had a dark-theme remap — on the bright theme they would punch holes in the
 * warm surface.
 */
function Btn({
  tone = 'quiet',
  danger,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'solid' | 'quiet';
  danger?: boolean;
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition duration-150 disabled:cursor-not-allowed disabled:opacity-50';

  const look =
    tone === 'solid'
      ? danger
        ? 'bg-bean-live text-white hover:bg-bean-live/90'
        : 'bg-gradient-to-r from-bean-brand to-bean-brand-bright text-white hover:-translate-y-px disabled:translate-y-0'
      : danger
        ? 'border border-bean-live/35 bg-bean-live/[0.08] text-bean-live hover:bg-bean-live/15'
        : 'border border-bean-line bg-bean-card text-bean-muted hover:border-bean-line2 hover:text-bean-ink';

  return <button {...rest} className={`${base} ${look} ${className}`} />;
}

/** A round control carrying only a glyph; the label is its tooltip. */
function IconBtn({
  label,
  danger,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      {...rest}
      type="button"
      title={label}
      aria-label={label}
      className={`grid h-8 w-8 place-items-center rounded-full border transition duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'border-transparent text-bean-faint hover:border-bean-live/35 hover:bg-bean-live/10 hover:text-bean-live'
          : 'border-transparent text-bean-faint hover:border-bean-line hover:bg-bean-card2 hover:text-bean-ink'
      }`}
    >
      {children}
    </button>
  );
}

/** Field label. */
function Label({ className = '', children, ...rest }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label {...rest} className={`mb-1 block text-[12px] font-semibold text-bean-muted ${className}`}>
      {children}
    </label>
  );
}

/** Helper caption under a field. */
function Hint({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <p className={`text-[12px] leading-relaxed text-bean-faint ${className}`}>{children}</p>;
}

/** Themed text input; the global .input is white-on-grey in the bright theme. */
const FIELD =
  'block w-full rounded-xl border border-bean-line bg-bean-card px-3.5 py-2.5 text-[13.5px] text-bean-ink outline-none transition placeholder:text-bean-faint focus:border-bean-brand';

const S = { fill: 'none', strokeWidth: 1.9, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
const g = (d: string) => <path strokeLinecap="round" strokeLinejoin="round" d={d} />;

const PencilGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{g('M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125')}</svg>;
const TrashGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{g('M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0')}</svg>;
const ArrowUpGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{g('M4.5 15.75l7.5-7.5 7.5 7.5')}</svg>;
const ArrowDownGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{g('M19.5 8.25l-7.5 7.5-7.5-7.5')}</svg>;
const XGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{g('M6 18L18 6M6 6l12 12')}</svg>;
