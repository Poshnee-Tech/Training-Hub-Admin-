'use client';

/**
 * Record narration in the portal instead of uploading a file.
 *
 * MediaRecorder writes whatever container the browser prefers — Chrome and
 * Edge give webm/opus, Safari gives mp4/aac. Both are fine: the backend accepts
 * any `audio/*` and streams the bytes back untouched, and every browser that
 * can record can also play what it recorded. The chosen mime type is read back
 * off the recorder rather than assumed, so the filename extension and the
 * File's type always match what was actually captured.
 *
 * The stream's tracks are stopped on every exit path. Leaving them live keeps
 * the browser's recording indicator on after the panel closes, which reads as
 * the portal still listening.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** Container preferences in order; the first the browser admits to wins. */
const CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return CANDIDATES.find((t) => MediaRecorder.isTypeSupported?.(t));
}

function extensionFor(mime: string): string {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

// Local rather than the global .btn-* classes: those are built on white and
// grey, and only had a dark-theme remap, so on the bright theme they punched
// holes in the warm surface this panel sits on.
const SOLID =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-bean-brand to-bean-brand-bright px-3.5 py-2 text-[13px] font-semibold text-white transition duration-150 hover:-translate-y-px disabled:translate-y-0 disabled:opacity-50';
const QUIET =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-bean-line bg-bean-card px-3.5 py-2 text-[13px] font-semibold text-bean-muted transition duration-150 hover:border-bean-line2 hover:text-bean-ink disabled:opacity-50';

function fmt(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export default function AudioRecorder({
  onDone,
  onCancel,
  busy,
}: {
  /** Called with the finished take; the caller uploads and closes the panel. */
  onDone: (file: File) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'paused' | 'ready'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const fileRef = useRef<File | null>(null);
  const tickRef = useRef<number | null>(null);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Whatever ends the panel — cancelling, saving, navigating — releases the
  // microphone and the preview URL.
  useEffect(() => {
    return () => {
      stopTracks();
      if (tickRef.current) window.clearInterval(tickRef.current);
      if (preview) URL.revokeObjectURL(preview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startTimer() {
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
  }

  function stopTimer() {
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = null;
  }

  async function start() {
    setError('');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot record audio. Upload a file instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        // Read the type off the recorder — the browser may have fallen back to
        // something other than the container that was asked for.
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const name = `recording-${new Date().toISOString().replace(/[:.]/g, '-')}.${extensionFor(type)}`;
        fileRef.current = new File([blob], name, { type });

        setPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        setState('ready');
        stopTracks();
      };

      recorder.start(250);
      setElapsed(0);
      setState('recording');
      startTimer();
    } catch (err: any) {
      // A denied permission prompt is the common case and deserves its own line.
      setError(
        err?.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser, then try again.'
          : err?.message || 'Could not start recording.',
      );
      stopTracks();
    }
  }

  function pause() {
    recorderRef.current?.pause();
    stopTimer();
    setState('paused');
  }

  function resume() {
    recorderRef.current?.resume();
    startTimer();
    setState('recording');
  }

  function stop() {
    stopTimer();
    recorderRef.current?.stop();
  }

  function discard() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    fileRef.current = null;
    chunksRef.current = [];
    setElapsed(0);
    setState('idle');
  }

  const live = state === 'recording' || state === 'paused';

  return (
    <div className="rounded-xl border border-bean-line bg-bean-card2 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
            state === 'recording'
              ? 'bg-bean-live/15 text-bean-live'
              : 'bg-bean-card text-bean-muted'
          }`}
        >
          {state === 'recording' ? (
            <span className="h-3 w-3 rounded-full bg-bean-live animate-bean-blink" />
          ) : (
            <MicGlyph className="h-[18px] w-[18px] stroke-current" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-bean-ink">
            {state === 'idle' && 'Record narration'}
            {state === 'recording' && 'Recording…'}
            {state === 'paused' && 'Paused'}
            {state === 'ready' && 'Take ready'}
          </p>
          <p className="font-mono-ui text-[11px] tracking-[0.04em] text-bean-faint">
            {live || state === 'ready' ? fmt(elapsed) : 'Uses your microphone'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {state === 'idle' && (
            <button type="button" onClick={start} className={SOLID}>
              Start recording
            </button>
          )}
          {state === 'recording' && (
            <>
              <button type="button" onClick={pause} className={QUIET}>Pause</button>
              <button type="button" onClick={stop} className={SOLID}>Stop</button>
            </>
          )}
          {state === 'paused' && (
            <>
              <button type="button" onClick={resume} className={QUIET}>Resume</button>
              <button type="button" onClick={stop} className={SOLID}>Stop</button>
            </>
          )}
          {state === 'ready' && (
            <>
              <button type="button" onClick={discard} className={QUIET}>
                Record again
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current && onDone(fileRef.current)}
                className={SOLID}
              >
                {busy ? 'Saving…' : 'Save recording'}
              </button>
            </>
          )}
          <button type="button" onClick={onCancel} className={QUIET}>
            Cancel
          </button>
        </div>
      </div>

      {/* Hear the take before committing it — an unusable recording should be
          caught here, not by an agent on the guide. */}
      {preview && (
        <audio controls src={preview} className="mt-3 w-full">
          Your browser cannot play this recording.
        </audio>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-bean-live/40 bg-bean-live/10 px-3 py-2 text-[12.5px] font-medium text-bean-live">
          {error}
        </p>
      )}
    </div>
  );
}

function MicGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" strokeWidth={1.9} viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
      />
    </svg>
  );
}
