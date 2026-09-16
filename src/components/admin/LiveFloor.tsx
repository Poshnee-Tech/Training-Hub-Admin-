'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { admin, type FloorAgent, type FloorView } from '@/lib/api';
import { useQuietPoll } from '@/lib/use-quiet-poll';

/**
 * LIVE FLOOR — who is on a call, who is on a break, who is neither, right now.
 *
 * Polled every few seconds in the background (useQuietPoll): the section only
 * re-renders when an agent's state actually changes. The running clocks tick
 * on their own, so they move without refetching anything.
 */

const POLL_MS = 5000;

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

function CountTile({ label, value, tone, pulse }: { label: string; value: number | string; tone: 'live' | 'amber' | 'muted'; pulse?: boolean }) {
  const dot = tone === 'live' ? 'bg-air-live' : tone === 'amber' ? 'bg-air-amber' : 'bg-air-faint';
  return (
    <div className="air-panel flex items-center gap-3 rounded-[16px] border px-4 py-3">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot} ${pulse ? 'animate-air-blink' : ''}`} aria-hidden />
      <div className="min-w-0">
        <div className="font-display text-[26px] font-extrabold leading-none tracking-[-0.03em] text-air-text tabular-nums">{value}</div>
        <div className="mt-1 font-mono-ui text-[10px] font-bold uppercase tracking-[0.1em] text-air-faint">{label}</div>
      </div>
    </div>
  );
}

function AgentRow({ agent, breakLimit, children }: { agent: FloorAgent; breakLimit: number; children: React.ReactNode }) {
  return (
    <Link
      href={`/agents/${agent.id}`}
      className="flex items-center justify-between gap-3 rounded-[12px] border border-air-line/15 px-3.5 py-2.5 transition hover:border-air-line/40 hover:bg-air-line/[0.04]"
    >
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-semibold text-air-text">{agent.name}</p>
        {children}
      </div>
      {agent.since && (
        <Elapsed since={agent.since} limitSeconds={agent.status === 'ON_BREAK' ? breakLimit : undefined} />
      )}
    </Link>
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

  const onCall = data?.agents.filter((a) => a.status === 'ON_CALL') ?? [];
  const onBreak = data?.agents.filter((a) => a.status === 'ON_BREAK') ?? [];
  const idle = data?.agents.filter((a) => a.status === 'NOT_ON_CALL') ?? [];

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
        <CountTile label="On a call" value={data ? data.counts.onCall : '—'} tone="live" pulse={!!data && data.counts.onCall > 0} />
        <CountTile label="On break" value={data ? data.counts.onBreak : '—'} tone="amber" />
        <CountTile label="Not on a call" value={data ? data.counts.notOnCall : '—'} tone="muted" />
      </div>

      {!data ? (
        <p className="py-4 text-center font-mono-ui text-[11px] uppercase tracking-[0.12em] text-air-faint">
          {error ? `Could not load the floor: ${error}` : 'Loading the floor…'}
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <div>
            <h3 className="mb-2 font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.1em] text-air-live">On a call ({onCall.length})</h3>
            {onCall.length === 0 ? (
              <p className="text-[12.5px] text-air-faint">Nobody is on a call.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {onCall.map((a) => (
                  <AgentRow key={a.id} agent={a} breakLimit={breakLimit}>
                    <p className="truncate text-[12px] text-air-muted">
                      {a.customerName ?? 'Customer'}
                      {a.campaign ? ` · ${a.campaign.replace('_', ' ')}` : ''}
                    </p>
                  </AgentRow>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-2 font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.1em] text-air-amber">On break ({onBreak.length})</h3>
            {onBreak.length === 0 ? (
              <p className="text-[12.5px] text-air-faint">Nobody is on a break.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {onBreak.map((a) => (
                  <AgentRow key={a.id} agent={a} breakLimit={breakLimit}>
                    <p className="truncate text-[12px] text-air-muted">{BREAK_LABEL[a.breakReason ?? ''] ?? 'Break'}</p>
                  </AgentRow>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-2 font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.1em] text-air-faint">Not on a call ({idle.length})</h3>
            {idle.length === 0 ? (
              <p className="text-[12.5px] text-air-faint">Every agent is busy.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {idle.map((a) => (
                  <AgentRow key={a.id} agent={a} breakLimit={breakLimit}>
                    <p className="truncate text-[12px] text-air-muted">
                      {a.callsInQueue > 0 ? `${a.callsInQueue} call${a.callsInQueue === 1 ? '' : 's'} in queue` : 'No calls in queue'}
                    </p>
                  </AgentRow>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
