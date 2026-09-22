'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { admin, WS_URL, type FloorAgent } from '@/lib/api';

/**
 * LIVE LISTENING — hear an agent's call while it happens. Listen only: nothing
 * is ever sent to the call, and the agent is not told.
 *
 * The backend sends a copy of the call: binary frames (byte 0 = track, then
 * 16-bit mono PCM) and small JSON events. Agent audio arrives in real time;
 * customer audio arrives in bursts faster than real time, so each track has
 * its own playback cursor, exactly as the agent's browser queues the customer.
 * A barge-in cuts the queued customer audio, as it does for the agent.
 */

const TRACK_AGENT = 1;
const TRACK_CUSTOMER = 2;
/** Small start cushion so network jitter does not chop words. */
const LEAD_SECONDS = 0.25;
/** Agent audio should never lag this far; if it does, jump back to live. */
const AGENT_MAX_LAG_SECONDS = 1.5;

type Status = 'connecting' | 'live' | 'agent_away' | 'ended' | 'error';
/** A saved transcript line: `id` is its identity, `sequence` its place in the call. */
interface Line { id: string; sequence: number; role: 'agent' | 'customer'; text: string }

/** Longest the end of a call may keep playing after it ends, before audio is released. */
const END_TAIL_MAX_SECONDS = 8;

export class ListenPlayer {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly agentOut: StereoPannerNode;
  private readonly customerOut: StereoPannerNode;
  private agentCursor = 0;
  private customerCursor = 0;
  private readonly agentSources = new Set<AudioBufferSourceNode>();
  private readonly customerSources = new Set<AudioBufferSourceNode>();
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private released = false;
  agentRate = 16000;
  customerRate = 24000;

  constructor(ctx: AudioContext = new AudioContext()) {
    this.ctx = ctx;
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    // Agent a little left, customer a little right: separable, not fatiguing.
    this.agentOut = new StereoPannerNode(this.ctx, { pan: -0.35 });
    this.customerOut = new StereoPannerNode(this.ctx, { pan: 0.35 });
    this.agentOut.connect(this.master);
    this.customerOut.connect(this.master);
  }

  get isReleased() {
    return this.released;
  }

  setVolume(v: number) {
    if (!this.released) this.master.gain.value = v;
  }

  play(data: ArrayBuffer) {
    if (this.released || this.releaseTimer || data.byteLength < 3) return;
    const track = new Uint8Array(data, 0, 1)[0];
    const isAgent = track === TRACK_AGENT;
    if (!isAgent && track !== TRACK_CUSTOMER) return;
    const sampleCount = Math.floor((data.byteLength - 1) / 2);
    const pcm = new Int16Array(data.slice(1, 1 + sampleCount * 2));

    const buffer = this.ctx.createBuffer(1, pcm.length, isAgent ? this.agentRate : this.customerRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 32768;

    const now = this.ctx.currentTime;
    if (isAgent) {
      if (this.agentCursor - now > AGENT_MAX_LAG_SECONDS) {
        // Fallen behind live: discard what is still queued rather than
        // scheduling new audio on top of it.
        this.stopAll(this.agentSources);
        this.agentCursor = 0;
      }
      if (this.agentCursor < now) this.agentCursor = now + LEAD_SECONDS;
      this.schedule(buffer, this.agentOut, this.agentSources, this.agentCursor);
      this.agentCursor += buffer.duration;
    } else {
      if (this.customerCursor < now) this.customerCursor = now + LEAD_SECONDS;
      this.schedule(buffer, this.customerOut, this.customerSources, this.customerCursor);
      this.customerCursor += buffer.duration;
    }
  }

  private schedule(buffer: AudioBuffer, out: AudioNode, sources: Set<AudioBufferSourceNode>, at: number) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(out);
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      try { source.disconnect(); } catch { /* already disconnected */ }
    };
    source.start(at);
  }

  private stopAll(sources: Set<AudioBufferSourceNode>) {
    for (const s of sources) {
      try { s.stop(); } catch { /* already stopped */ }
      try { s.disconnect(); } catch { /* already disconnected */ }
    }
    sources.clear();
  }

  /** The agent cut in: the customer stops, as she does on the agent's side. */
  cutCustomer() {
    this.stopAll(this.customerSources);
    this.customerCursor = 0;
  }

  /** Connection lost or replaced: nothing queued from the old connection may play. */
  reset() {
    this.stopAll(this.agentSources);
    this.stopAll(this.customerSources);
    this.agentCursor = 0;
    this.customerCursor = 0;
  }

  /** The call ended: let what is already scheduled finish (bounded), then release. */
  releaseAfterTail() {
    if (this.released || this.releaseTimer) return;
    const remaining = Math.max(this.agentCursor, this.customerCursor) - this.ctx.currentTime;
    const seconds = Math.min(Math.max(remaining, 0), END_TAIL_MAX_SECONDS);
    this.releaseTimer = setTimeout(() => this.release(), seconds * 1000);
  }

  /** Stop everything and free the audio device. Idempotent. */
  release() {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    if (this.released) return;
    this.released = true;
    this.reset();
    void this.ctx.close().catch(() => {});
  }
}

function clock(seconds: number) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

const CLOSE_REASON: Record<number, string> = {
  4001: 'The listen link expired. Try again.',
  4003: 'Your account is not allowed to listen.',
  4004: 'This call is no longer live.',
  4008: 'Too many people are already listening to this call.',
  4010: 'Your connection fell too far behind. Try again.',
  4011: 'Live listening is turned off on the server.',
};

/**
 * An AudioContext made and resumed INSIDE a click. Browsers (Safari strictly)
 * only let a page start audio from a user gesture; a context created later, in
 * an effect after network round trips, can stay suspended and silent.
 */
export function audioContextFromClick(): AudioContext {
  const ctx = new AudioContext();
  void ctx.resume().catch(() => {});
  return ctx;
}

export default function LiveListener({
  agent,
  token,
  onClose,
  audio,
}: {
  agent: FloorAgent;
  token: string;
  onClose: () => void;
  /** From `audioContextFromClick()` in the Listen button's click handler. */
  audio: AudioContext;
}) {
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [startedAt, setStartedAt] = useState<string | null>(agent.since);
  const [now, setNow] = useState(() => Date.now());
  const [volume, setVolume] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const playerRef = useRef<ListenPlayer | null>(null);
  /**
   * ── THE PANEL HANGS OFF THE PAGE, NOT OFF THE FLOOR CARD ───────────────────
   * It is rendered from inside the Live floor section, which carries
   * `backdrop-blur`. A backdrop filter makes that section the containing block
   * for `position: fixed` descendants, so the panel docked to the CARD's
   * bottom-right and hung off the top of the screen, its header cut away.
   * A portal puts it on <body>, where `fixed` means the window again.
   */
  /** The click-made context for the next connection attempt (the Listen click, or "Listen again"). */
  const nextAudioRef = useRef<AudioContext | null>(audio);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  useEffect(() => {
    playerRef.current?.setVolume(volume);
  }, [volume]);


  useEffect(() => {
    if (!agent.sessionId) return;
    let cancelled = false;
    let socket: WebSocket | null = null;
    let ended = false;
    let player: ListenPlayer | null = null;

    const connect = async (player: ListenPlayer) => {
      try {
        const { data } = await admin.listenTicket(token, agent.sessionId!);
        if (cancelled) return;
        socket = new WebSocket(WS_URL, data.ticket);
        socket.binaryType = 'arraybuffer';
        socket.onmessage = (event) => {
          if (typeof event.data !== 'string') {
            player.play(event.data as ArrayBuffer);
            return;
          }
          let msg: any;
          try { msg = JSON.parse(event.data); } catch { return; }
          switch (msg.type) {
            case 'listen_ready':
              player.agentRate = msg.agentSampleRate;
              player.customerRate = msg.customerSampleRate;
              setLines(msg.history ?? []);
              if (msg.startedAt) setStartedAt(msg.startedAt);
              setStatus(msg.agentConnected ? 'live' : 'agent_away');
              if (player.ctx.state === 'suspended') void player.ctx.resume();
              break;
            case 'transcript':
              // Saved lines, each sent once; a line saved late still goes in its place.
              setLines((prev) => (prev.some((l) => l.id === msg.id)
                ? prev
                : [...prev, { id: msg.id, sequence: msg.sequence, role: msg.role, text: msg.text }].sort((a, b) => a.sequence - b.sequence)));
              break;
            case 'barge_in':
              player.cutCustomer();
              break;
            case 'agent_connected':
              // A new agent connection: nothing queued from the old one plays.
              player.reset();
              setStatus('live');
              break;
            case 'agent_disconnected':
              player.reset();
              setStatus('agent_away');
              break;
            case 'call_ended':
              ended = true;
              player.releaseAfterTail();
              setStatus('ended');
              break;
          }
        };
        socket.onclose = (event) => {
          if (cancelled) return;
          if (ended || event.code === 1000) {
            player.releaseAfterTail();
            setStatus('ended');
            return;
          }
          player.release();
          setStatus('error');
          setError(CLOSE_REASON[event.code] ?? 'The connection dropped.');
        };
      } catch (err) {
        if (cancelled) return;
        player.release();
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Could not start listening.');
      }
    };

    // Claim the click-made context now; the connection itself starts one tick
    // later, so React's development double-run cancels the first run before it
    // mints a listen ticket.
    const clicked = nextAudioRef.current;
    nextAudioRef.current = null;
    const start = setTimeout(() => {
      if (cancelled) return;
      player = new ListenPlayer(clicked && clicked.state !== 'closed' ? clicked : new AudioContext());
      player.setVolume(volume);
      playerRef.current = player;
      void connect(player);
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(start);
      try { socket?.close(1000, 'Stopped listening'); } catch { /* already closed */ }
      if (player) {
        player.release();
        if (playerRef.current === player) playerRef.current = null;
      } else if (clicked) {
        // Never started. Hand the click-made context back for an immediate
        // re-run (React's development double-run) to claim; if nothing claims
        // it by the next tick, the panel really closed — release it.
        nextAudioRef.current = clicked;
        setTimeout(() => {
          if (nextAudioRef.current !== clicked) return;
          nextAudioRef.current = null;
          void clicked.close().catch(() => {});
        }, 0);
      }
    };
    // `volume` is applied by its own effect; reconnecting on a volume change would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.sessionId, token, attempt]);

  const stop = useCallback(() => onClose(), [onClose]);

  const statusText: Record<Status, string> = {
    connecting: 'Connecting…',
    live: 'Live',
    agent_away: 'Agent reconnecting…',
    ended: 'Call ended',
    error: error ?? 'Disconnected',
  };
  const elapsed = startedAt ? Math.floor((now - new Date(startedAt).getTime()) / 1000) : null;

  // Only ever rendered from a click, so there is no server render to match.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-label={`Listening to ${agent.name}`}
      className="air-panel fixed inset-x-4 bottom-4 z-50 flex max-h-[70vh] flex-col rounded-[20px] border p-4 shadow-2xl backdrop-blur-lg sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[420px]"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-mono-ui text-[10px] font-bold uppercase tracking-[0.14em] text-air-live">
            <span className={`h-2 w-2 rounded-full ${status === 'live' ? 'bg-air-live animate-air-blink' : status === 'ended' ? 'bg-air-faint' : 'bg-air-amber'}`} aria-hidden />
            {status === 'live' ? 'Listening live' : statusText[status]}
          </p>
          <p className="mt-1 truncate text-[15px] font-semibold text-air-text">{agent.name}</p>
          <p className="truncate text-[12px] text-air-muted">
            with {agent.customerName ?? 'Customer'}
            {elapsed !== null && status !== 'ended' ? ` · ${clock(elapsed)}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={stop}
          className="shrink-0 rounded-full border border-air-line/30 px-3 py-1.5 font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.1em] text-air-text transition hover:border-air-live/50 hover:text-air-live"
        >
          {status === 'ended' || status === 'error' ? 'Close' : 'Stop'}
        </button>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <span className="font-mono-ui text-[10px] uppercase tracking-[0.1em] text-air-faint">Volume</span>
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="flex-1"
          aria-label="Listening volume"
        />
        <span className="font-mono-ui text-[10px] text-air-faint">L agent · R customer</span>
      </div>

      {status === 'error' && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-[12px] border border-air-live/30 bg-air-live/[0.06] px-3 py-2">
          <p className="text-[12.5px] text-air-text">{error}</p>
          <button
            type="button"
            onClick={() => {
              nextAudioRef.current?.close().catch(() => {});
              nextAudioRef.current = audioContextFromClick();
              setStatus('connecting');
              setError(null);
              setAttempt((a) => a + 1);
            }}
            className="shrink-0 font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.1em] text-air-live hover:underline"
          >
            Listen again
          </button>
        </div>
      )}

      <div ref={transcriptRef} className="min-h-[120px] flex-1 overflow-y-auto rounded-[12px] border border-air-line/15 p-3" aria-live="polite">
        {lines.length === 0 ? (
          <p className="text-[12.5px] text-air-faint">Each line appears here a moment after it is spoken.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {lines.map((line) => (
              <div key={line.id} className={line.role === 'agent' ? 'text-right' : 'text-left'}>
                <span className="block font-mono-ui text-[9.5px] uppercase tracking-[0.12em] text-air-faint">
                  {line.role === 'agent' ? 'Agent' : 'Customer'}
                </span>
                <span className={`inline-block max-w-[85%] rounded-[10px] px-2.5 py-1.5 text-[13px] ${line.role === 'agent' ? 'bg-air-line/[0.08] text-air-text' : 'bg-air-live/[0.08] text-air-text'}`}>
                  {line.text}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
