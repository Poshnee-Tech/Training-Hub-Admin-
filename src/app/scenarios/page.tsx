'use client';

import { useEffect, useState } from 'react';
import { pronounsFor } from '@/lib/pronouns';
import AdminSidebar from '@/components/layout/AdminSidebar';
import { useAuthStore } from '@/store/auth.store';
import { scenariosApi } from '@/lib/api';

function campaignChip(campaign?: string) {
  switch (campaign) {
    case 'ACA':
      return 'border-bean-brand/35 bg-bean-brand/10 text-bean-brand';
    case 'MEDICARE':
      return 'admin-pill-campaign-medicare';
    case 'MED_ALERT':
      return 'border-bean-live/35 bg-bean-live/10 text-bean-live';
    default:
      return 'border-bean-line bg-bean-card2 text-bean-muted';
  }
}

function difficultyChip(difficulty?: string) {
  switch (difficulty) {
    case 'EASY':
      return 'admin-pill-difficulty-easy';
    case 'MEDIUM':
      return 'border-bean-gold/40 bg-bean-gold/12 text-bean-gold';
    default:
      return 'border-bean-live/35 bg-bean-live/10 text-bean-live';
  }
}

export default function ScenariosManagementPage() {
  const { token, loadFromStorage } = useAuthStore();

  const [scenarios, setScenarios] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);

  const [facts, setFacts] = useState<Record<string, string> | null>(null);
  const [factLabels, setFactLabels] = useState<Record<string, string>>({});

  const [findings, setFindings] = useState<
    { severity: string; field: string; message: string }[]
  >([]);

  const [saveError, setSaveError] = useState<string | null>(null);

  const [busyAuto, setBusyAuto] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);

  const [filterCampaign, setFilterCampaign] = useState('ALL');
  const [filterDifficulty, setFilterDifficulty] = useState('ALL');
  const [search, setSearch] = useState('');

  const [form, setForm] = useState({
    campaign: 'ACA',
    difficulty: 'EASY',

    personaName: '',
    personaAge: 35,
    personaGender: '',
    personaMood: '',
    personaPersonality: '',

    state: '',

    personaBackstory: '',
    customerIntent: '',

    hiddenObjections: [''],
    conversationRules: [''],

    destinationOutcome: '',
    personaVoice: '',
  });

  const p = pronounsFor(form.personaGender);

  const visibleScenarios = scenarios.filter((s) => {
    if (
      filterCampaign !== 'ALL' &&
      s.campaign !== filterCampaign
    ) {
      return false;
    }

    if (
      filterDifficulty !== 'ALL' &&
      s.difficulty !== filterDifficulty
    ) {
      return false;
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();

      if (
        !(
          s.name?.toLowerCase().includes(q) ||
          s.personaName?.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q)
        )
      ) {
        return false;
      }
    }

    return true;
  });

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (!token) return;
    loadScenarios();
  }, [token]);

  async function loadScenarios() {
    setLoading(true);

    try {
      const first = await scenariosApi.list(token!, {
        limit: '200',
        page: '1',
        includeInactive: 'true',
      });

      const pages: number = first.pagination?.pages ?? 1;

      let all = first.data as any[];

      if (pages > 1) {
        const rest = await Promise.all(
          Array.from(
            { length: pages - 1 },
            (_, i) =>
              scenariosApi.list(token!, {
                limit: '200',
                page: String(i + 2),
                includeInactive: 'true',
              }),
          ),
        );

        all = all.concat(
          ...rest.map((r) => r.data as any[]),
        );
      }

      setScenarios(all);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setForm({
      campaign: 'ACA',
      difficulty: 'EASY',

      personaName: '',
      personaAge: 35,
      personaGender: '',
      personaMood: '',
      personaPersonality: '',

      state: '',

      personaBackstory: '',
      customerIntent: '',

      hiddenObjections: [''],
      conversationRules: [''],

      destinationOutcome: '',
      personaVoice: '',
    });

    setFacts(null);
    setFactLabels({});
    setFindings([]);
    setEditingId(null);
    setShowForm(false);
    setSaveError(null);
  }

  async function editScenario(s: any) {
    if (!token) return;

    let full = s;

    try {
      const res = await scenariosApi.get(token, s.id);
      full = res.data;
    } catch (err) {
      console.error(
        'Failed to load full scenario for editing:',
        err,
      );
    }

    setForm({
      campaign: full.campaign,
      difficulty: full.difficulty,

      personaName: full.personaName,
      personaAge: full.personaAge,
      personaMood: full.personaMood,
      personaGender: full.personaGender ?? '',

      state: String(
        (full.qualificationFacts?.state as string) ?? '',
      ),

      personaPersonality:
        full.personaPersonality ?? '',

      personaBackstory:
        full.personaBackstory ?? '',

      customerIntent:
        full.customerIntent ?? '',

      hiddenObjections:
        full.hiddenObjections?.length
          ? full.hiddenObjections
          : [''],

      conversationRules:
        full.conversationRules?.length
          ? full.conversationRules
          : [''],

      destinationOutcome:
        full.destinationOutcome ?? '',

      personaVoice:
        full.personaVoice ?? '',
    });

    setFacts(
      (full.qualificationFacts as Record<
        string,
        string
      > | null) ?? null,
    );

    try {
      const labels =
        await scenariosApi.factLabels(token);

      setFactLabels(labels.data);
    } catch (err) {
      console.error(
        'Could not load qualification fact labels:',
        err,
      );

      setFactLabels({});
    }

    setEditingId(s.id);
    setShowForm(true);

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }

  async function runAutofill() {
    if (!token) return;

    if (!form.state.trim()) {
      setFindings([
        {
          severity: 'error',
          field: 'state',
          message: `Pick the state ${p.subject} ${p.verb(
            'live',
          )} in first — ${p.possessive} ZIP and ${
            p.possessive
          } doctor come from it.`,
        },
      ]);

      return;
    }

    setBusyAuto(true);

    try {
      const res = await scenariosApi.autofill(
        token,
        {
          campaign: form.campaign,
          state: form.state,
          personaName: form.personaName,

          carrier: facts?.carrier ?? '',
          planType: facts?.planType ?? '',
          doctor: facts?.doctor ?? '',

          destinationOutcome:
            form.destinationOutcome || null,

          qualificationFacts:
            facts ?? null,
        },
      );

      setFacts(
        res.data
          .qualificationFacts as Record<
          string,
          string
        >,
      );

      setFactLabels(
        res.data.labels as Record<
          string,
          string
        >,
      );

      setFindings([]);
    } catch (err: any) {
      setFindings([
        {
          severity: 'error',
          field: 'state',
          message: err.message,
        },
      ]);
    } finally {
      setBusyAuto(false);
    }
  }

  async function previewVoice() {
    if (
      !token ||
      !form.personaGender
    ) {
      return;
    }

    try {
      const res =
        await scenariosApi.voiceOptions(
          token,
          form.personaGender,
          form.personaAge,
        );

      const list = (
        res.data?.options ??
        res.data ??
        []
      ) as {
        id: string;
        label?: string;
      }[];

      const chosen =
        res.data?.resolved ??
        list[0]?.id;

      if (!chosen) return;

      const audio = new Audio(
        scenariosApi.voicePreviewUrl(
          chosen,
          token,
        ),
      );

      await audio.play();
    } catch (err: any) {
      setFindings([
        {
          severity: 'error',
          field: 'personaGender',
          message: `Could not play a preview: ${err.message}`,
        },
      ]);
    }
  }

  async function handleSubmit(
    e: React.FormEvent,
  ) {
    e.preventDefault();

    if (!token) return;

    setSaveError(null);

    try {
      const payload = {
        ...form,

        personaAge: Number(
          form.personaAge,
        ),

        hiddenObjections:
          form.hiddenObjections.filter(Boolean),

        conversationRules:
          form.conversationRules.filter(Boolean),

        destinationOutcome:
          form.destinationOutcome ||
          undefined,

        personaVoice:
          form.personaVoice.trim() ||
          null,

        qualificationFacts:
          facts ?? undefined,

        name: `${form.personaName} (${form.campaign})`,

        description:
          form.personaBackstory.slice(
            0,
            160,
          ),
      };

      const check =
        await scenariosApi.validate(
          token,
          payload,
        );

      if (!check.valid) {
        setFindings(
          check.findings,
        );

        return;
      }

      setFindings([]);

      if (editingId) {
        await scenariosApi.update(
          token,
          editingId,
          payload,
        );
      } else {
        await scenariosApi.create(
          token,
          payload,
        );
      }

      resetForm();

      loadScenarios();
    } catch (err: any) {
      setSaveError(
        err?.message ||
          'The save failed and the server gave no reason.',
      );
    }
  }

  async function deleteScenario(
    id: string,
  ) {
    if (
      !token ||
      !confirm(
        'Deactivate this scenario?',
      )
    ) {
      return;
    }

    await scenariosApi.delete(
      token,
      id,
    );

    loadScenarios();
  }

  return (
    <div className="flex">
      <AdminSidebar />

      <main className="bean-scope relative ml-64 min-h-screen flex-1 bg-bean-bg p-8 font-body text-bean-ink antialiased">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-[26px] font-extrabold tracking-[-0.03em] text-bean-ink">
              Scenario Management
            </h1>

            <p className="mt-1 text-[14px] text-bean-muted">
              Create and manage training
              scenarios
            </p>
          </div>

          <Btn
            tone={
              showForm
                ? 'quiet'
                : 'solid'
            }
            onClick={() => {
              if (showForm) {
                resetForm();
              } else {
                resetForm();
                setShowForm(true);
              }
            }}
          >
            {showForm
              ? 'Cancel'
              : '+ New Scenario'}
          </Btn>
        </header>

        {/* Editor */}
        {showForm && (
          <form
            onSubmit={
              handleSubmit
            }
            className="mb-8"
          >
            <div className="overflow-hidden rounded-[22px] border border-bean-line bg-bean-card shadow-sm">
              {/* Editor header */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-bean-line px-6 py-5">
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex h-7 items-center rounded-full border border-bean-line bg-bean-card2 px-2.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-bean-muted">
                      {editingId
                        ? 'Editing'
                        : 'New scenario'}
                    </span>

                    {form.personaName && (
                      <span className="text-[12px] text-bean-faint">
                        {
                          form.personaName
                        }
                      </span>
                    )}
                  </div>

                  <h2 className="text-[19px] font-bold tracking-[-0.02em] text-bean-ink">
                    {editingId
                      ? 'Edit Scenario'
                      : 'Create Scenario'}
                  </h2>

                  <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-bean-muted">
                    Define who the customer
                    is, how they behave, and
                    how the call should
                    eventually end.
                  </p>
                </div>

                <IconBtn
                  label="Close editor"
                  onClick={
                    resetForm
                  }
                >
                  <XGlyph className="h-4 w-4" />
                </IconBtn>
              </div>

              {/* Editor body */}
              <div className="space-y-5 bg-bean-bg/30 p-5 md:p-6">
                {/* Scenario setup */}
                <EditorSection
                  number="01"
                  title="Scenario setup"
                  description="Choose the campaign, difficulty and final outcome for this call."
                >
                  <div className="grid gap-4 md:grid-cols-3">
                    <FieldBlock label="Campaign">
                      <select
                        className={
                          EDITOR_FIELD
                        }
                        value={
                          form.campaign
                        }
                        onChange={(
                          e,
                        ) =>
                          setForm({
                            ...form,
                            campaign:
                              e
                                .target
                                .value,
                          })
                        }
                      >
                        <option value="ACA">
                          ACA
                        </option>

                        <option value="MEDICARE">
                          Medicare
                        </option>

                        <option value="MED_ALERT">
                          Med Alert
                        </option>
                      </select>
                    </FieldBlock>

                    <FieldBlock label="Difficulty">
                      <select
                        className={
                          EDITOR_FIELD
                        }
                        value={
                          form.difficulty
                        }
                        onChange={(
                          e,
                        ) =>
                          setForm({
                            ...form,
                            difficulty:
                              e
                                .target
                                .value,
                          })
                        }
                      >
                        <option value="EASY">
                          Easy
                        </option>

                        <option value="MEDIUM">
                          Medium
                        </option>

                        <option value="HARD">
                          Hard
                        </option>
                      </select>
                    </FieldBlock>

                    <FieldBlock
                      label="Arc ending"
                      hint="How this scenario should eventually resolve."
                    >
                      <select
                        required
                        className={
                          EDITOR_FIELD
                        }
                        value={
                          form.destinationOutcome
                        }
                        onChange={(
                          e,
                        ) =>
                          setForm({
                            ...form,
                            destinationOutcome:
                              e
                                .target
                                .value,
                          })
                        }
                      >
                        <option
                          value=""
                          disabled
                        >
                          Choose outcome
                        </option>

                        <option value="TRANSFER">
                          Transfer
                        </option>

                        <option value="CALLBACK">
                          Callback
                        </option>

                        <option value="DNQ">
                          DNQ
                        </option>

                        <option value="NOT_INTERESTED">
                          Not interested
                        </option>

                        <option value="DNC">
                          Do not call
                        </option>
                      </select>
                    </FieldBlock>
                  </div>
                </EditorSection>

                {/* Profile */}
                <EditorSection
                  number="02"
                  title="Customer profile"
                  description="Basic identity, location and temperament."
                >
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <FieldBlock label="Name">
                      <input
                        required
                        className={
                          EDITOR_FIELD
                        }
                        placeholder="e.g. Sarah Mitchell"
                        value={
                          form.personaName
                        }
                        onChange={(
                          e,
                        ) =>
                          setForm({
                            ...form,
                            personaName:
                              e
                                .target
                                .value,
                          })
                        }
                      />
                    </FieldBlock>

                    <FieldBlock label="Age">
                      <input
                        required
                        type="number"
                        min="18"
                        max="100"
                        className={
                          EDITOR_FIELD
                        }
                        value={
                          form.personaAge
                        }
                        onChange={(
                          e,
                        ) =>
                          setForm({
                            ...form,
                            personaAge:
                              parseInt(
                                e
                                  .target
                                  .value,
                              ) ||
                              18,
                          })
                        }
                      />
                    </FieldBlock>

                    <FieldBlock
                      label="Gender"
                      hint="Used to select the voice pool."
                    >
                      <select
                        className={
                          EDITOR_FIELD
                        }
                        value={
                          form.personaGender
                        }
                        onChange={(
                          e,
                        ) =>
                          setForm({
                            ...form,
                            personaGender:
                              e
                                .target
                                .value,
                          })
                        }
                      >
                        <option value="">
                          Choose gender
                        </option>

                        <option value="female">
                          Female
                        </option>

                        <option value="male">
                          Male
                        </option>
                      </select>
                    </FieldBlock>

                    <FieldBlock
                      label="State"
                      hint="Used to derive ZIP, doctor and qualification data."
                    >
                      <input
                        className={
                          EDITOR_FIELD
                        }
                        placeholder="AZ"
                        maxLength={
                          2
                        }
                        value={
                          form.state
                        }
                        onChange={(
                          e,
                        ) => {
                          const next =
                            e.target.value.toUpperCase();

                          setForm({
                            ...form,
                            state:
                              next,
                          });

                          if (
                            facts &&
                            'state' in
                              facts
                          ) {
                            setFacts({
                              ...facts,
                              state:
                                next,
                            });
                          }
                        }}
                      />
                    </FieldBlock>

                    <FieldBlock label="Mood">
                      <input
                        required
                        className={
                          EDITOR_FIELD
                        }
                        placeholder="Friendly, skeptical, frustrated..."
                        value={
                          form.personaMood
                        }
                        onChange={(
                          e,
                        ) =>
                          setForm({
                            ...form,
                            personaMood:
                              e
                                .target
                                .value,
                          })
                        }
                      />
                    </FieldBlock>

                    <FieldBlock label="Personality">
                      <input
                        required
                        className={
                          EDITOR_FIELD
                        }
                        placeholder="Direct, cautious, talkative..."
                        value={
                          form.personaPersonality
                        }
                        onChange={(
                          e,
                        ) =>
                          setForm({
                            ...form,
                            personaPersonality:
                              e
                                .target
                                .value,
                          })
                        }
                      />
                    </FieldBlock>
                  </div>
                </EditorSection>

                {/* Voice */}
                <EditorSection
                  number="03"
                  title="Behaviour & voice"
                  description="Describe how this customer sounds and reacts during the call."
                  action={
                    form.personaGender ? (
                      <Btn
                        type="button"
                        onClick={() =>
                          void previewVoice()
                        }
                      >
                        Preview voice
                      </Btn>
                    ) : undefined
                  }
                >
                  <FieldBlock
                    label={`${p.Possessive} voice`}
                    hint="Describe speaking style, sentence length, habits and reactions. Keep circumstances in the backstory."
                  >
                    <textarea
                      className={`${EDITOR_FIELD} min-h-[95px] resize-y`}
                      placeholder={`Example: ${p.Subject} speaks in short sentences and becomes more direct when annoyed.`}
                      value={
                        form.personaVoice
                      }
                      onChange={(
                        e,
                      ) =>
                        setForm({
                          ...form,
                          personaVoice:
                            e
                              .target
                              .value,
                        })
                      }
                    />
                  </FieldBlock>
                </EditorSection>

                {/* Context */}
                <EditorSection
                  number="04"
                  title="Customer context"
                  description="Give the persona concrete circumstances and a reason to stay engaged."
                >
                  <div className="space-y-4">
                    <FieldBlock
                      label="Their life"
                      hint={`Where ${p.subject} ${p.verb(
                        'live',
                      )}, current coverage and what has changed recently.`}
                    >
                      <textarea
                        required
                        className={`${EDITOR_FIELD} min-h-[115px] resize-y`}
                        placeholder="Describe the customer's current situation..."
                        value={
                          form.personaBackstory
                        }
                        onChange={(
                          e,
                        ) =>
                          setForm({
                            ...form,
                            personaBackstory:
                              e
                                .target
                                .value,
                          })
                        }
                      />
                    </FieldBlock>

                    <FieldBlock
                      label={`What ${p.subject} ${p.verb(
                        'want',
                      )} from the call`}
                      hint={`This is internal motivation. ${p.Subject} should not simply say it out loud.`}
                    >
                      <textarea
                        required
                        className={`${EDITOR_FIELD} min-h-[95px] resize-y`}
                        placeholder="What keeps this customer interested enough to stay on the line?"
                        value={
                          form.customerIntent
                        }
                        onChange={(
                          e,
                        ) =>
                          setForm({
                            ...form,
                            customerIntent:
                              e
                                .target
                                .value,
                          })
                        }
                      />
                    </FieldBlock>
                  </div>
                </EditorSection>

                {/* Conversation questions */}
                <EditorSection
                  number="05"
                  title="Questions they may raise"
                  description="Natural questions the customer should bring into the conversation when appropriate."
                >
                  <div className="space-y-2">
                    {form.conversationRules.map(
                      (
                        rule,
                        i,
                      ) => (
                        <div
                          key={
                            i
                          }
                          className="group flex items-center gap-2 rounded-xl border border-bean-line bg-bean-card p-2 transition focus-within:border-bean-brand"
                        >
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-bean-card2 text-[10.5px] font-bold text-bean-faint">
                            {i +
                              1}
                          </span>

                          <input
                            className="min-w-0 flex-1 bg-transparent px-1 text-[13px] text-bean-ink outline-none placeholder:text-bean-faint"
                            placeholder="e.g. Asks whether their doctor is in network"
                            value={
                              rule
                            }
                            onChange={(
                              e,
                            ) => {
                              const arr =
                                [
                                  ...form.conversationRules,
                                ];

                              arr[
                                i
                              ] =
                                e.target.value;

                              setForm(
                                {
                                  ...form,
                                  conversationRules:
                                    arr,
                                },
                              );
                            }}
                          />

                          <IconBtn
                            label="Remove rule"
                            danger
                            onClick={() =>
                              setForm(
                                {
                                  ...form,
                                  conversationRules:
                                    form.conversationRules.filter(
                                      (
                                        _,
                                        j,
                                      ) =>
                                        j !==
                                        i,
                                    ),
                                },
                              )
                            }
                          >
                            <XGlyph className="h-3.5 w-3.5" />
                          </IconBtn>
                        </div>
                      ),
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          conversationRules:
                            [
                              ...form.conversationRules,
                              '',
                            ],
                        })
                      }
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-[12.5px] font-semibold text-bean-brand transition hover:text-bean-brand-bright"
                    >
                      <span className="text-[16px] leading-none">
                        +
                      </span>
                      Add
                      question
                    </button>
                  </div>
                </EditorSection>

                {/* Qualification */}
                <EditorSection
                  number="06"
                  title="Qualification answers"
                  description="Review the exact answers this persona can give to the qualification set."
                  action={
                    <Btn
                      type="button"
                      onClick={() =>
                        void runAutofill()
                      }
                      disabled={
                        busyAuto
                      }
                    >
                      {busyAuto
                        ? 'Filling…'
                        : facts
                          ? 'Re-fill from state'
                          : 'Fill from state'}
                    </Btn>
                  }
                >
                  {!facts ? (
                    <div className="rounded-[16px] border border-dashed border-bean-line bg-bean-bg/40 px-5 py-10 text-center">
                      <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-bean-card2 text-[18px] text-bean-faint">
                        +
                      </div>

                      <p className="text-[13px] font-semibold text-bean-ink">
                        No
                        qualification
                        answers
                        yet
                      </p>

                      <p className="mx-auto mt-1 max-w-md text-[11.5px] leading-relaxed text-bean-muted">
                        Choose
                        the
                        customer&apos;s
                        state
                        above,
                        then
                        fill
                        the
                        answers
                        automatically.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {Object.entries(
                        facts,
                      ).map(
                        ([
                          key,
                          value,
                        ]) => (
                          <FieldBlock
                            key={
                              key
                            }
                            label={
                              factLabels[
                                key
                              ] ??
                              key
                            }
                          >
                            <input
                              className={
                                EDITOR_FIELD
                              }
                              value={String(
                                value,
                              )}
                              onChange={(
                                e,
                              ) =>
                                setFacts(
                                  {
                                    ...facts,
                                    [key]:
                                      e
                                        .target
                                        .value,
                                  },
                                )
                              }
                            />
                          </FieldBlock>
                        ),
                      )}
                    </div>
                  )}
                </EditorSection>

                {/* Validation findings */}
                {findings.length >
                  0 && (
                  <div className="rounded-[16px] border border-red-200 bg-red-50/80 p-4">
                    <div className="flex items-start gap-3">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-red-100 text-[13px] font-bold text-red-700">
                        !
                      </div>

                      <div className="min-w-0">
                        <h3 className="text-[13.5px] font-bold text-red-900">
                          This
                          scenario
                          needs
                          attention
                        </h3>

                        <p className="mt-0.5 text-[11.5px] text-red-700">
                          {
                            findings.filter(
                              (
                                f,
                              ) =>
                                f.severity ===
                                'error',
                            )
                              .length
                          }{' '}
                          issue
                          {findings.filter(
                            (
                              f,
                            ) =>
                              f.severity ===
                              'error',
                          )
                            .length ===
                          1
                            ? ''
                            : 's'}{' '}
                          to
                          fix
                        </p>

                        <div className="mt-3 space-y-2">
                          {findings.map(
                            (
                              f,
                              i,
                            ) => (
                              <div
                                key={
                                  i
                                }
                                className={`rounded-lg px-3 py-2 text-[12px] leading-relaxed ${
                                  f.severity ===
                                  'warning'
                                    ? 'bg-amber-100/60 text-amber-900'
                                    : 'bg-red-100/60 text-red-900'
                                }`}
                              >
                                <span className="font-semibold">
                                  {
                                    f.field
                                  }
                                  :
                                </span>{' '}
                                {
                                  f.message
                                }
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Save error */}
                {saveError && (
                  <div
                    className="rounded-[16px] border border-red-200 bg-red-50/80 p-4"
                    role="alert"
                  >
                    <div className="flex items-start gap-3">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-red-100 text-[13px] font-bold text-red-700">
                        !
                      </div>

                      <div>
                        <h3 className="text-[13.5px] font-bold text-red-900">
                          {editingId
                            ? 'Could not update scenario'
                            : 'Could not create scenario'}
                        </h3>

                        <p className="mt-1 text-[12.5px] leading-relaxed text-red-800">
                          {
                            saveError
                          }
                        </p>

                        <p className="mt-2 text-[11.5px] leading-relaxed text-red-700">
                          Nothing
                          was
                          cleared.
                          Your
                          changes
                          are
                          still
                          on
                          this
                          form.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-bean-line bg-bean-card/95 px-6 py-4 backdrop-blur">
                <p className="hidden text-[11.5px] text-bean-faint sm:block">
                  Review
                  qualification
                  answers
                  before
                  saving.
                </p>

                <div className="ml-auto flex items-center gap-2">
                  <Btn
                    type="button"
                    onClick={
                      resetForm
                    }
                  >
                    Cancel
                  </Btn>

                  <Btn
                    tone="solid"
                    type="submit"
                    className="min-w-[135px]"
                  >
                    {editingId
                      ? 'Save Changes'
                      : 'Create Scenario'}
                  </Btn>
                </div>
              </div>
            </div>
          </form>
        )}

        {/* Filters */}
        {!loading &&
          scenarios.length >
            0 && (
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <select
                className={`${FIELD} w-48`}
                value={
                  filterCampaign
                }
                onChange={(
                  e,
                ) =>
                  setFilterCampaign(
                    e.target.value,
                  )
                }
              >
                <option value="ALL">
                  All
                  Categories
                </option>

                <option value="ACA">
                  ACA
                </option>

                <option value="MEDICARE">
                  Medicare
                </option>

                <option value="MED_ALERT">
                  Med Alert
                </option>
              </select>

              <select
                className={`${FIELD} w-48`}
                value={
                  filterDifficulty
                }
                onChange={(
                  e,
                ) =>
                  setFilterDifficulty(
                    e.target.value,
                  )
                }
              >
                <option value="ALL">
                  All
                  Difficulties
                </option>

                <option value="EASY">
                  Easy
                </option>

                <option value="MEDIUM">
                  Medium
                </option>

                <option value="HARD">
                  Hard
                </option>
              </select>

              <input
                type="text"
                className={`${FIELD} min-w-[200px] flex-1`}
                placeholder="Search by name, persona, or description..."
                value={
                  search
                }
                onChange={(
                  e,
                ) =>
                  setSearch(
                    e.target.value,
                  )
                }
              />

              {(filterCampaign !==
                'ALL' ||
                filterDifficulty !==
                  'ALL' ||
                search) && (
                <button
                  type="button"
                  onClick={() => {
                    setFilterCampaign(
                      'ALL',
                    );
                    setFilterDifficulty(
                      'ALL',
                    );
                    setSearch(
                      '',
                    );
                  }}
                  className="text-[13px] font-medium text-bean-muted transition-colors hover:text-bean-ink"
                >
                  Clear
                </button>
              )}

              <div className="ml-auto text-[13px] text-bean-muted">
                Showing{' '}
                {
                  visibleScenarios.length
                }{' '}
                of{' '}
                {
                  scenarios.length
                }
              </div>
            </div>
          )}

        {/* Scenario list */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {!loading &&
            scenarios.length >
              0 &&
            visibleScenarios.length ===
              0 && (
              <div className="col-span-full py-12 text-center text-[13.5px] text-bean-muted">
                No
                scenarios
                match
                these
                filters.
              </div>
            )}

          {visibleScenarios.map(
            (s) => (
              <div
                key={s.id}
                className="bean-card flex flex-col rounded-[16px] border p-5 transition duration-150 hover:-translate-y-[2px]"
              >
                <div className="mb-2.5 flex gap-1.5">
                  <Chip
                    className={campaignChip(
                      s.campaign,
                    )}
                  >
                    {s.campaign.replace(
                      '_',
                      ' ',
                    )}
                  </Chip>

                  <Chip
                    className={difficultyChip(
                      s.difficulty,
                    )}
                  >
                    {
                      s.difficulty
                    }
                  </Chip>
                </div>

                <h3 className="text-[15px] font-bold tracking-[-0.01em] text-bean-ink">
                  {s.name}
                </h3>

                <p className="mb-3 line-clamp-2 text-[13px] leading-relaxed text-bean-muted">
                  {
                    s.description
                  }
                </p>

                <p className="mb-4 text-[12px] text-bean-faint">
                  Persona:{' '}
                  {
                    s.personaName
                  }
                  ,{' '}
                  {
                    s.personaAge
                  }
                  y/o -{' '}
                  {
                    s.personaMood
                  }
                </p>

                <div className="mt-auto flex gap-3">
                  <button
                    onClick={() =>
                      editScenario(
                        s,
                      )
                    }
                    className="text-[12.5px] font-semibold text-bean-brand transition-colors hover:text-bean-brand-bright"
                  >
                    Edit
                  </button>

                  <button
                    onClick={() =>
                      deleteScenario(
                        s.id,
                      )
                    }
                    className="text-[12.5px] font-semibold text-bean-live transition-opacity hover:opacity-80"
                  >
                    Deactivate
                  </button>
                </div>
              </div>
            ),
          )}
        </div>

        {loading && (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-bean-brand border-t-transparent" />
          </div>
        )}

        {!loading &&
          scenarios.length ===
            0 && (
            <p className="py-20 text-center text-[13.5px] text-bean-muted">
              No
              scenarios
              found
            </p>
          )}
      </main>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Editor components
───────────────────────────────────────────── */

function EditorSection({
  number,
  title,
  description,
  action,
  children,
}: {
  number: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[18px] border border-bean-line bg-bean-card p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-7 min-w-7 place-items-center rounded-lg bg-bean-card2 px-1.5 text-[10.5px] font-bold text-bean-faint">
            {number}
          </span>

          <div>
            <h3 className="text-[14px] font-bold tracking-[-0.01em] text-bean-ink">
              {title}
            </h3>

            {description && (
              <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-bean-muted">
                {
                  description
                }
              </p>
            )}
          </div>
        </div>

        {action && (
          <div>
            {action}
          </div>
        )}
      </div>

      {children}
    </section>
  );
}

function FieldBlock({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11.5px] font-semibold text-bean-muted">
        {label}
      </label>

      {children}

      {hint && (
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-bean-faint">
          {hint}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Existing controls
───────────────────────────────────────────── */

function Chip({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`admin-pill ${className}`}
    >
      {children}
    </span>
  );
}

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
      aria-label={
        label
      }
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border transition duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'border-transparent text-bean-faint hover:border-bean-live/35 hover:bg-bean-live/10 hover:text-bean-live'
          : 'border-transparent text-bean-faint hover:border-bean-line hover:bg-bean-card2 hover:text-bean-ink'
      }`}
    >
      {children}
    </button>
  );
}

function Btn({
  tone = 'quiet',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'solid' | 'quiet';
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition duration-150 disabled:cursor-not-allowed disabled:opacity-50';

  const look =
    tone === 'solid'
      ? 'bg-gradient-to-r from-bean-brand to-bean-brand-bright text-white hover:-translate-y-px disabled:translate-y-0'
      : 'border border-bean-line bg-bean-card text-bean-muted hover:border-bean-line2 hover:text-bean-ink';

  return (
    <button
      {...rest}
      className={`${base} ${look} ${className}`}
    />
  );
}

/* Original field styling used by filters */
const FIELD =
  'block w-full rounded-xl border border-bean-line bg-bean-card px-3.5 py-2.5 text-[13.5px] text-bean-ink outline-none transition placeholder:text-bean-faint focus:border-bean-brand';

/* Slightly cleaner editor field styling */
const EDITOR_FIELD =
  'block w-full rounded-xl border border-bean-line bg-bean-bg/35 px-3.5 py-2.5 text-[13px] text-bean-ink outline-none transition placeholder:text-bean-faint hover:border-bean-line2 focus:border-bean-brand focus:bg-bean-card';

const S = {
  fill: 'none',
  strokeWidth: 1.9,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
} as const;

const g = (
  d: string,
) => (
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    d={d}
  />
);

const XGlyph = ({
  className,
}: any) => (
  <svg
    className={
      className
    }
    {...S}
    stroke="currentColor"
  >
    {g(
      'M6 18L18 6M6 6l12 12',
    )}
  </svg>
);