'use client';

import { useEffect, useState } from 'react';
import AdminSidebar from '@/components/layout/AdminSidebar';
import { ConfirmPopover } from '@/components/ui/Popover';
import { useAuthStore } from '@/store/auth.store';
import {
  admin,
  assignmentsApi,
  assignmentsExtra,
  scenariosApi,
} from '@/lib/api';

const AVATAR_COLORS = [
  'bg-ledger-gold',
  'bg-ledger-teal',
  'bg-ledger-brand',
  'bg-ledger-brand-deep',
  'bg-ledger-bad',
  'bg-ledger-good',
];

const COMPACT_INPUT =
  'rounded-lg border border-ledger-line bg-ledger-panel px-3 py-2 text-[12px] text-ledger-ink outline-none transition placeholder:text-ledger-faint hover:border-ledger-line2 focus:border-ledger-brand focus:ring-2 focus:ring-ledger-brand/10';

export default function AssignmentsPage() {
  const { token, loadFromStorage } = useAuthStore();

  const [assignmentsList, setAssignmentsList] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [scenarios, setScenarios] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  const [form, setForm] = useState({
    agentIds: [] as string[],
    scenarioIds: [] as string[],

    scheduledDate: new Date().toISOString().split('T')[0],
    scheduledHour: '' as string,

    flowType: 'SINGLE' as 'SINGLE' | 'DUAL',
    agentRole: 'FRONTER' as string,

    notes: '',
  });

  const [result, setResult] = useState('');

  // Assignment list filters
  const [filterAgent, setFilterAgent] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Scenario picker filters
  const [formFilterCampaign, setFormFilterCampaign] = useState('ALL');
  const [formFilterDifficulty, setFormFilterDifficulty] = useState('ALL');
  const [formSearch, setFormSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  const visibleScenarios = scenarios.filter((s) => {
    if (
      formFilterCampaign !== 'ALL' &&
      s.campaign !== formFilterCampaign
    ) {
      return false;
    }

    if (
      formFilterDifficulty !== 'ALL' &&
      s.difficulty !== formFilterDifficulty
    ) {
      return false;
    }

    if (formSearch.trim()) {
      const q = formSearch.trim().toLowerCase();

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

    loadAll();
  }, [token, filterAgent, filterStatus]);

  async function loadAll() {
    setLoading(true);

    try {
      const params: any = {
        limit: '50',
      };

      if (filterAgent) {
        params.agentId = filterAgent;
      }

      if (filterStatus) {
        params.status = filterStatus;
      }

      const [assignRes, agentsRes, scenariosRes] = await Promise.all([
        assignmentsApi.list(token!, params),

        admin.listAgents(token!, {
          limit: '100',
        }),

        scenariosApi.list(token!, {
          limit: '500',
        }),
      ]);

      setAssignmentsList(assignRes.data);
      setAgents(agentsRes.data);
      setScenarios(scenariosRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (
      !token ||
      form.scenarioIds.length === 0 ||
      form.agentIds.length === 0
    ) {
      return;
    }

    setSubmitting(true);
    setResult('');

    try {
      const res = await assignmentsExtra.assignCustomers(token, {
        agentIds: form.agentIds,

        scenarioIds: form.scenarioIds,

        scheduledDate: form.scheduledDate,

        ...(form.scheduledHour !== ''
          ? {
              scheduledHour: parseInt(form.scheduledHour),
            }
          : {}),

        flowType: form.flowType,

        agentRole: (
          form.flowType === 'SINGLE'
            ? 'FRONTER'
            : form.agentRole
        ) as 'FRONTER' | 'VERIFIER',

        notes: form.notes || undefined,
      });

      setShowForm(false);

      setResult(
        res.message ||
          'Customers assigned.',
      );

      setForm({
        agentIds: [],
        scenarioIds: [],

        scheduledDate: new Date().toISOString().split('T')[0],
        scheduledHour: '',

        flowType: 'SINGLE',
        agentRole: 'FRONTER',

        notes: '',
      });

      setFormSearch('');

      loadAll();
    } catch (err: any) {
      setResult(
        `Could not assign: ${err.message}`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  function toggleScenario(scenarioId: string) {
    setForm((f) => ({
      ...f,

      scenarioIds: f.scenarioIds.includes(scenarioId)
        ? f.scenarioIds.filter((id) => id !== scenarioId)
        : [...f.scenarioIds, scenarioId],
    }));
  }

  function toggleAgent(agentId: string) {
    setForm((f) => ({
      ...f,

      agentIds: f.agentIds.includes(agentId)
        ? f.agentIds.filter((id) => id !== agentId)
        : [...f.agentIds, agentId],
    }));
  }

  async function cancelAssignment(id: string) {
    if (!token) return;

    await assignmentsApi.cancel(token, id);

    loadAll();
  }

  const activeAgents = agents.filter((agent) => agent.isActive);

  const shownActive = assignmentsList.filter(
    (item) => item.status === 'ACTIVE',
  ).length;

  const shownCompleted = assignmentsList.filter(
    (item) => item.status === 'COMPLETED',
  ).length;

  const shownCancelled = assignmentsList.filter(
    (item) => item.status === 'CANCELLED',
  ).length;

  const hasListFilters =
    !!filterAgent ||
    !!filterStatus;

  const assignmentCount =
    form.agentIds.length *
    form.scenarioIds.length;

  return (
    <div className="flex">
      <AdminSidebar />

      <main className="ledger-scope relative ml-64 min-h-screen flex-1 bg-ledger-bg px-6 py-7 text-ledger-ink antialiased lg:px-8">
        <div className="mx-auto w-full max-w-[1500px]">

          {/* Header */}
          <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-ledger-brand" />

                <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ledger-faint">
                  Call activity
                </span>
              </div>

              <h1 className="text-[27px] font-extrabold tracking-[-0.035em] text-ledger-ink">
                Assign Customers
              </h1>

              <p className="mt-1 max-w-2xl text-[13px] text-ledger-muted">
                Schedule practice customers and assign them to one or more agents.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowForm((open) => !open)}
              className="ledger-btn-primary inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[12.5px] font-semibold transition"
            >
              {showForm ? (
                <>
                  <CloseGlyph className="h-3.5 w-3.5 stroke-current" />
                  Close
                </>
              ) : (
                <>
                  <PlusGlyph className="h-3.5 w-3.5 stroke-current" />
                  New Assignment
                </>
              )}
            </button>
          </header>

          {/* Summary */}
          {!loading && (
            <section className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <MetricCard
                label="Shown assignments"
                value={assignmentsList.length}
                helper={
                  hasListFilters
                    ? 'Current filters'
                    : 'Latest records'
                }
              />

              <MetricCard
                label="Active"
                value={shownActive}
                helper="Scheduled / in progress"
              />

              <MetricCard
                label="Completed"
                value={shownCompleted}
                helper="Finished practice"
              />

              <MetricCard
                label="Cancelled"
                value={shownCancelled}
                helper="No longer scheduled"
              />
            </section>
          )}

          {/* Result */}
          {result && (
            <div
              className={`mb-4 flex items-center justify-between gap-4 rounded-xl border px-3.5 py-2.5 ${
                result.startsWith('Could not assign:')
                  ? 'border-ledger-bad/35 bg-ledger-bad-bg text-ledger-bad'
                  : 'border-ledger-good/30 bg-ledger-good-bg text-ledger-ink'
              }`}
              role={
                result.startsWith('Could not assign:')
                  ? 'alert'
                  : 'status'
              }
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current/20 text-[10px] font-bold">
                  {result.startsWith('Could not assign:')
                    ? '!'
                    : '✓'}
                </span>

                <p className="min-w-0 break-words text-[12.5px] font-medium">
                  {result}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setResult('')}
                className="shrink-0 text-[11.5px] font-semibold opacity-70 hover:opacity-100"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* New assignment */}
          {showForm && (
            <form
              onSubmit={handleSubmit}
              className="ledger-panel mb-6 overflow-hidden rounded-[16px] border border-ledger-line"
            >
              {/* Builder header */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ledger-line px-5 py-4">
                <div>
                  <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ledger-ink">
                    New Assignment
                  </h2>

                  <p className="mt-0.5 text-[11.5px] text-ledger-muted">
                    Select customers, agents, then choose the schedule.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <CountBadge
                    label="Customers"
                    value={form.scenarioIds.length}
                  />

                  <CountBadge
                    label="Agents"
                    value={form.agentIds.length}
                  />

                  {assignmentCount > 0 && (
                    <span className="rounded-lg bg-ledger-brand/10 px-2.5 py-1.5 text-[10.5px] font-bold text-ledger-brand">
                      {assignmentCount} assignment
                      {assignmentCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              </div>

              <div className="divide-y divide-ledger-line">

                {/* Step 1 */}
                <AssignmentStep
                  number="1"
                  title="Customers"
                  subtitle={`${form.scenarioIds.length} selected`}
                >
                  {/* Filters */}
                  <div className="mb-3 flex flex-wrap gap-2">
                    <select
                      className={`${COMPACT_INPUT} w-[150px]`}
                      value={formFilterCampaign}
                      onChange={(e) =>
                        setFormFilterCampaign(e.target.value)
                      }
                    >
                      <option value="ALL">
                        All campaigns
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
                      className={`${COMPACT_INPUT} w-[150px]`}
                      value={formFilterDifficulty}
                      onChange={(e) =>
                        setFormFilterDifficulty(e.target.value)
                      }
                    >
                      <option value="ALL">
                        All difficulties
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

                    <div className="relative min-w-[220px] flex-1">
                      <SearchGlyph className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 stroke-ledger-faint" />

                      <input
                        type="text"
                        value={formSearch}
                        onChange={(e) =>
                          setFormSearch(e.target.value)
                        }
                        onFocus={() =>
                          setSearchFocused(true)
                        }
                        onBlur={() =>
                          setTimeout(
                            () => setSearchFocused(false),
                            150,
                          )
                        }
                        placeholder="Search customers..."
                        className={`${COMPACT_INPUT} w-full pl-9`}
                      />

                      {searchFocused && formSearch.trim() && (
                        <div className="ledger-panel absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-ledger-line shadow-xl">
                          {visibleScenarios.length === 0 ? (
                            <div className="px-3 py-4 text-center text-[12px] text-ledger-muted">
                              No matching customers
                            </div>
                          ) : (
                            visibleScenarios
                              .slice(0, 30)
                              .map((s) => {
                                const selected =
                                  form.scenarioIds.includes(s.id);

                                return (
                                  <button
                                    key={s.id}
                                    type="button"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      toggleScenario(s.id);
                                    }}
                                    className={`flex w-full items-center gap-2 border-b border-ledger-line px-3 py-2 text-left last:border-0 ${
                                      selected
                                        ? 'bg-ledger-brand/10'
                                        : 'hover:bg-ledger-bg2'
                                    }`}
                                  >
                                    <CheckBox active={selected} />

                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-[12px] font-semibold text-ledger-ink">
                                        {s.personaName || s.name}
                                      </span>

                                      <span className="block truncate text-[10.5px] text-ledger-faint">
                                        {s.name}
                                      </span>
                                    </span>

                                    <CampaignBadge
                                      campaign={s.campaign}
                                    />
                                  </button>
                                );
                              })
                          )}
                        </div>
                      )}
                    </div>

                    {(formFilterCampaign !== 'ALL' ||
                      formFilterDifficulty !== 'ALL' ||
                      formSearch) && (
                      <button
                        type="button"
                        onClick={() => {
                          setFormFilterCampaign('ALL');
                          setFormFilterDifficulty('ALL');
                          setFormSearch('');
                        }}
                        className="rounded-lg px-2.5 text-[11.5px] font-semibold text-ledger-muted transition hover:bg-ledger-bg2 hover:text-ledger-ink"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {/* Customer list */}
                  <div className="max-h-[245px] overflow-y-auto rounded-xl border border-ledger-line">
                    {visibleScenarios.length === 0 ? (
                      <div className="py-8 text-center text-[12px] text-ledger-muted">
                        No customers match these filters.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                        {visibleScenarios.map((s) => {
                          const selected =
                            form.scenarioIds.includes(s.id);

                          return (
                            <label
                              key={s.id}
                              className={`flex cursor-pointer items-center gap-2.5 border-b border-r border-ledger-line px-3 py-2.5 transition ${
                                selected
                                  ? 'bg-ledger-brand/10'
                                  : 'hover:bg-ledger-bg2/70'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() =>
                                  toggleScenario(s.id)
                                }
                                className="sr-only"
                              />

                              <CheckBox active={selected} />

                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12px] font-semibold text-ledger-ink">
                                  {s.personaName ||
                                    'Unnamed customer'}
                                </span>

                                <span className="block truncate text-[10.5px] text-ledger-faint">
                                  {s.name}
                                </span>
                              </span>

                              <span className="flex shrink-0 gap-1">
                                <CampaignBadge
                                  campaign={s.campaign}
                                />

                                <DifficultyBadge
                                  difficulty={s.difficulty}
                                />
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[10.5px] text-ledger-faint">
                    <span>
                      {visibleScenarios.length} shown
                    </span>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,

                            scenarioIds: Array.from(
                              new Set([
                                ...current.scenarioIds,

                                ...visibleScenarios.map(
                                  (s) => s.id,
                                ),
                              ]),
                            ),
                          }))
                        }
                        className="font-semibold text-ledger-brand hover:text-ledger-brand-deep"
                      >
                        Select shown
                      </button>

                      {form.scenarioIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              scenarioIds: [],
                            }))
                          }
                          className="font-semibold text-ledger-muted hover:text-ledger-ink"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </AssignmentStep>

                {/* Step 2 */}
                <AssignmentStep
                  number="2"
                  title="Agents"
                  subtitle={`${form.agentIds.length} selected`}
                >
                  <div className="max-h-[205px] overflow-y-auto rounded-xl border border-ledger-line">
                    {activeAgents.length === 0 ? (
                      <div className="py-8 text-center text-[12px] text-ledger-muted">
                        No active agents available.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {activeAgents.map((agent, index) => {
                          const selected =
                            form.agentIds.includes(agent.id);

                          const initials =
                            `${agent.firstName?.[0] ?? ''}${agent.lastName?.[0] ?? ''}`.toUpperCase();

                          return (
                            <label
                              key={agent.id}
                              className={`flex cursor-pointer items-center gap-2.5 border-b border-r border-ledger-line px-3 py-2.5 transition ${
                                selected
                                  ? 'bg-ledger-brand/10'
                                  : 'hover:bg-ledger-bg2/70'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() =>
                                  toggleAgent(agent.id)
                                }
                                className="sr-only"
                              />

                              <CheckBox active={selected} />

                              <span
                                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[9.5px] font-bold text-white ${
                                  AVATAR_COLORS[
                                    index % AVATAR_COLORS.length
                                  ]
                                }`}
                              >
                                {initials || '·'}
                              </span>

                              <span className="min-w-0 truncate text-[11.5px] font-semibold text-ledger-ink">
                                {agent.firstName} {agent.lastName}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[10.5px] text-ledger-faint">
                    <span>
                      {activeAgents.length} active agents
                    </span>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,

                            agentIds: activeAgents.map(
                              (a) => a.id,
                            ),
                          }))
                        }
                        className="font-semibold text-ledger-brand hover:text-ledger-brand-deep"
                      >
                        Select all
                      </button>

                      {form.agentIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              agentIds: [],
                            }))
                          }
                          className="font-semibold text-ledger-muted hover:text-ledger-ink"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </AssignmentStep>

                {/* Step 3 */}
                <AssignmentStep
                  number="3"
                  title="Schedule"
                  subtitle={
                    form.flowType === 'SINGLE'
                      ? 'Single-agent'
                      : 'Dual-agent'
                  }
                >
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <CompactField label="Date">
                      <input
                        required
                        type="date"
                        value={form.scheduledDate}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            scheduledDate: e.target.value,
                          })
                        }
                        className={`${COMPACT_INPUT} w-full`}
                      />
                    </CompactField>

                    <CompactField label="Time">
                      <select
                        value={form.scheduledHour}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            scheduledHour: e.target.value,
                          })
                        }
                        className={`${COMPACT_INPUT} w-full`}
                      >
                        <option value="">
                          Any time
                        </option>

                        {Array.from(
                          { length: 24 },
                          (_, i) => (
                            <option key={i} value={i}>
                              {i === 0
                                ? '12:00 AM'
                                : i < 12
                                  ? `${i}:00 AM`
                                  : i === 12
                                    ? '12:00 PM'
                                    : `${i - 12}:00 PM`}
                            </option>
                          ),
                        )}
                      </select>
                    </CompactField>

                    <CompactField label="Flow">
                      <select
                        value={form.flowType}
                        onChange={(e) => {
                          const next = e.target.value as
                            | 'SINGLE'
                            | 'DUAL';

                          setForm((current) => ({
                            ...current,

                            flowType: next,

                            agentRole:
                              next === 'SINGLE'
                                ? 'FRONTER'
                                : current.agentRole,
                          }));
                        }}
                        className={`${COMPACT_INPUT} w-full`}
                      >
                        <option value="SINGLE">
                          Single Agent
                        </option>

                        <option value="DUAL">
                          Dual Agent
                        </option>
                      </select>
                    </CompactField>

                    <CompactField label="Role">
                      {form.flowType === 'DUAL' ? (
                        <select
                          value={form.agentRole}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              agentRole: e.target.value,
                            })
                          }
                          className={`${COMPACT_INPUT} w-full`}
                        >
                          <option value="FRONTER">
                            Fronter
                          </option>

                          <option value="VERIFIER">
                            Verifier
                          </option>
                        </select>
                      ) : (
                        <div className="flex h-[37px] items-center rounded-lg border border-ledger-line bg-ledger-bg2 px-3 text-[12px] font-medium text-ledger-muted">
                          Fronter
                        </div>
                      )}
                    </CompactField>
                  </div>

                  <div className="mt-3">
                    <CompactField label="Notes">
                      <input
                        value={form.notes}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            notes: e.target.value,
                          })
                        }
                        placeholder="Optional note for the agent..."
                        className={`${COMPACT_INPUT} w-full`}
                      />
                    </CompactField>
                  </div>

                  {form.flowType === 'DUAL' && (
                    <p className="mt-2 text-[10.5px] text-ledger-faint">
                      {form.agentRole === 'FRONTER'
                        ? 'Fronter starts the call and transfers it to the verifier.'
                        : 'Verifier receives the transferred call and completes verification.'}
                    </p>
                  )}
                </AssignmentStep>
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-3 border-t border-ledger-line bg-ledger-panel/95 px-5 py-3 backdrop-blur">
                <div className="min-w-0 flex-1">
                  {assignmentCount > 0 ? (
                    <p className="text-[11.5px] text-ledger-muted">
                      <strong className="font-bold text-ledger-ink">
                        {form.agentIds.length}
                      </strong>{' '}
                      agent{form.agentIds.length === 1 ? '' : 's'}
                      {' × '}
                      <strong className="font-bold text-ledger-ink">
                        {form.scenarioIds.length}
                      </strong>{' '}
                      customer
                      {form.scenarioIds.length === 1 ? '' : 's'}
                      {' = '}
                      <strong className="font-bold text-ledger-brand">
                        {assignmentCount}
                      </strong>{' '}
                      assignment
                      {assignmentCount === 1 ? '' : 's'}
                    </p>
                  ) : (
                    <p className="text-[11.5px] text-ledger-faint">
                      Select at least one customer and one agent.
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  disabled={submitting}
                  className="rounded-lg border border-ledger-line px-3.5 py-2 text-[12px] font-semibold text-ledger-muted transition hover:bg-ledger-bg2 hover:text-ledger-ink disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={
                    submitting ||
                    form.agentIds.length === 0 ||
                    form.scenarioIds.length === 0
                  }
                  className="ledger-btn-primary min-w-[145px] rounded-lg px-4 py-2 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {submitting
                    ? 'Creating...'
                    : assignmentCount === 1
                      ? 'Create Assignment'
                      : `Create ${assignmentCount} Assignments`}
                </button>
              </div>
            </form>
          )}

          {/* Assignment ledger */}
          <section>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold tracking-[-0.01em] text-ledger-ink">
                  Assignment ledger
                </h2>

                <p className="mt-0.5 text-[12px] text-ledger-muted">
                  Review scheduled practice and cancel active assignments.
                </p>
              </div>

              <span className="text-[11.5px] text-ledger-faint">
                {loading
                  ? 'Loading…'
                  : `${assignmentsList.length} assignment${
                      assignmentsList.length === 1 ? '' : 's'
                    } shown`}
              </span>
            </div>

            {/* Filters */}
            <div className="ledger-panel mb-3 rounded-[14px] border p-3">
              <div className="flex flex-col gap-2.5 lg:flex-row lg:items-end">
                <div className="min-w-0 flex-1">
                  <Label>
                    Agent
                  </Label>

                  <select
                    className="ledger-input w-full rounded-lg border py-2 pl-3 pr-8 text-[12px] focus:outline-none focus:ring-2 focus:ring-ledger-brand/20 lg:max-w-[300px]"
                    value={filterAgent}
                    onChange={(e) =>
                      setFilterAgent(e.target.value)
                    }
                  >
                    <option value="">
                      All agents
                    </option>

                    {agents.map((a) => (
                      <option
                        key={a.id}
                        value={a.id}
                      >
                        {a.firstName} {a.lastName}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="min-w-0 flex-1">
                  <Label>
                    Status
                  </Label>

                  <select
                    className="ledger-input w-full rounded-lg border py-2 pl-3 pr-8 text-[12px] focus:outline-none focus:ring-2 focus:ring-ledger-brand/20 lg:max-w-[240px]"
                    value={filterStatus}
                    onChange={(e) =>
                      setFilterStatus(e.target.value)
                    }
                  >
                    <option value="">
                      All statuses
                    </option>

                    <option value="ACTIVE">
                      Active
                    </option>

                    <option value="COMPLETED">
                      Completed
                    </option>

                    <option value="EXPIRED">
                      Expired
                    </option>

                    <option value="CANCELLED">
                      Cancelled
                    </option>
                  </select>
                </div>

                {hasListFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterAgent('');
                      setFilterStatus('');
                    }}
                    className="rounded-lg px-3 py-2 text-[11.5px] font-semibold text-ledger-muted transition hover:bg-ledger-bg2 hover:text-ledger-brand"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>

            {/* Ledger */}
            <div className="ledger-panel overflow-hidden rounded-[16px] border">
              <div className="overflow-x-auto">
                <div className="ledger-grid-assign grid min-w-[980px] border-b border-ledger-line bg-ledger-brand/[0.05] px-5 py-3">
                  <HeadCell>
                    Agent
                  </HeadCell>

                  <HeadCell>
                    Customer
                  </HeadCell>

                  <HeadCell>
                    Campaign
                  </HeadCell>

                  <HeadCell>
                    Difficulty
                  </HeadCell>

                  <HeadCell>
                    Scheduled
                  </HeadCell>

                  <HeadCell>
                    Status
                  </HeadCell>

                  <HeadCell className="text-right">
                    Actions
                  </HeadCell>
                </div>

                {assignmentsList.map((a, i) => {
                  const full =
                    `${a.agent?.firstName ?? ''} ${a.agent?.lastName ?? ''}`.trim();

                  const initials =
                    `${a.agent?.firstName?.[0] ?? ''}${a.agent?.lastName?.[0] ?? ''}`.toUpperCase();

                  return (
                    <div
                      key={a.id}
                      className="ledger-row ledger-grid-assign grid min-w-[980px] items-center border-t border-ledger-line px-5 py-3 text-[12.5px] transition-colors first:border-t-0"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[9.5px] font-bold text-white ${
                            AVATAR_COLORS[
                              i % AVATAR_COLORS.length
                            ]
                          }`}
                        >
                          {initials || '·'}
                        </span>

                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-ledger-ink">
                            {full || '·'}
                          </span>

                          {a.agent?.email && (
                            <span className="block truncate text-[10px] text-ledger-faint">
                              {a.agent.email}
                            </span>
                          )}
                        </span>
                      </div>

                      <div className="min-w-0 pr-3">
                        <span className="block truncate font-medium text-ledger-ink">
                          {a.scenario?.name || '·'}
                        </span>

                        {a.scenario?.personaName && (
                          <span className="block truncate text-[10px] text-ledger-faint">
                            {a.scenario.personaName}
                          </span>
                        )}
                      </div>

                      <CampaignBadge
                        campaign={a.scenario?.campaign}
                      />

                      <DifficultyBadge
                        difficulty={a.scenario?.difficulty}
                      />

                      <span className="pr-3 text-ledger-muted">
                        <span className="block">
                          {new Date(
                            a.scheduledDate,
                          ).toLocaleDateString()}
                        </span>

                        <span className="block text-[10px] text-ledger-faint">
                          {a.scheduledHour !== null &&
                          a.scheduledHour !== undefined
                            ? a.scheduledHour === 0
                              ? '12:00 AM'
                              : a.scheduledHour < 12
                                ? `${a.scheduledHour}:00 AM`
                                : a.scheduledHour === 12
                                  ? '12:00 PM'
                                  : `${a.scheduledHour - 12}:00 PM`
                            : 'Any time'}
                        </span>
                      </span>

                      <StatusBadge
                        status={a.status}
                      />

                      <div className="flex items-center justify-end">
                        {a.status === 'ACTIVE' ? (
                          <ConfirmPopover
                            open={cancelTarget === a.id}
                            onClose={() =>
                              setCancelTarget(null)
                            }
                            onConfirm={() =>
                              cancelAssignment(a.id)
                            }
                            title="Cancel this assignment?"
                            body={`${
                              full || 'This agent'
                            } will no longer be scheduled for ${
                              a.scenario?.name ||
                              'this customer'
                            }.`}
                            confirmLabel="Cancel assignment"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setCancelTarget(a.id)
                              }
                              className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold text-ledger-bad transition hover:bg-ledger-bad-bg"
                            >
                              Cancel
                            </button>
                          </ConfirmPopover>
                        ) : (
                          <span className="text-[11px] text-ledger-faint">
                            —
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {loading &&
                  assignmentsList.length === 0 && (
                    <AssignmentSkeleton />
                  )}

                {!loading &&
                  assignmentsList.length === 0 && (
                    <div className="px-6 py-14 text-center">
                      <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-ledger-line bg-ledger-bg2 text-ledger-brand">
                        <CustomerGlyph className="h-4.5 w-4.5 stroke-current" />
                      </div>

                      <h3 className="mt-3 text-[14px] font-bold text-ledger-ink">
                        {hasListFilters
                          ? 'No matching assignments'
                          : 'No assignments yet'}
                      </h3>

                      <p className="mx-auto mt-1 max-w-md text-[12px] text-ledger-muted">
                        {hasListFilters
                          ? 'Try changing the agent or status filters.'
                          : 'Create the first practice assignment for your agents.'}
                      </p>

                      {hasListFilters ? (
                        <button
                          type="button"
                          onClick={() => {
                            setFilterAgent('');
                            setFilterStatus('');
                          }}
                          className="ledger-btn-secondary mt-4 rounded-lg border px-3.5 py-2 text-[12px] font-semibold"
                        >
                          Clear filters
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowForm(true)}
                          className="ledger-btn-primary mt-4 inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[12px] font-semibold"
                        >
                          <PlusGlyph className="h-3.5 w-3.5 stroke-current" />

                          New Assignment
                        </button>
                      )}
                    </div>
                  )}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

/* ──────────────────────────────────────
   New assignment UI helpers
────────────────────────────────────── */

function AssignmentStep({
  number,
  title,
  subtitle,
  children,
}: {
  number: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-5 py-4">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ledger-brand/10 text-[9.5px] font-extrabold text-ledger-brand">
          {number}
        </span>

        <h3 className="text-[13px] font-bold text-ledger-ink">
          {title}
        </h3>

        {subtitle && (
          <span className="text-[10.5px] text-ledger-faint">
            {subtitle}
          </span>
        )}
      </div>

      {children}
    </section>
  );
}

function CompactField({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10.5px] font-semibold text-ledger-muted">
        {label}
      </label>

      {children}
    </div>
  );
}

function CountBadge({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-ledger-line bg-ledger-bg2 px-2 py-1.5 text-[10px] text-ledger-muted">
      {label}

      <strong className="font-extrabold text-ledger-ink">
        {value}
      </strong>
    </span>
  );
}

function CheckBox({
  active,
}: {
  active: boolean;
}) {
  return (
    <span
      className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border text-[9px] font-bold transition ${
        active
          ? 'border-ledger-brand bg-ledger-brand text-white'
          : 'border-ledger-line bg-ledger-panel text-transparent'
      }`}
    >
      ✓
    </span>
  );
}

/* ──────────────────────────────────────
   Existing UI helpers
────────────────────────────────────── */

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: number;
  helper: string;
}) {
  return (
    <div className="ledger-panel rounded-[14px] border px-3.5 py-3">
      <div className="text-[10.5px] font-semibold text-ledger-muted">
        {label}
      </div>

      <div className="mt-0.5 text-[20px] font-extrabold tracking-[-0.03em] text-ledger-ink">
        {value}
      </div>

      <div className="text-[10px] text-ledger-faint">
        {helper}
      </div>
    </div>
  );
}

function AssignmentSkeleton() {
  return (
    <div className="space-y-px bg-ledger-line/60">
      {[0, 1, 2, 3].map((item) => (
        <div
          key={item}
          className="grid min-w-[980px] grid-cols-7 gap-6 bg-ledger-panel px-5 py-3"
        >
          <div className="h-8 animate-pulse rounded-lg bg-ledger-bg2" />
          <div className="h-8 animate-pulse rounded-lg bg-ledger-bg2" />
          <div className="h-5 animate-pulse rounded-lg bg-ledger-bg2" />
          <div className="h-5 animate-pulse rounded-lg bg-ledger-bg2" />
          <div className="h-8 animate-pulse rounded-lg bg-ledger-bg2" />
          <div className="h-5 animate-pulse rounded-lg bg-ledger-bg2" />
          <div className="h-5 animate-pulse rounded-lg bg-ledger-bg2" />
        </div>
      ))}
    </div>
  );
}

function Label({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <label className="mb-1 block text-[11px] font-semibold text-ledger-ink">
      {children}
    </label>
  );
}

function HeadCell({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`text-[10.5px] font-bold uppercase tracking-[0.08em] text-ledger-ink ${
        className ?? ''
      }`}
    >
      {children}
    </span>
  );
}

function CampaignBadge({
  campaign,
}: {
  campaign?: string;
}) {
  const cls =
    campaign === 'ACA'
      ? 'bg-ledger-good-bg text-ledger-good'
      : campaign === 'MEDICARE'
        ? 'admin-pill-campaign-medicare'
        : 'bg-ledger-brand/15 text-ledger-brand-deep';

  return (
    <span className={`admin-pill w-fit ${cls}`}>
      {campaign?.replace('_', ' ') ?? '·'}
    </span>
  );
}

function DifficultyBadge({
  difficulty,
}: {
  difficulty?: string;
}) {
  const cls =
    difficulty === 'EASY'
      ? 'admin-pill-difficulty-easy'
      : difficulty === 'MEDIUM'
        ? 'bg-ledger-gold/15 text-ledger-gold'
        : difficulty === 'HARD'
          ? 'bg-ledger-bad-bg text-ledger-bad'
          : 'bg-ledger-line/30 text-ledger-muted';

  return (
    <span className={`admin-pill w-fit ${cls}`}>
      {difficulty ?? '·'}
    </span>
  );
}

function StatusBadge({
  status,
}: {
  status?: string;
}) {
  const pillCls =
    status === 'ACTIVE'
      ? 'admin-pill-status-active'
      : status === 'COMPLETED'
        ? 'admin-pill-status-completed'
        : status === 'CANCELLED'
          ? 'bg-ledger-bad-bg text-ledger-bad'
          : 'bg-ledger-line/30 text-ledger-muted';

  return (
    <span className={`admin-pill w-fit ${pillCls}`}>
      {status ?? '·'}
    </span>
  );
}

/* ──────────────────────────────────────
   Glyphs
────────────────────────────────────── */

const S = {
  fill: 'none',
  strokeWidth: 1.9,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
} as const;

const d = (path: string) => (
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    d={path}
  />
);

function PlusGlyph({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      {...S}
      strokeWidth={2.4}
    >
      {d('M12 5v14M5 12h14')}
    </svg>
  );
}

function CloseGlyph({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      {...S}
    >
      {d('M6 18 18 6M6 6l12 12')}
    </svg>
  );
}

function SearchGlyph({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      {...S}
    >
      {d(
        'm21 21-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
      )}
    </svg>
  );
}

function CustomerGlyph({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      {...S}
    >
      {d(
        'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
      )}
    </svg>
  );
}