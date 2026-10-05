'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { admin, type FloorAgent, type FloorView } from '@/lib/api';
import { useQuietPoll } from '@/lib/use-quiet-poll';
import LiveListener, { audioContextFromClick } from './LiveListener';

/**
 * LIVE FLOOR — who is on a call, who is on a break, who is neither, right now.
 *
 * Polled every few seconds in the background (useQuietPoll): the section only
 * re-renders when an agent's state actually changes. The running clocks tick
 * on their own, so they move without refetching anything.
 */

const POLL_MS = 5000;

const STATUS_LABEL: Record<FloorAgent['status'], string> = {
  ON_CALL: 'On a call',
  ON_BREAK: 'On break',
  NOT_ON_CALL: 'Not on a call',
};

const STATUS_STYLE: Record<FloorAgent['status'], string> = {
  ON_CALL: 'border-air-live/30 bg-air-live/[0.08] text-air-live',
  ON_BREAK: 'border-air-amber/30 bg-air-amber/[0.08] text-air-amber',
  NOT_ON_CALL: 'border-air-line/20 bg-air-line/[0.04] text-air-muted',
};

const BREAK_LABEL: Record<string, string> = {
  LUNCH: 'Lunch',
  RESTROOM: 'Restroom',
  COACHING: 'Coaching',
  MEETING: 'Meeting',
  TECHNICAL: 'Technical issue',
  PERSONAL: 'Personal',
  OTHER: 'Other',
};

function clock(seconds: number) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** A clock counting up from `since`, ticking on its own. */
function Elapsed({ since, limitSeconds }: { since: string; limitSeconds?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.floor((now - new Date(since).getTime()) / 1000);
  const nearLimit = limitSeconds !== undefined && seconds >= limitSeconds - 5 * 60;
  return (
    <span className={`font-mono-ui text-[12.5px] tabular-nums ${nearLimit ? 'font-bold text-air-live' : 'text-air-text'}`}>
      {clock(seconds)}
      {limitSeconds !== undefined && <span className="text-air-faint"> / {clock(limitSeconds)}</span>}
    </span>
  );
}

function CountTile({ label, value, tone, pulse, selected, onClick }: {
  label: string;
  value: number | string;
  tone: 'live' | 'amber' | 'muted';
  pulse?: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const dot = tone === 'live' ? 'bg-air-live' : tone === 'amber' ? 'bg-air-amber' : 'bg-air-faint';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`Show agents: ${label.toLowerCase()}`}
      className={`air-panel flex items-center gap-3 rounded-[16px] border px-4 py-3 text-left transition hover:border-air-mint/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-air-mint ${selected ? 'border-air-mint/60 ring-1 ring-air-mint/30' : ''}`}
    >
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot} ${pulse ? 'animate-air-blink' : ''}`} aria-hidden />
      <span className="min-w-0">
        <span className="block font-display text-[26px] font-extrabold leading-none tracking-[-0.03em] text-air-text tabular-nums">{value}</span>
        <span className="mt-1 block font-mono-ui text-[10px] font-bold uppercase tracking-[0.1em] text-air-faint">{label}</span>
      </span>
    </button>
  );
}

function AgentRow({ agent, breakLimit, children, action }: { agent: FloorAgent; breakLimit: number; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-[12px] border border-air-line/15 transition hover:border-air-line/40 hover:bg-air-line/[0.04]">
      <Link href={`/agents/${agent.id}`} className="min-w-0 flex-1 rounded-[12px] px-3.5 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-air-mint">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className={`rounded-full border px-2 py-1 font-mono-ui text-[9px] font-bold uppercase tracking-[0.08em] ${STATUS_STYLE[agent.status]}`}>
            {STATUS_LABEL[agent.status]}
          </span>
          {agent.since && (
            <Elapsed since={agent.since} limitSeconds={agent.status === 'ON_BREAK' ? breakLimit : undefined} />
          )}
        </div>
        <p className="truncate text-[13.5px] font-semibold text-air-text">{agent.name}</p>
        {children}
      </Link>
      {action && <div className="px-3.5 pb-3">{action}</div>}
    </div>
  );
}

export default function LiveFloor({ token }: { token: string | null }) {
  const { data, error } = useQuietPoll<FloorView>(
    token ? async () => (await admin.floor(token)).data : null,
    POLL_MS,
    // Ignore the server timestamp: re-render only when an agent's state changes.
    (view) => JSON.stringify({ counts: view.counts, agents: view.agents }),
  );
  // From the server, so the view and the rule always agree.
  const breakLimit = data?.breakMaxSeconds ?? 60 * 60;
  // Live listening: a snapshot of the agent, so the panel stays put while the
  // floor refreshes (and after the call ends).
  const [listening, setListening] = useState<{ agent: FloorAgent; audio: AudioContext } | null>(null);
  const listeningTo = listening?.agent ?? null;
  const [filter, setFilter] = useState<'ALL' | FloorAgent['status']>('ALL');

  const onCall = data?.agents.filter((a) => a.status === 'ON_CALL') ?? [];
  const onBreak = data?.agents.filter((a) => a.status === 'ON_BREAK') ?? [];
  const idle = data?.agents.filter((a) => a.status === 'NOT_ON_CALL') ?? [];
  const agents = filter === 'ALL' ? [...onCall, ...onBreak, ...idle]
    : filter === 'ON_CALL' ? onCall : filter === 'ON_BREAK' ? onBreak : idle;
  const emptyMessage = filter === 'ON_CALL' ? 'Nobody is on a call.'
    : filter === 'ON_BREAK' ? 'Nobody is on a break.'
      : filter === 'NOT_ON_CALL' ? 'No agents are currently off call.' : 'No agents to show.';

  return (
    <section className="air-panel mb-6 rounded-[20px] border p-5 lg:p-6 backdrop-blur-lg" aria-label="Live floor">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2.5 font-display text-[20px] font-bold tracking-[-0.02em] text-air-text">
          <span className="h-5 w-1 rounded-full bg-gradient-to-b from-air-live to-air-amber" aria-hidden />
          Live floor
        </h2>
        <span className="inline-flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.14em] text-air-faint">
          <span className={`h-1.5 w-1.5 rounded-full ${error ? 'bg-air-live' : 'bg-air-mint animate-air-blink'}`} aria-hidden />
          {error ? 'Reconnecting…' : 'Updates automatically'}
        </span>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <CountTile label="On a call" value={data ? data.counts.onCall : '—'} tone="live" pulse={!!data && data.counts.onCall > 0} selected={filter === 'ON_CALL'} onClick={() => setFilter('ON_CALL')} />
        <CountTile label="On break" value={data ? data.counts.onBreak : '—'} tone="amber" selected={filter === 'ON_BREAK'} onClick={() => setFilter('ON_BREAK')} />
        <CountTile label="Not on a call" value={data ? data.counts.notOnCall : '—'} tone="muted" selected={filter === 'NOT_ON_CALL'} onClick={() => setFilter('NOT_ON_CALL')} />
      </div>

      {!data ? (
        <p className="py-4 text-center font-mono-ui text-[11px] uppercase tracking-[0.12em] text-air-faint">
          {error ? `Could not load the floor: ${error}` : 'Loading the floor…'}
        </p>
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 aria-live="polite" className="font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.1em] text-air-muted">
              {filter === 'ALL' ? 'All agents' : STATUS_LABEL[filter]} ({agents.length})
            </h3>
            <button
              type="button"
              onClick={() => setFilter('ALL')}
              aria-pressed={filter === 'ALL'}
              className={`rounded-full border px-3 py-1.5 font-mono-ui text-[10px] font-bold uppercase tracking-[0.08em] transition hover:border-air-mint/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-air-mint ${filter === 'ALL' ? 'border-air-mint/50 bg-air-mint/[0.08] text-air-mint' : 'border-air-line/20 text-air-muted'}`}
            >
              All agents
            </button>
          </div>
          {agents.length === 0 ? (
            <p className="py-4 text-center text-[12.5px] text-air-faint">{emptyMessage}</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {agents.map((a) => (
                <AgentRow
                  key={a.id}
                  agent={a}
                  breakLimit={breakLimit}
                  action={a.status === 'ON_CALL' && a.listenable && a.sessionId ? (
                    <button
                      type="button"
                      // The audio context is made here, inside the click, or browsers may keep it silent.
                      onClick={() => setListening({ agent: a, audio: audioContextFromClick() })}
                      disabled={listeningTo?.sessionId === a.sessionId}
                      aria-label={`Listen to ${a.name}'s call`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-air-live/40 bg-air-live/[0.08] px-2.5 py-1 font-mono-ui text-[10px] font-bold uppercase tracking-[0.1em] text-air-live transition hover:bg-air-live/[0.16] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-air-live disabled:opacity-50"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-air-live" aria-hidden />
                      {listeningTo?.sessionId === a.sessionId ? 'Listening' : 'Listen'}
                    </button>
                  ) : undefined}
                >
                  {a.status === 'ON_CALL' ? (
                    <p className="truncate text-[12px] text-air-muted">
                      {a.customerName ?? 'Customer'}
                      {a.campaign ? ` · ${a.campaign.replace('_', ' ')}` : ''}
                    </p>
                  ) : a.status === 'ON_BREAK' ? (
                    <p className="truncate text-[12px] text-air-muted">{BREAK_LABEL[a.breakReason ?? ''] ?? 'Break'}</p>
                  ) : (
                    <p className="truncate text-[12px] text-air-muted">
                      {a.callsInQueue > 0 ? `${a.callsInQueue} call${a.callsInQueue === 1 ? '' : 's'} in queue` : 'No calls in queue'}
                    </p>
                  )}
                </AgentRow>
              ))}
            </div>
          )}
        </div>
      )}

      {listening && token && (
        // Keyed by call: switching calls tears the old connection down first.
        <LiveListener
          key={listening.agent.sessionId}
          agent={listening.agent}
          audio={listening.audio}
          token={token}
          onClose={() => setListening(null)}
        />
      )}
    </section>
  );
}
