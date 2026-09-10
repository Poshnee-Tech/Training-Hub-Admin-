'use client';

/**
 * Scope controls for the analytics page: which campaign, and which agent.
 *
 * ONE ROW, ABOVE EVERYTHING
 * Both controls sit in a single row above the panels and scope every one of
 * them, so the numbers on the page always agree with each other. Putting a
 * filter inside a chart card would let two panels disagree about what they are
 * counting, which is the fastest way to make a dashboard untrustworthy.
 *
 * THE AGENT PICKER
 * A combobox rather than a `<select>`: the floor can hold hundreds of agents,
 * and a native dropdown of hundreds is unusable. Typing queries the same
 * `GET /api/admin/agents?search=` the Agents page uses — matched on first name,
 * last name and email by the server — so an admin can find someone by whichever
 * of the three they happen to remember.
 *
 * The search is debounced and every response is checked against the query that
 * is current when it lands, so a slow reply for "sa" cannot overwrite the
 * results for "sarah".
 */

import { useEffect, useId, useRef, useState } from 'react';
import { admin } from '@/lib/api';

export type Agent = { id: string; firstName: string; lastName: string; email: string };

export const CAMPAIGNS = [
  { value: '', label: 'All campaigns' },
  { value: 'ACA', label: 'ACA' },
  { value: 'MEDICARE', label: 'Medicare' },
  { value: 'MED_ALERT', label: 'Med alert' },
] as const;

export function campaignLabel(value: string): string {
  return CAMPAIGNS.find((c) => c.value === value)?.label ?? value.replace(/_/g, ' ');
}

export function agentLabel(agent: Agent): string {
  const name = `${agent.firstName ?? ''} ${agent.lastName ?? ''}`.trim();
  return name || agent.email;
}

export default function AnalyticsFilters({
  token,
  campaign,
  agent,
  onCampaign,
  onAgent,
  busy,
}: {
  token: string | null;
  campaign: string;
  agent: Agent | null;
  onCampaign: (next: string) => void;
  onAgent: (next: Agent | null) => void;
  /** True while the page is refetching, so the bar can say so. */
  busy: boolean;
}) {
  // `relative z-30` below is load-bearing, not decoration. `backdrop-blur`
  // makes this panel a stacking context, which traps the dropdown's own z-50
  // inside it; the stat tiles further down are blurred panels too, so without a
  // z-index here they paint over the open agent list.
  return (
    <div className="air-panel relative z-30 mb-6 flex flex-wrap items-center gap-x-6 gap-y-4 rounded-[18px] border p-4 backdrop-blur-lg">
      <Field label="Campaign">
        <div className="flex flex-wrap gap-1">
          {CAMPAIGNS.map((option) => {
            const active = campaign === option.value;
            return (
              <button
                key={option.value || 'all'}
                type="button"
                onClick={() => onCampaign(option.value)}
                aria-pressed={active}
                className={`rounded-full px-3.5 py-[7px] text-[12.5px] font-semibold transition-colors ${
                  active
                    ? 'bg-air-signal text-white'
                    : 'air-hairline border text-air-muted hover:border-air-signal/40 hover:text-air-text'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Agent">
        <AgentPicker token={token} agent={agent} onAgent={onAgent} />
      </Field>

      {busy && (
        <span className="ml-auto flex shrink-0 items-center gap-2 font-mono-ui text-[9.5px] uppercase tracking-[0.14em] text-air-faint">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-air-signal border-t-transparent" />
          Updating
        </span>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.14em] text-air-faint">
        {label}
      </span>
      {children}
    </div>
  );
}

function AgentPicker({
  token,
  agent,
  onAgent,
}: {
  token: string | null;
  agent: Agent | null;
  onAgent: (next: Agent | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !token) return;

    let cancelled = false;
    setLoading(true);

    // Short debounce. Long enough that typing a name is one request rather than
    // six, short enough that the list feels attached to the keyboard.
    const timer = setTimeout(() => {
      admin
        .listAgents(token, { limit: '8', ...(query.trim() ? { search: query.trim() } : {}) })
        .then((r) => {
          if (!cancelled) setResults(r.data ?? []);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, token]);

  return (
    <div className="relative" ref={boxRef}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          className="air-hairline flex min-w-[220px] items-center justify-between gap-3 rounded-full border px-3.5 py-[7px] text-left text-[12.5px] font-semibold text-air-text transition-colors hover:border-air-signal/40"
        >
          <span className="truncate">{agent ? agentLabel(agent) : 'All agents'}</span>
          <ChevronIcon className={`h-3.5 w-3.5 shrink-0 stroke-air-faint transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {agent && (
          <button
            type="button"
            onClick={() => onAgent(null)}
            aria-label="Show all agents"
            title="Show all agents"
            className="air-hairline grid h-[31px] w-[31px] shrink-0 place-items-center rounded-full border text-air-muted transition-colors hover:border-air-live/40 hover:text-air-live"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 top-[calc(100%+8px)] z-50 w-[300px] overflow-hidden rounded-[14px] border border-air-line/25 bg-air-bg2 shadow-[0_24px_50px_-20px_rgba(0,0,0,0.75)]"
        >
          <div className="air-hairline border-b p-2.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or email…"
              className="air-hairline w-full rounded-lg border bg-transparent px-3 py-2 text-[13px] text-air-text placeholder:text-air-faint focus:border-air-signal/50 focus:outline-none focus:ring-0"
            />
          </div>

          <div className="max-h-[260px] overflow-y-auto p-1.5">
            <button
              type="button"
              role="option"
              aria-selected={!agent}
              onClick={() => {
                onAgent(null);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-air-line/[0.09] ${
                !agent ? 'text-air-signal-bright' : 'text-air-text'
              }`}
            >
              All agents
              {!agent && <CheckIcon className="h-3.5 w-3.5 shrink-0 stroke-air-signal-bright" />}
            </button>

            {loading && (
              <p className="px-2.5 py-2 font-mono-ui text-[10px] uppercase tracking-[0.12em] text-air-faint">
                Searching…
              </p>
            )}

            {!loading && results.length === 0 && (
              <p className="px-2.5 py-2 text-[12.5px] text-air-muted">
                {query.trim() ? 'No agent matches that.' : 'No agents yet.'}
              </p>
            )}

            {results.map((option) => {
              const selected = agent?.id === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onAgent(option);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-air-line/[0.09]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-air-text">
                      {agentLabel(option)}
                    </span>
                    <span className="block truncate font-mono-ui text-[10px] text-air-faint">
                      {option.email}
                    </span>
                  </span>
                  {selected && <CheckIcon className="h-3.5 w-3.5 shrink-0 stroke-air-signal-bright" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  viewBox: '0 0 24 24',
  fill: 'none',
  strokeWidth: 2.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

function ChevronIcon({ className }: { className?: string }) {
  return <svg className={className} {...S}><path d="m6 9 6 6 6-6" /></svg>;
}
function CheckIcon({ className }: { className?: string }) {
  return <svg className={className} {...S} strokeWidth={2.8}><path d="M20 6 9 17l-5-5" /></svg>;
}
function CloseIcon({ className }: { className?: string }) {
  return <svg className={className} {...S} stroke="currentColor"><path d="M18 6 6 18M6 6l12 12" /></svg>;
}
