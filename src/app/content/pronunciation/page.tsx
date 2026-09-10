'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import AdminSidebar from '@/components/layout/AdminSidebar';
import { useAuthStore } from '@/store/auth.store';

import {
  pronunciationApi,
  type PronunciationSentence,
} from '@/lib/api';

import { PracticeLimits } from '@/components/pronunciation/PracticeLimits';
import { AgentPracticeRoster } from '@/components/pronunciation/AgentPracticeRoster';

const CAMPAIGNS = [
  { value: '', label: 'All campaigns' },
  { value: 'ACA', label: 'ACA' },
  { value: 'MEDICARE', label: 'Medicare' },
  { value: 'MED_ALERT', label: 'Med Alert' },
] as const;

type PronunciationSection = 'PHRASES' | 'AGENTS';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

const EMPTY = {
  text: '',
  hint: '',
  campaign: '',
  isPublished: false,
};

const FIELD =
  'w-full rounded-lg border border-bean-line bg-bean-card px-3 py-2 text-[13px] text-bean-ink outline-none transition placeholder:text-bean-faint hover:border-bean-line2 focus:border-bean-brand';

const LABEL =
  'mb-1 block text-[11px] font-semibold text-bean-muted';

export default function PronunciationSentencesPage() {
  const { token } = useAuthStore();

  const [activeSection, setActiveSection] =
    useState<PronunciationSection>('PHRASES');

  /**
   * Bumped when the global limits are saved. The agent list shows what each
   * agent INHERITS, so a change to everyone's limits invalidates every row —
   * without this it would keep showing the figures it loaded beforehand.
   */
  const [limitsVersion, setLimitsVersion] = useState(0);

  const [sentences, setSentences] =
    useState<PronunciationSentence[]>([]);

  const [draft, setDraft] = useState(EMPTY);

  const [busy, setBusy] = useState(false);
  /**
   * ── EDITING HAPPENS IN THE ROW ──────────────────────────────────────────
   *
   * A phrase is three short fields, and the row already shows all three. A
   * modal would hide the rest of the library at the moment an admin most wants
   * to compare against it — "does this duplicate the one below?" — so the row
   * becomes the form and everything around it stays legible.
   *
   * Null when nothing is being edited. The draft is a COPY: abandoning an edit
   * has to leave the table exactly as it was, which it cannot do if the row is
   * edited in place.
   */
  const [editing, setEditing] = useState<
    | { id: string; text: string; hint: string; campaign: string }
    | null
  >(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [loading, setLoading] = useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;

    try {
      const res =
        await pronunciationApi.list(token);

      setSentences(res.data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const slug = useMemo(
    () => slugify(draft.text),
    [draft.text],
  );

  const create = useCallback(async () => {
    if (
      !token ||
      draft.text.trim().length < 3
    ) {
      return;
    }

    setBusy(true);

    try {
      await pronunciationApi.create(
        token,
        {
          slug:
            slug ||
            `phrase-${Date.now()}`,

          text: draft.text.trim(),

          hint:
            draft.hint.trim() ||
            undefined,

          campaign: (
            draft.campaign ||
            null
          ) as string | null,

          isPublished:
            draft.isPublished,
        },
      );

      setDraft(EMPTY);

      await load();
    } catch (err) {
      setError(
        (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }, [
    token,
    draft,
    slug,
    load,
  ]);

  const startEdit = useCallback(
    (s: PronunciationSentence) => {
      setError(null);
      setEditing({
        id: s.id,
        text: s.text,
        hint: s.hint ?? '',
        campaign: s.campaign ?? '',
      });
    },
    [],
  );

  const cancelEdit = useCallback(() => setEditing(null), []);

  /**
   * The same bounds the server enforces (text 3-300, hint 300), checked here so
   * Save is simply unavailable rather than failing after a round trip.
   */
  const editIsValid = Boolean(
    editing
    && editing.text.trim().length >= 3
    && editing.text.trim().length <= 300
    && editing.hint.trim().length <= 300,
  );

  const saveEdit = useCallback(async () => {
    if (!token || !editing) return;

    const text = editing.text.trim();
    const hint = editing.hint.trim();
    if (text.length < 3 || text.length > 300 || hint.length > 300) return;

    setSavingEdit(true);
    setError(null);
    try {
      await pronunciationApi.update(
        token,
        editing.id,
        {
          text,
          // Cleared means cleared: an empty box sends null, which the server
          // stores as "no hint", where `undefined` would silently keep the old
          // one and the box would fill itself back in on the next load.
          hint: hint || null,
          campaign: editing.campaign || null,
        },
      );

      setEditing(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }, [token, editing, load]);

  const togglePublished = useCallback(
    async (
      s: PronunciationSentence,
    ) => {
      if (!token) return;

      try {
        await pronunciationApi.update(
          token,
          s.id,
          {
            isPublished:
              !s.isPublished,
          },
        );

        await load();
      } catch (err) {
        setError(
          (err as Error).message,
        );
      }
    },
    [token, load],
  );

  const remove = useCallback(
    async (
      s: PronunciationSentence,
    ) => {
      if (!token) return;

      const warning =
        s.attemptCount
          ? `Delete this phrase? ${s.attemptCount} recorded attempt${
              s.attemptCount === 1
                ? ''
                : 's'
            } will be deleted with it.`
          : 'Delete this phrase?';

      if (
        !window.confirm(warning)
      ) {
        return;
      }

      try {
        await pronunciationApi.remove(
          token,
          s.id,
        );

        await load();
      } catch (err) {
        setError(
          (err as Error).message,
        );
      }
    },
    [token, load],
  );

  const publishedCount =
    sentences.filter(
      (s) => s.isPublished,
    ).length;

  return (
    <div className="flex">
      <AdminSidebar />

      <main className="bean-scope relative ml-64 min-h-screen flex-1 bg-bean-bg px-7 py-6 font-body text-bean-ink antialiased">
        <div className="mx-auto w-full max-w-[1400px]">

          {/* Header */}
          <header className="mb-5">
            <h1 className="font-display text-[24px] font-extrabold tracking-[-0.03em] text-bean-ink">
              Pronunciation
            </h1>

            <p className="mt-0.5 text-[12.5px] text-bean-muted">
              Manage training phrases and agent practice.
            </p>
          </header>

          {/* Main section selector */}
          <div className="mb-5 flex items-center border-b border-bean-line">
            <SectionTab
              active={
                activeSection ===
                'PHRASES'
              }
              onClick={() =>
                setActiveSection(
                  'PHRASES',
                )
              }
              icon={
                <PhraseGlyph className="h-4 w-4 stroke-current" />
              }
              label="Phrases"
              count={sentences.length}
            />

            <SectionTab
              active={
                activeSection ===
                'AGENTS'
              }
              onClick={() =>
                setActiveSection(
                  'AGENTS',
                )
              }
              icon={
                <AgentsGlyph className="h-4 w-4 stroke-current" />
              }
              label="Agents"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-bean-live/30 bg-bean-live/10 px-3 py-2 text-[12px] text-bean-live">
              <div className="flex items-center gap-2">
                <span className="font-bold">
                  !
                </span>

                <span>
                  {error}
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  setError(null)
                }
                className="font-semibold opacity-70 transition hover:opacity-100"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* ═══════════════════════════════════════
              PHRASES
          ═══════════════════════════════════════ */}
          {activeSection ===
            'PHRASES' && (
            <>
              {/* Section heading */}
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-[16px] font-bold tracking-[-0.01em] text-bean-ink">
                    Pronunciation phrases
                  </h2>

                  <p className="mt-0.5 text-[11.5px] text-bean-muted">
                    Create and publish
                    phrases agents can
                    practise.
                  </p>
                </div>

                <div className="hidden items-center gap-4 sm:flex">
                  <MiniStat
                    label="Total"
                    value={
                      sentences.length
                    }
                  />

                  <MiniStat
                    label="Published"
                    value={
                      publishedCount
                    }
                  />
                </div>
              </div>

              {/* Add phrase */}
              <section className="bean-card mb-5 rounded-[14px] border p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-[13.5px] font-bold text-bean-ink">
                      Add phrase
                    </h3>

                    <p className="mt-0.5 text-[11px] text-bean-faint">
                      Use real call
                      language agents need
                      to pronounce clearly.
                    </p>
                  </div>

                  {slug && (
                    <code className="hidden rounded-md bg-bean-card2 px-2 py-1 font-mono-ui text-[10px] text-bean-faint lg:block">
                      {slug}
                    </code>
                  )}
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(180px,0.8fr)_minmax(150px,0.55fr)]">

                  {/* Phrase */}
                  <div>
                    <label
                      className={
                        LABEL
                      }
                      htmlFor="phrase"
                    >
                      Phrase
                    </label>

                    <textarea
                      id="phrase"
                      rows={2}
                      maxLength={300}
                      value={
                        draft.text
                      }
                      onChange={(e) =>
                        setDraft(
                          (d) => ({
                            ...d,
                            text:
                              e
                                .target
                                .value,
                          }),
                        )
                      }
                      placeholder="Thank you for calling, my name is Sarah. How can I help you today?"
                      className={`${FIELD} min-h-[68px] resize-y`}
                    />
                  </div>

                  {/* Hint */}
                  <div>
                    <label
                      className={
                        LABEL
                      }
                      htmlFor="hint"
                    >
                      Coaching note
                    </label>

                    <textarea
                      id="hint"
                      rows={2}
                      maxLength={300}
                      value={
                        draft.hint
                      }
                      onChange={(e) =>
                        setDraft(
                          (d) => ({
                            ...d,
                            hint:
                              e
                                .target
                                .value,
                          }),
                        )
                      }
                      placeholder="Warm and unhurried."
                      className={`${FIELD} min-h-[68px] resize-y`}
                    />
                  </div>

                  {/* Campaign */}
                  <div>
                    <label
                      className={
                        LABEL
                      }
                      htmlFor="campaign"
                    >
                      Campaign
                    </label>

                    <select
                      id="campaign"
                      value={
                        draft.campaign
                      }
                      onChange={(e) =>
                        setDraft(
                          (d) => ({
                            ...d,
                            campaign:
                              e
                                .target
                                .value,
                          }),
                        )
                      }
                      className={
                        FIELD
                      }
                    >
                      {CAMPAIGNS.map(
                        (c) => (
                          <option
                            key={
                              c.value
                            }
                            value={
                              c.value
                            }
                          >
                            {
                              c.label
                            }
                          </option>
                        ),
                      )}
                    </select>

                    <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12px] text-bean-muted">
                      <input
                        type="checkbox"
                        checked={
                          draft.isPublished
                        }
                        onChange={(
                          e,
                        ) =>
                          setDraft(
                            (d) => ({
                              ...d,

                              isPublished:
                                e
                                  .target
                                  .checked,
                            }),
                          )
                        }
                        className="h-3.5 w-3.5 rounded border-bean-line accent-bean-brand"
                      />

                      Publish now
                    </label>
                  </div>
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={
                      create
                    }
                    disabled={
                      busy ||
                      draft.text.trim()
                        .length < 3
                    }
                    className="rounded-lg bg-bean-brand px-3.5 py-2 text-[12.5px] font-semibold text-white transition hover:bg-bean-brand-bright disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy
                      ? 'Adding…'
                      : 'Add phrase'}
                  </button>
                </div>
              </section>

              {/* Phrase library */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[13.5px] font-bold text-bean-ink">
                    Phrase library
                  </h3>

                  {!loading &&
                    sentences.length >
                      0 && (
                      <span className="text-[11px] text-bean-faint">
                        {
                          publishedCount
                        }{' '}
                        published
                      </span>
                    )}
                </div>

                {loading ? (
                  <div className="bean-card rounded-[14px] border px-4 py-8 text-center text-[12.5px] text-bean-muted">
                    Loading phrases…
                  </div>
                ) : sentences.length ===
                  0 ? (
                  <div className="bean-card rounded-[14px] border border-dashed px-4 py-10 text-center">
                    <div className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-lg bg-bean-brand/10 text-bean-brand">
                      <PhraseGlyph className="h-4 w-4 stroke-current" />
                    </div>

                    <p className="text-[13px] font-semibold text-bean-ink">
                      No phrases yet
                    </p>

                    <p className="mt-1 text-[11.5px] text-bean-muted">
                      Add the first
                      pronunciation line
                      above.
                    </p>
                  </div>
                ) : (
                  <div className="bean-card overflow-hidden rounded-[14px] border">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] border-collapse">
                        <thead>
                          <tr className="border-b border-bean-line bg-bean-bg/35 text-left text-[10.5px] font-semibold text-bean-muted">
                            <th className="px-4 py-2.5">
                              Phrase
                            </th>

                            <th className="w-[120px] px-4 py-2.5">
                              Campaign
                            </th>

                            <th className="w-[80px] px-4 py-2.5 text-right">
                              Attempts
                            </th>

                            <th className="w-[110px] px-4 py-2.5">
                              Status
                            </th>

                            <th className="w-[130px] px-4 py-2.5" />
                          </tr>
                        </thead>

                        <tbody>
                          {sentences.map(
                            (s) => (
                              <tr
                                key={
                                  s.id
                                }
                                className="group border-b border-bean-line/50 transition last:border-0 hover:bg-bean-bg/35"
                              >
                                <td className="px-4 py-2.5">
                                  {editing?.id === s.id ? (
                                    <div className="max-w-[760px] space-y-2">
                                      <div>
                                        <textarea
                                          value={editing.text}
                                          onChange={(e) =>
                                            setEditing({ ...editing, text: e.target.value })
                                          }
                                          rows={2}
                                          maxLength={300}
                                          autoFocus
                                          aria-label="Phrase"
                                          className={`${FIELD} resize-y text-[12.5px] leading-relaxed`}
                                        />
                                        <p className="mt-0.5 text-[10.5px] text-bean-faint">
                                          {editing.text.trim().length < 3
                                            ? 'At least three characters.'
                                            : `${editing.text.trim().length}/300`}
                                        </p>
                                      </div>
                                      <input
                                        value={editing.hint}
                                        onChange={(e) =>
                                          setEditing({ ...editing, hint: e.target.value })
                                        }
                                        maxLength={300}
                                        placeholder="Hint for the agent (optional)"
                                        aria-label="Hint"
                                        className={`${FIELD} text-[11.5px]`}
                                      />
                                    </div>
                                  ) : (
                                    <>
                                      <p className="max-w-[760px] text-[12.5px] leading-relaxed text-bean-ink">
                                        {
                                          s.text
                                        }
                                      </p>

                                      {s.hint && (
                                        <p className="mt-0.5 text-[11px] text-bean-faint">
                                          {
                                            s.hint
                                          }
                                        </p>
                                      )}
                                    </>
                                  )}
                                </td>

                                <td className="px-4 py-2.5">
                                  {editing?.id === s.id ? (
                                    <select
                                      value={editing.campaign}
                                      onChange={(e) =>
                                        setEditing({ ...editing, campaign: e.target.value })
                                      }
                                      aria-label="Campaign"
                                      className={`${FIELD} text-[11.5px]`}
                                    >
                                      {CAMPAIGNS.map((c) => (
                                        <option key={c.value} value={c.value}>
                                          {c.label}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <CampaignTag
                                      campaign={
                                        s.campaign
                                      }
                                    />
                                  )}
                                </td>

                                <td className="px-4 py-2.5 text-right font-mono-ui text-[11.5px] text-bean-muted">
                                  {
                                    s.attemptCount
                                  }
                                </td>

                                <td className="px-4 py-2.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      togglePublished(
                                        s,
                                      )
                                    }
                                    title={
                                      s.isPublished
                                        ? 'Hide from agents'
                                        : 'Show to agents'
                                    }
                                    className={`inline-flex h-6 items-center rounded-full px-2.5 text-[10px] font-semibold transition ${
                                      s.isPublished
                                        ? 'bg-bean-brand/10 text-bean-brand hover:bg-bean-brand/20'
                                        : 'bg-bean-card2 text-bean-muted hover:text-bean-ink'
                                    }`}
                                  >
                                    {s.isPublished
                                      ? 'Published'
                                      : 'Draft'}
                                  </button>
                                </td>

                                <td className="px-4 py-2.5 text-right">
                                  {editing?.id === s.id ? (
                                    <div className="flex items-center justify-end gap-2">
                                      <button
                                        type="button"
                                        onClick={() => void saveEdit()}
                                        disabled={!editIsValid || savingEdit}
                                        className="rounded-lg bg-bean-brand px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition hover:bg-bean-brand-deep disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {savingEdit ? 'Saving…' : 'Save'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={cancelEdit}
                                        disabled={savingEdit}
                                        className="text-[11.5px] font-medium text-bean-muted transition hover:text-bean-ink disabled:opacity-50"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-end gap-3">
                                      <button
                                        type="button"
                                        onClick={() => startEdit(s)}
                                        title="Edit this phrase"
                                        className="text-[11.5px] font-medium text-bean-muted opacity-60 transition hover:text-bean-brand group-hover:opacity-100"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          remove(
                                            s,
                                          )
                                        }
                                        className="text-[11.5px] font-medium text-bean-faint opacity-60 transition hover:text-bean-live group-hover:opacity-100"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}

          {/* ═══════════════════════════════════════
              AGENTS
          ═══════════════════════════════════════ */}
          {activeSection ===
            'AGENTS' && (
            <>
              <div className="mb-4">
                <h2 className="text-[16px] font-bold tracking-[-0.01em] text-bean-ink">
                  Agent practice
                </h2>

                <p className="mt-0.5 text-[11.5px] text-bean-muted">
                  Manage pronunciation
                  limits and review agent
                  practice usage.
                </p>
              </div>

              <div className="space-y-4">
                {/* Saving the global limits changes what every agent inherits,
                    so the list below has to re-read rather than show what it
                    loaded before the change. */}
                <PracticeLimits
                  token={token}
                  onSaved={() => setLimitsVersion((v) => v + 1)}
                />

                <AgentPracticeRoster
                  token={token}
                  reloadKey={limitsVersion}
                />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/* ──────────────────────────────────────
   Section tab
────────────────────────────────────── */

function SectionTab({
  active,
  label,
  count,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex h-10 items-center gap-2 px-4 text-[12px] font-semibold transition ${
        active
          ? 'text-bean-brand'
          : 'text-bean-muted hover:text-bean-ink'
      }`}
    >
      {icon}

      <span>
        {label}
      </span>

      {count !== undefined && (
        <span
          className={`rounded-md px-1.5 py-0.5 font-mono-ui text-[9.5px] ${
            active
              ? 'bg-bean-brand/10 text-bean-brand'
              : 'bg-bean-card2 text-bean-faint'
          }`}
        >
          {count}
        </span>
      )}

      {active && (
        <span className="absolute bottom-[-1px] left-3 right-3 h-[2px] rounded-full bg-bean-brand" />
      )}
    </button>
  );
}

/* ──────────────────────────────────────
   Small stat
────────────────────────────────────── */

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="text-right">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-bean-faint">
        {label}
      </div>

      <div className="mt-0.5 text-[16px] font-bold text-bean-ink">
        {value}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────
   Campaign tag
────────────────────────────────────── */

function CampaignTag({
  campaign,
}: {
  campaign?: string | null;
}) {
  const label = campaign
    ? campaign.replace(
        '_',
        ' ',
      )
    : 'All';

  return (
    <span className="inline-flex rounded-md border border-bean-line bg-bean-card2 px-2 py-1 text-[10px] font-semibold text-bean-muted">
      {label}
    </span>
  );
}

/* ──────────────────────────────────────
   Icons
────────────────────────────────────── */

const S = {
  fill: 'none',
  strokeWidth: 1.9,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
} as const;

function PhraseGlyph({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      {...S}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 9h8M8 13h5M5 19l2.5-3H18a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1"
      />
    </svg>
  );
}

function AgentsGlyph({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      {...S}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
      />
    </svg>
  );
}