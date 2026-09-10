'use client';

/**
 * Call recordings.
 *
 * One stereo WAV per call: the trainee on the LEFT channel, the customer on the
 * RIGHT. Audio is fetched through the authenticated backend and wrapped in a
 * blob URL so the bearer token is preserved.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminSidebar from '@/components/layout/AdminSidebar';
import { useAuthStore } from '@/store/auth.store';
import { admin } from '@/lib/api';
import { formatDate, formatDuration } from '@/lib/utils';

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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
    case 'HARD':
      return 'border-bean-live/35 bg-bean-live/10 text-bean-live';
    default:
      return 'border-bean-line bg-bean-card2 text-bean-muted';
  }
}

export default function RecordingsPage() {
  const { token, loadFromStorage } = useAuthStore();

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const objectUrlRef = useRef<string | null>(null);

  const releaseAudio = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    setAudioUrl(null);
    setPlayingId(null);
  }, []);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => () => releaseAudio(), [releaseAudio]);

  const load = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError(null);

    try {
      const res = await admin.listRecordings(token, {
        page: String(page),
        limit: '15',
      });

      setRows(res.data || []);
      setPagination(res.pagination);
    } catch (err: any) {
      setError(err?.message || 'Could not load recordings.');
    } finally {
      setLoading(false);
    }
  }, [token, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function play(sessionId: string) {
    if (!token) return;

    if (playingId === sessionId) {
      releaseAudio();
      return;
    }

    releaseAudio();
    setLoadingAudio(sessionId);
    setError(null);

    try {
      const url = await admin.recordingBlobUrl(token, sessionId);
      objectUrlRef.current = url;
      setAudioUrl(url);
      setPlayingId(sessionId);
    } catch (err: any) {
      setError(err?.message || 'Could not load that recording.');
    } finally {
      setLoadingAudio(null);
    }
  }

  async function remove(sessionId: string) {
    if (!token) return;

    setDeleting(sessionId);
    setError(null);

    try {
      if (playingId === sessionId) releaseAudio();

      await admin.deleteRecording(token, sessionId);
      setConfirmId(null);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not delete that recording.');
    } finally {
      setDeleting(null);
    }
  }

  const playingRow = rows.find((row) => row.id === playingId) ?? null;

  const stats = useMemo(() => {
    const available = rows.filter((row) => row.fileAvailable).length;
    const missing = rows.length - available;
    const totalSeconds = rows.reduce(
      (sum, row) => sum + (Number(row.durationSeconds) || 0),
      0,
    );
    const totalBytes = rows.reduce(
      (sum, row) => sum + (Number(row.bytes) || 0),
      0,
    );

    return {
      available,
      missing,
      totalSeconds,
      totalBytes,
    };
  }, [rows]);

  const totalRecordings =
    typeof pagination?.total === 'number' ? pagination.total : rows.length;

  return (
    <div className="flex">
      <AdminSidebar />

      <main className="bean-scope relative ml-64 min-h-screen flex-1 bg-bean-bg px-6 py-7 font-body text-bean-ink antialiased lg:px-8">
        <div className="mx-auto w-full max-w-[1500px]">
          {/* Header */}
          <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-bean-brand" />
                <span className="font-mono-ui text-[11px] font-bold uppercase tracking-[0.12em] text-bean-faint">
                  Call media
                </span>
              </div>

              <h1 className="font-display text-[28px] font-extrabold tracking-[-0.035em] text-bean-ink">
                Call Recordings
              </h1>

              <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-bean-muted">
                Listen to both sides of completed training calls. The trainee is on
                the left stereo channel and the customer is on the right.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="bean-card inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-semibold text-bean-muted transition hover:border-bean-line2 hover:text-bean-ink disabled:opacity-50"
            >
              <RefreshGlyph
                className={`h-4 w-4 stroke-current ${loading ? 'animate-spin' : ''}`}
              />
              Refresh
            </button>
          </header>

          {/* Page snapshot */}
          {!loading && (
            <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard
                label="Total recordings"
                value={totalRecordings}
                helper="Across all pages"
              />
              <MetricCard
                label="Files available"
                value={stats.available}
                helper={
                  stats.missing
                    ? `${stats.missing} missing on this page`
                    : 'All files present on page'
                }
              />
              <MetricCard
                label="Audio on page"
                value={
                  stats.totalSeconds > 0
                    ? formatDuration(stats.totalSeconds)
                    : '—'
                }
                helper={`${rows.length} recording${rows.length === 1 ? '' : 's'} loaded`}
              />
              <MetricCard
                label="Storage on page"
                value={
                  stats.totalBytes > 0
                    ? formatBytes(stats.totalBytes)
                    : '—'
                }
                helper="Loaded recording files"
              />
            </section>
          )}

          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start justify-between gap-4 rounded-2xl border border-bean-live/40 bg-bean-live/10 px-4 py-3.5"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bean-live/15 text-[12px] font-bold text-bean-live">
                  !
                </span>
                <p className="min-w-0 text-[13.5px] font-medium leading-relaxed text-bean-live">
                  {error}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => void load()}
                  className="text-[12.5px] font-semibold text-bean-live"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="text-[12.5px] font-semibold text-bean-muted hover:text-bean-ink"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Player */}
          {audioUrl && (
            <section className="bean-card mb-5 overflow-hidden rounded-[18px] border">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-bean-line bg-bean-card2/60 px-5 py-3.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-bean-brand/30 bg-bean-brand/10 px-2.5 py-1 font-mono-ui text-[9.5px] font-bold uppercase tracking-[0.08em] text-bean-brand">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-bean-brand" />
                      Now playing
                    </span>

                    {playingRow?.scenario?.campaign && (
                      <Chip className={campaignChip(playingRow.scenario.campaign)}>
                        {playingRow.scenario.campaign.replace('_', ' ')}
                      </Chip>
                    )}
                  </div>

                  <h2 className="mt-2 truncate text-[14px] font-bold text-bean-ink">
                    {playingRow?.scenario?.name || 'Call recording'}
                  </h2>

                  <p className="mt-0.5 text-[11.5px] text-bean-muted">
                    Left channel = trainee · Right channel = customer
                  </p>
                </div>

                <button
                  type="button"
                  onClick={releaseAudio}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-bean-line bg-bean-card text-bean-muted transition hover:text-bean-ink"
                  aria-label="Close audio player"
                >
                  <CloseGlyph className="h-3.5 w-3.5 stroke-current" />
                </button>
              </div>

              <div className="px-5 py-4">
                <audio
                  key={audioUrl}
                  src={audioUrl}
                  controls
                  autoPlay
                  className="w-full"
                  onEnded={releaseAudio}
                />
              </div>
            </section>
          )}

          {/* Ledger heading */}
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-bold tracking-[-0.01em] text-bean-ink">
                Recording ledger
              </h2>
              <p className="mt-0.5 text-[12.5px] text-bean-muted">
                Audio is loaded only when you press Listen and is released when playback closes.
              </p>
            </div>

            <span className="font-mono-ui text-[10px] uppercase tracking-[0.1em] text-bean-faint">
              {loading
                ? 'Loading…'
                : `${rows.length} recording${rows.length === 1 ? '' : 's'} on page`}
            </span>
          </div>

          {loading && rows.length === 0 ? (
            <RecordingSkeleton />
          ) : rows.length === 0 ? (
            <div className="bean-card flex min-h-[320px] flex-col items-center justify-center rounded-[20px] border border-dashed px-6 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl border border-bean-line bg-bean-card2 text-bean-brand">
                <WaveGlyph className="h-5 w-5 stroke-current" />
              </div>

              <h3 className="mt-4 text-[15px] font-bold text-bean-ink">
                No recordings yet
              </h3>

              <p className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-bean-muted">
                Recordings appear here automatically after a call finishes and its
                audio file is saved.
              </p>
            </div>
          ) : (
            <section className="bean-card overflow-hidden rounded-[20px] border">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1040px]">
                  <thead>
                    <tr className="border-b border-bean-line bg-bean-card2/70 text-left font-mono-ui text-[10px] font-bold uppercase tracking-[0.08em] text-bean-faint">
                      <th className="px-5 py-3.5 lg:px-6">When</th>
                      <th className="px-5 py-3.5 lg:px-6">Agent</th>
                      <th className="px-5 py-3.5 lg:px-6">Scenario</th>
                      <th className="px-5 py-3.5 lg:px-6">Length</th>
                      <th className="px-5 py-3.5 lg:px-6">Size</th>
                      <th className="px-5 py-3.5 text-right lg:px-6">Actions</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-bean-line">
                    {rows.map((row) => {
                      const agentName =
                        `${row.user?.firstName ?? ''} ${row.user?.lastName ?? ''}`.trim() ||
                        row.user?.email ||
                        'Unknown agent';

                      const initials =
                        `${row.user?.firstName?.[0] ?? ''}${row.user?.lastName?.[0] ?? ''}`.toUpperCase();

                      const isPlaying = playingId === row.id;
                      const isConfirming = confirmId === row.id;

                      return (
                        <tr
                          key={row.id}
                          className={`transition-colors ${
                            isPlaying
                              ? 'bg-bean-brand/[0.06]'
                              : 'hover:bg-bean-card2/50'
                          }`}
                        >
                          <td className="whitespace-nowrap px-5 py-4 text-[12px] text-bean-muted lg:px-6">
                            {formatDate(row.createdAt)}
                          </td>

                          <td className="px-5 py-4 lg:px-6">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-bean-line bg-bean-card2 font-mono-ui text-[10.5px] font-bold text-bean-brand">
                                {initials || '·'}
                              </span>

                              <span className="min-w-0">
                                <span className="block truncate text-[13px] font-semibold text-bean-ink">
                                  {agentName}
                                </span>
                                {row.user?.email && agentName !== row.user.email && (
                                  <span className="mt-0.5 block truncate text-[10.5px] text-bean-faint">
                                    {row.user.email}
                                  </span>
                                )}
                              </span>
                            </div>
                          </td>

                          <td className="px-5 py-4 lg:px-6">
                            <div className="max-w-[320px]">
                              <div className="truncate text-[13px] font-medium text-bean-ink">
                                {row.scenario?.name ?? '—'}
                              </div>

                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {row.scenario?.campaign && (
                                  <Chip className={campaignChip(row.scenario.campaign)}>
                                    {row.scenario.campaign.replace('_', ' ')}
                                  </Chip>
                                )}

                                {row.scenario?.difficulty && (
                                  <Chip className={difficultyChip(row.scenario.difficulty)}>
                                    {row.scenario.difficulty}
                                  </Chip>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="whitespace-nowrap px-5 py-4 font-mono-ui text-[12px] text-bean-muted lg:px-6">
                            {row.durationSeconds
                              ? formatDuration(row.durationSeconds)
                              : '—'}
                          </td>

                          <td className="whitespace-nowrap px-5 py-4 font-mono-ui text-[12px] text-bean-muted lg:px-6">
                            {formatBytes(row.bytes)}
                          </td>

                          <td className="whitespace-nowrap px-5 py-4 text-right lg:px-6">
                            {!row.fileAvailable ? (
                              <span className="inline-flex items-center gap-1.5 rounded-lg border border-bean-line bg-bean-card2 px-2.5 py-1.5 text-[11px] font-semibold text-bean-faint">
                                <MissingGlyph className="h-3.5 w-3.5 stroke-current" />
                                File missing
                              </span>
                            ) : isConfirming ? (
                              <div className="inline-flex items-center gap-2 rounded-xl border border-bean-live/30 bg-bean-live/[0.05] p-1.5">
                                <span className="px-1 text-[11.5px] font-semibold text-bean-live">
                                  Delete permanently?
                                </span>

                                <Btn
                                  danger
                                  solid
                                  onClick={() => void remove(row.id)}
                                  disabled={deleting === row.id}
                                  className="px-2.5 py-1.5 text-[11.5px]"
                                >
                                  {deleting === row.id ? 'Deleting…' : 'Delete'}
                                </Btn>

                                <Btn
                                  onClick={() => setConfirmId(null)}
                                  disabled={deleting === row.id}
                                  className="px-2.5 py-1.5 text-[11.5px]"
                                >
                                  Keep
                                </Btn>
                              </div>
                            ) : (
                              <span className="inline-flex items-center gap-2">
                                <Btn
                                  tone="solid"
                                  onClick={() => void play(row.id)}
                                  disabled={loadingAudio === row.id}
                                  className="min-w-[88px] px-3 py-1.5 text-[11.5px]"
                                >
                                  {loadingAudio === row.id ? (
                                    <>
                                      <SpinnerGlyph className="h-3.5 w-3.5 animate-spin stroke-current" />
                                      Loading
                                    </>
                                  ) : isPlaying ? (
                                    <>
                                      <StopGlyph className="h-3.5 w-3.5 stroke-current" />
                                      Stop
                                    </>
                                  ) : (
                                    <>
                                      <PlayGlyph className="h-3.5 w-3.5 stroke-current" />
                                      Listen
                                    </>
                                  )}
                                </Btn>

                                <Btn
                                  danger
                                  onClick={() => {
                                    setConfirmId(row.id);
                                    setError(null);
                                  }}
                                  className="px-3 py-1.5 text-[11.5px]"
                                >
                                  <TrashGlyph className="h-3.5 w-3.5 stroke-current" />
                                  Delete
                                </Btn>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Pagination */}
          {pagination && pagination.total > pagination.limit && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-bean-line bg-bean-card px-4 py-3.5">
              <div>
                <p className="text-[12.5px] font-semibold text-bean-ink">
                  Page {pagination.page} of{' '}
                  {Math.max(1, Math.ceil(pagination.total / pagination.limit))}
                </p>
                <p className="mt-0.5 text-[10.5px] text-bean-faint">
                  {pagination.total} recording
                  {pagination.total === 1 ? '' : 's'} total
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Btn
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1 || loading}
                  className="px-3.5 py-2 text-[12px]"
                >
                  <ArrowLeftGlyph className="h-3.5 w-3.5 stroke-current" />
                  Previous
                </Btn>

                <Btn
                  onClick={() => setPage((current) => current + 1)}
                  disabled={
                    page * pagination.limit >= pagination.total || loading
                  }
                  className="px-3.5 py-2 text-[12px]"
                >
                  Next
                  <ArrowRightGlyph className="h-3.5 w-3.5 stroke-current" />
                </Btn>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-bean-line bg-bean-card px-4 py-3 text-[11.5px] leading-relaxed text-bean-muted">
            <span>
              Stereo layout: trainee on the left channel · customer on the right.
            </span>
            <span>
              Deleting a recording removes its stored audio permanently.
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: React.ReactNode;
  helper: string;
}) {
  return (
    <div className="bean-card rounded-[16px] border px-4 py-3.5">
      <div className="text-[11.5px] font-semibold text-bean-muted">{label}</div>
      <div className="mt-1 font-display text-[22px] font-extrabold tracking-[-0.03em] text-bean-ink">
        {value}
      </div>
      <div className="mt-0.5 text-[10.5px] text-bean-faint">{helper}</div>
    </div>
  );
}

function RecordingSkeleton() {
  return (
    <div className="bean-card overflow-hidden rounded-[20px] border">
      <div className="border-b border-bean-line bg-bean-card2/70 px-6 py-3.5">
        <div className="h-3 w-48 animate-pulse rounded bg-bean-line/60" />
      </div>

      {[0, 1, 2, 3, 4].map((item) => (
        <div
          key={item}
          className="grid min-w-[1040px] grid-cols-6 items-center gap-5 border-b border-bean-line px-6 py-4 last:border-b-0"
        >
          <div className="h-7 animate-pulse rounded-lg bg-bean-card2" />
          <div className="h-9 animate-pulse rounded-xl bg-bean-card2" />
          <div className="h-10 animate-pulse rounded-lg bg-bean-card2" />
          <div className="h-6 animate-pulse rounded-lg bg-bean-card2" />
          <div className="h-6 animate-pulse rounded-lg bg-bean-card2" />
          <div className="h-8 animate-pulse rounded-lg bg-bean-card2" />
        </div>
      ))}
    </div>
  );
}

/* ── controls ───────────────────────────────────────────────── */

function Chip({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={`admin-pill ${className}`}>{children}</span>;
}

function Btn({
  tone = 'quiet',
  danger,
  solid,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'solid' | 'quiet';
  danger?: boolean;
  solid?: boolean;
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition duration-150 disabled:cursor-not-allowed disabled:opacity-50';

  const look =
    tone === 'solid' || solid
      ? danger
        ? 'bg-bean-live text-white hover:bg-bean-live/90'
        : 'bg-gradient-to-r from-bean-brand to-bean-brand-bright text-white hover:-translate-y-px disabled:translate-y-0'
      : danger
        ? 'border border-bean-live/35 bg-bean-live/[0.08] text-bean-live hover:bg-bean-live/15'
        : 'border border-bean-line bg-bean-card text-bean-muted hover:border-bean-line2 hover:text-bean-ink';

  return <button {...rest} className={`${base} ${look} ${className}`} />;
}

/* ── glyphs ────────────────────────────────────────────────── */

const S = {
  fill: 'none',
  strokeWidth: 1.9,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
} as const;

const d = (path: string) => (
  <path strokeLinecap="round" strokeLinejoin="round" d={path} />
);

function RefreshGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {d('M20 6v5h-5M4 18v-5h5M18.4 9A7 7 0 0 0 6.2 6.2L4 8M5.6 15A7 7 0 0 0 17.8 17.8L20 16')}
    </svg>
  );
}

function CloseGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {d('M6 18 18 6M6 6l12 12')}
    </svg>
  );
}

function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {d('m8 5 11 7-11 7V5Z')}
    </svg>
  );
}

function StopGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {d('M7 7h10v10H7z')}
    </svg>
  );
}

function TrashGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {d('M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6')}
    </svg>
  );
}

function SpinnerGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {d('M21 12a9 9 0 1 1-9-9')}
    </svg>
  );
}

function MissingGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {d('M3 3l18 18M10 6H6v12h12v-4M14 6h4v4')}
    </svg>
  );
}

function WaveGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S}>
      {d('M4 10v4m4-7v10m4-14v18m4-14v10m4-7v4')}
    </svg>
  );
}

function ArrowLeftGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S} strokeWidth={2.2}>
      {d('M19 12H5m6 6-6-6 6-6')}
    </svg>
  );
}

function ArrowRightGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} {...S} strokeWidth={2.2}>
      {d('M5 12h14M13 6l6 6-6 6')}
    </svg>
  );
}
