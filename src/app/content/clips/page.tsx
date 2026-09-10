'use client';

/**
 * Best Practice Clips — admin library.
 *
 * FRONTEND ONLY. Every call below is an endpoint this page already used:
 *   GET    /api/admin/content/clip-categories   sections + clip counts
 *   GET    /api/admin/content/clips             clips, with their category
 *   POST   /api/admin/content/clips             multipart upload (Add audio)
 *   POST   /api/admin/content/clips/:id/copy    copy into a second section
 *   PUT    /api/admin/content/clips/:id         move (categoryId) / hide (isPublished)
 *   DELETE /api/admin/content/clips/:id         delete
 *   GET    /api/journey/clips/:id/media         the audio bytes
 * No request or response shape is changed and no field is renamed.
 *
 * Two things the design asks for that the API does not expose, both handled
 * client-side rather than by touching the backend — see SAVED_STORAGE_KEY and
 * waveBars() for the details and the trade-offs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminSidebar from '@/components/layout/AdminSidebar';
import { ConfirmPopover } from '@/components/ui/Popover';
import { useAuthStore } from '@/store/auth.store';
import { authenticatedFetch, contentApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';

type Category = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  _count?: { clips: number };
};

/**
 * "Saved" is a local bookmark list.
 *
 * TrainingClip has no saved/favourite field and there is no endpoint for one,
 * so this is kept in localStorage per browser rather than inventing a backend
 * change. It therefore does not sync between devices or admins. Give me a
 * field and an endpoint and this becomes a one-line swap.
 */
const SAVED_STORAGE_KEY = 'callsim.admin.savedClips';

/**
 * Section accents, cycled by position.
 *
 * Keyed by index and not by section name: sections are admin-created rows, so
 * a name-keyed lookup would leave every new section unstyled — the exact
 * hardcoding this library was built to avoid.
 *
 * One set per theme. These are applied as inline styles (card borders, tags,
 * the play button, the waveform fill), so unlike everything else on the page
 * they cannot ride on a CSS variable swap — warm browns on the midnight
 * console would read as mud.
 */
/**
 * Per-section clip accents, drawn from the plum + amber family so a long list
 * of sections still reads as one palette rather than a colour wheel. One set
 * now — the light/dark pair went with the theme switch.
 */
const ACCENTS = ['#2E1B33', '#DE8A24', '#8F5410', '#5A3A66', '#40284A', '#406B4B'] as const;

const BAR_COUNT = 40;

/**
 * Deterministic bar heights for the scrubber.
 *
 * NOT real amplitude data — decoding every clip to draw a true waveform would
 * mean downloading the whole library on page load. These are a stable
 * pseudo-random pattern seeded from the clip id, so a given clip always draws
 * the same shape. The bar FILL is driven by real playback position, so the
 * scrubbing and seeking are genuine even though the silhouette is decorative.
 */
function waveBars(seed: string): number[] {
  let x = 0;
  for (let i = 0; i < seed.length; i++) x = (x * 31 + seed.charCodeAt(i)) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out.push(28 + (x % 72));
  }
  return out;
}

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const whole = Math.floor(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function fmtSize(bytes: number): string {
  if (!bytes) return '·';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Descriptions are authored as free text — sometimes already bulleted,
 * sometimes one paragraph. Either way the card shows them as pointers, so a
 * reviewer can scan what a clip demonstrates instead of reading a block.
 */
function descriptionPoints(description: string): string[] {
  const lines = description
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:[-\u2013\u2014\u2022*]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);

  if (lines.length > 1) return lines;

  const single = lines[0] ?? '';
  if (!single) return [];

  // A single paragraph becomes one pointer per sentence.
  const sentences = single
    .split(/(?<=[.!?;])\s+(?=["'(\u201C]?[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return sentences.length > 1 ? sentences : [single];
}

export default function ClipsAdminPage() {
  const { token, user, loadFromStorage } = useAuthStore();

  // The admin portal is already role-gated at the route level; this only
  // decides whether the management icons render, so the card component stays
  // reusable if it is ever dropped into the agent app.
  const isAdmin = !user || user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

  // Theme comes from the shell so the portal has a single toggle (in the
  // sidebar) rather than this page owning a second, competing one.
  const [categories, setCategories] = useState<Category[]>([]);
  const [clips, setClips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [filter, setFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [uploadingIn, setUploadingIn] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [newSection, setNewSection] = useState('');

  // ── playback ────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobCache = useRef<Map<string, string>>(new Map());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_STORAGE_KEY);
      if (raw) setSaved(new Set(JSON.parse(raw)));
    } catch { /* storage disabled — bookmarks just won't persist */ }
  }, []);

  // Blob URLs are held by the document until revoked; without this every clip
  // played would leak its bytes for the life of the tab.
  useEffect(() => {
    const cache = blobCache.current;
    return () => { cache.forEach((url) => URL.revokeObjectURL(url)); cache.clear(); };
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [cats, cl] = await Promise.all([
        contentApi.listClipCategories(token),
        contentApi.listClips(token),
      ]);
      setCategories(cats.data);
      setClips(cl.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? '' : t)), 2200);
  }, []);

  function persistSaved(next: Set<string>) {
    setSaved(next);
    try {
      window.localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify([...next]));
    } catch { /* non-fatal */ }
  }

  const accentOf = useMemo(() => {
    const map = new Map(categories.map((c, i) => [c.id, ACCENTS[i % ACCENTS.length]]));
    return (id: string) => map.get(id) ?? ACCENTS[0];
  }, [categories]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clips.filter((c) => {
      if (filter === 'saved' && !saved.has(c.id)) return false;
      if (filter !== 'all' && filter !== 'saved' && c.categoryId !== filter) return false;
      if (q) {
        const section = categories.find((cat) => cat.id === c.categoryId)?.name ?? '';
        const uploader = c.uploadedBy ? `${c.uploadedBy.firstName ?? ''} ${c.uploadedBy.lastName ?? ''}` : '';
        const haystack = [c.title, c.description, c.transcript, section, uploader]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [clips, filter, query, saved, categories]);

  const allExpanded = visible.length > 0 && visible.every((c) => expanded.has(c.id));

  // ── actions (all existing endpoints) ────────────────────────
  async function run(fn: () => Promise<any>, ok: string) {
    setError('');
    try {
      await fn();
      say(ok);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function uploadInto(categoryId: string, files: File[]) {
    if (!token || files.length === 0) return;
    setUploadingIn(categoryId);
    setError('');
    let done = 0;
    const failed: string[] = [];
    // Sequential: a batch of concurrent multipart uploads starves the API and
    // makes the failure reporting useless.
    for (const file of files) {
      try {
        await contentApi.uploadClip(token, file, { categoryId });
        done += 1;
      } catch (err: any) {
        failed.push(`${file.name}: ${err.message}`);
      }
    }
    const name = categories.find((c) => c.id === categoryId)?.name ?? 'section';
    if (done) say(`${done} clip${done === 1 ? '' : 's'} added to ${name}`);
    if (failed.length) setError(`${failed.length} failed — ${failed[0]}`);
    setUploadingIn(null);
    load();
  }

  // ── playback control ────────────────────────────────────────
  async function togglePlay(clip: any) {
    const audio = audioRef.current;
    if (!audio || !token) return;

    if (currentId === clip.id) {
      if (audio.paused) { void audio.play(); } else { audio.pause(); }
      return;
    }

    setLoadingId(clip.id);
    setError('');
    try {
      let url = blobCache.current.get(clip.id);
      if (!url) {
        // The media route is authenticated and an <audio src> cannot send an
        // request headers, so bytes are fetched through the shared authenticated
        // boundary and played from a blob. A blob is same-origin to the page, which
        // also sidesteps CORS and Cross-Origin-Resource-Policy entirely.
        const res = await authenticatedFetch(contentApi.clipMediaUrl(clip.id), token);
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? 'The stored file for this clip is missing.'
              : `Could not load this clip (${res.status}).`,
          );
        }
        const blob = await res.blob();
        url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: clip.mimeType }));
        blobCache.current.set(clip.id, url);
      }
      audio.src = url;
      setCurrentId(clip.id);
      setPosition(0);
      setDuration(0);
      await audio.play();
    } catch (err: any) {
      setError(err.message || 'Could not play this clip.');
    } finally {
      setLoadingId(null);
    }
  }

  function seekTo(fraction: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.min(1, Math.max(0, fraction)) * audio.duration;
  }

  const currentClip = clips.find((c) => c.id === currentId) ?? null;
  const publishedCount = clips.filter((c) => c.isPublished).length;
  const hiddenCount = clips.length - publishedCount;
  const activeSectionCount = categories.filter((c) => c.isActive).length;

  const grouped = useMemo(() => {
    if (filter !== 'all') return null;
    return categories
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((cat) => ({ cat, items: visible.filter((c) => c.categoryId === cat.id) }))
      .filter((g) => g.items.length > 0);
  }, [filter, categories, visible]);

  return (
    <div className="flex">
      <AdminSidebar />

      <main
        className="bean-scope relative ml-64 min-h-screen flex-1 bg-bean-bg px-6 pb-36 pt-7 font-body text-bean-ink antialiased lg:px-8"
      >
        <div className="bean-glow pointer-events-none fixed inset-0 z-0" aria-hidden />
        <div className="bean-grid pointer-events-none fixed inset-0 z-0 opacity-50" aria-hidden />

        <div className="relative z-10 mx-auto w-full max-w-[1500px]">
          {/* ── header ─────────────────────────────────── */}
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3.5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] border border-bean-gold/30 bg-bean-gold/[0.12]">
                <FilmGlyph className="h-5 w-5 stroke-bean-gold" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-bean-ink">
                    Best Practice Clips
                  </h1>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-bean-gold/30 bg-bean-gold/[0.10] px-2.5 py-1 font-mono-ui text-[9px] font-bold uppercase tracking-[0.12em] text-bean-gold">
                    <LockGlyph className="h-3 w-3 stroke-bean-gold" />
                    Always open
                  </span>
                </div>
                <p className="mt-1 max-w-[68ch] text-[13.5px] leading-relaxed text-bean-muted">
                  Review strong calls, compare delivery, and keep the best examples easy to find.
                </p>
              </div>
            </div>

            {isAdmin && (
              <button
                type="button"
                onClick={() => setManaging((v) => !v)}
                className={`rounded-xl border px-4 py-2.5 text-[13px] font-semibold transition ${
                  managing
                    ? 'border-bean-brand/30 bg-bean-brand/10 text-bean-brand'
                    : 'bean-card text-bean-ink hover:border-bean-line2'
                }`}
              >
                {managing ? 'Done managing' : 'Manage sections'}
              </button>
            )}
          </div>

          {/* ── overview ───────────────────────────────── */}
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label="Total clips" value={clips.length} hint="In the library" />
            <MetricCard label="Published" value={publishedCount} hint="Visible to agents" />
            <MetricCard label="Sections" value={activeSectionCount} hint={`${categories.length} total`} />
            <MetricCard label="Saved" value={saved.size} hint={hiddenCount ? `${hiddenCount} hidden` : 'No hidden clips'} />
          </div>

          {error && (
            <div className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-bean-live/35 bg-bean-live/[0.08] px-4 py-3">
              <p className="text-[13px] font-medium text-bean-live">{error}</p>
              <button type="button" onClick={() => setError('')} className="text-[12.5px] font-semibold text-bean-live hover:opacity-75">
                Dismiss
              </button>
            </div>
          )}

          {managing && isAdmin && (
            <SectionManager
              categories={categories}
              newSection={newSection}
              setNewSection={setNewSection}
              onCreate={() => {
                if (!newSection.trim()) { setError('Give the section a name.'); return; }
                run(async () => {
                  await contentApi.createClipCategory(token!, { name: newSection.trim() });
                  setNewSection('');
                }, 'Section created');
              }}
              onRename={(c: Category, name: string) =>
                run(() => contentApi.updateClipCategory(token!, c.id, { name }), 'Section renamed')
              }
              onToggleActive={(c: Category) =>
                run(
                  () => contentApi.updateClipCategory(token!, c.id, { isActive: !c.isActive }),
                  c.isActive ? 'Section hidden from agents' : 'Section visible to agents',
                )
              }
              onMove={(c: Category, delta: number) => {
                const ordered = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
                const from = ordered.findIndex((x) => x.id === c.id);
                const to = from + delta;
                if (to < 0 || to >= ordered.length) return;
                const [moved] = ordered.splice(from, 1);
                ordered.splice(to, 0, moved);
                run(
                  () => contentApi.reorderClipCategories(token!, ordered.map((x) => x.id)),
                  'Sections reordered',
                );
              }}
              onDelete={(c: Category) => {
                run(() => contentApi.deleteClipCategory(token!, c.id), 'Section deleted');
              }}
            />
          )}

          {/* ── library controls ───────────────────────── */}
          <div className="bean-card mb-7 rounded-[18px] border p-3.5">
            <div className="bean-scroll flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Clip sections">
              <Tab on={filter === 'all'} count={clips.length} onClick={() => setFilter('all')}>
                All clips
              </Tab>
              {categories
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((cat) => (
                  <Tab
                    key={cat.id}
                    on={filter === cat.id}
                    count={clips.filter((c) => c.categoryId === cat.id).length}
                    onClick={() => setFilter(cat.id)}
                  >
                    {cat.name}{!cat.isActive && ' · hidden'}
                  </Tab>
                ))}
              <Tab on={filter === 'saved'} count={saved.size} onClick={() => setFilter('saved')}>
                ★ Saved
              </Tab>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-bean-line pt-3">
              <div className="relative min-w-[230px] flex-1">
                <SearchGlyph className="pointer-events-none absolute left-3.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 stroke-bean-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search title, notes, transcript or uploader…"
                  aria-label="Search clips"
                  className="w-full rounded-xl border border-bean-line bg-bean-card2 py-[10px] pl-[39px] pr-9 text-[13px] text-bean-ink outline-none transition placeholder:text-bean-faint focus:border-bean-brand"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-bean-faint transition hover:text-bean-ink"
                  >
                    <CloseGlyph className="h-3.5 w-3.5 stroke-current" />
                  </button>
                )}
              </div>

              <span className="whitespace-nowrap px-1 font-mono-ui text-[10px] font-bold uppercase tracking-[0.08em] text-bean-faint">
                {visible.length} shown
              </span>

              {isAdmin && (
                <AddAudioButton
                  categories={categories}
                  activeFilter={filter}
                  busy={uploadingIn !== null}
                  onFiles={uploadInto}
                />
              )}

              <button
                type="button"
                onClick={() => {
                  const next = new Set(expanded);
                  visible.forEach((c) => (allExpanded ? next.delete(c.id) : next.add(c.id)));
                  setExpanded(next);
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-bean-line bg-bean-card px-3.5 py-[10px] text-[12.5px] font-semibold text-bean-muted transition hover:border-bean-line2 hover:text-bean-ink"
              >
                <FolderGlyph className="h-[14px] w-[14px] stroke-current" />
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          </div>

          {/* ── library ────────────────────────────────── */}
          {loading ? (
            <div className="flex justify-center py-24">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-bean-brand border-t-transparent" />
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center font-mono-ui text-[13px] tracking-[0.04em] text-bean-faint">
              <NoteGlyph className="mx-auto mb-3.5 h-9 w-9 stroke-bean-faint opacity-60" />
              {clips.length === 0
                ? 'No clips yet. Use “Add audio” to upload your first one.'
                : 'No clips match this filter.'}
            </div>
          ) : grouped ? (
            grouped.map(({ cat, items }) => (
              <section key={cat.id} className="mb-9" style={{ ['--acc' as string]: accentOf(cat.id) }}>
                <header className="mb-3 flex items-center gap-3">
                  <h2 className="font-display text-[20px] font-extrabold leading-tight tracking-[-0.02em] text-bean-ink">{cat.name}</h2>
                  <span
                    className="ml-auto shrink-0 rounded-full border px-[11px] py-1 font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.08em]"
                    style={{ color: accentOf(cat.id), background: `${accentOf(cat.id)}1A`, borderColor: `${accentOf(cat.id)}47` }}
                  >
                    {items.length} clip{items.length === 1 ? '' : 's'}
                  </span>
                </header>
                <ClipGrid
                  items={items}
                  {...{ categories, accentOf, expanded, setExpanded, saved, persistSaved,
                    currentId, playing, position, duration, loadingId, togglePlay, seekTo,
                    isAdmin, token, run, say }}
                />
              </section>
            ))
          ) : (
            <section className="mb-10">
              <header className="mb-3 flex items-center gap-3">
                <h2 className="font-display text-[20px] font-extrabold leading-tight tracking-[-0.02em] text-bean-ink">
                  {filter === 'saved'
                    ? 'Saved clips'
                    : categories.find((c) => c.id === filter)?.name ?? 'Clips'}
                </h2>
                <span
                  className="ml-auto shrink-0 rounded-full border px-[11px] py-1 font-mono-ui text-[10.5px] font-bold uppercase tracking-[0.08em]"
                  style={
                    filter === 'saved'
                      ? {
                          color: 'rgb(var(--bean-gold))',
                          background: 'rgb(var(--bean-gold) / 0.1)',
                          borderColor: 'rgb(var(--bean-gold) / 0.28)',
                        }
                      : {
                          color: accentOf(filter),
                          background: `${accentOf(filter)}1A`,
                          borderColor: `${accentOf(filter)}47`,
                        }
                  }
                >
                  {visible.length} clip{visible.length === 1 ? '' : 's'}
                </span>
              </header>
              <ClipGrid
                items={visible}
                {...{ categories, accentOf, expanded, setExpanded, saved, persistSaved,
                  currentId, playing, position, duration, loadingId, togglePlay, seekTo,
                  isAdmin, token, run, say }}
              />
            </section>
          )}
        </div>

        {/* One shared element: only one clip plays at a time, and it keeps
            playing while the agent browses other sections. */}
        <audio
          ref={audioRef}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onError={() => setError('Playback failed for this clip.')}
          className="hidden"
        />

        {currentClip && (
          <NowPlaying
            clip={currentClip}
            sectionName={categories.find((c) => c.id === currentClip.categoryId)?.name ?? ''}
            playing={playing}
            position={position}
            duration={duration}
            onToggle={() => togglePlay(currentClip)}
            onSeek={seekTo}
            onClose={() => {
              audioRef.current?.pause();
              setCurrentId(null);
              setPosition(0);
            }}
          />
        )}

        {toast && (
          <div
            role="status"
            className="fixed bottom-28 left-[calc(50%+8rem)] z-[80] -translate-x-1/2 rounded-xl bg-bean-ink px-[18px] py-[11px] text-[13px] font-semibold text-bean-bg shadow-lg"
          >
            {toast}
          </div>
        )}
      </main>
    </div>
  );
}

// ── grid + card ───────────────────────────────────────────────

function ClipGrid(props: any) {
  const { items } = props;
  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      {items.map((clip: any) => (
        <ClipCard key={clip.id} clip={clip} {...props} />
      ))}
    </div>
  );
}

function ClipCard({
  clip, categories, accentOf, expanded, setExpanded, saved, persistSaved,
  currentId, playing, position, duration, loadingId, togglePlay, seekTo,
  isAdmin, token, run,
}: any) {
  const [menu, setMenu] = useState<'copy' | 'move' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [view, setView] = useState<'audio' | 'transcript'>('audio');
  /**
   * Draft of the fields an admin can change. Held locally and only sent on
   * save, so a half-typed transcript never reaches an agent, and Cancel is a
   * real cancel rather than an undo of writes already made.
   */
  const [draft, setDraft] = useState<null | {
    title: string;
    description: string;
    transcript: string;
  }>(null);
  const [saving, setSaving] = useState(false);
  const accent = accentOf(clip.categoryId);
  const isOpen = expanded.has(clip.id);
  const isCurrent = currentId === clip.id;
  const isPlaying = isCurrent && playing;

  const bars = useMemo(() => waveBars(clip.id), [clip.id]);
  const pct = isCurrent && duration > 0 ? position / duration : 0;
  const others = categories.filter((c: Category) => c.id !== clip.categoryId);
  const points = useMemo(() => descriptionPoints(clip.description ?? ''), [clip.description]);
  const sectionName = categories.find((c: Category) => c.id === clip.categoryId)?.name ?? '';

  function setOpen(open: boolean) {
    const next = new Set(expanded);
    if (open) next.add(clip.id); else next.delete(clip.id);
    setExpanded(next);
  }

  function startEdit() {
    setDraft({
      title: clip.title ?? '',
      description: clip.description ?? '',
      transcript: clip.transcript ?? '',
    });
    setOpen(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    // Empty strings clear a field rather than leaving the old value behind,
    // which is what an admin who has just deleted the text expects to happen.
    await run(
      () =>
        contentApi.updateClip(token, clip.id, {
          title: draft.title.trim(),
          description: draft.description.trim(),
          transcript: draft.transcript.trim(),
        }),
      'Clip updated',
    );
    setSaving(false);
    setDraft(null);
  }

  return (
    <article
      className={`bean-card relative self-start overflow-hidden rounded-[18px] border transition duration-150 ${
        isOpen ? 'shadow-[0_0_0_1px_var(--acc-soft)]' : 'hover:border-bean-line2 hover:-translate-y-px'
      }`}
      style={{ ['--acc' as string]: accent, ['--acc-soft' as string]: `${accent}40` }}
    >
      <span
        className={`absolute inset-x-0 top-0 h-[3px] transition-opacity duration-200 ${
          isOpen || isPlaying ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ background: `linear-gradient(90deg, ${accent}, ${accent}88)` }}
        aria-hidden
      />

      <div className="p-5">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => togglePlay(clip)}
            disabled={loadingId === clip.id}
            aria-label={isPlaying ? `Pause ${clip.title}` : `Play ${clip.title}`}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl transition hover:scale-[1.03] disabled:opacity-60"
            style={{ background: `linear-gradient(135deg, ${accent}, ${accent}A6)` }}
          >
            {loadingId === clip.id ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : isPlaying ? (
              <PauseGlyph className="h-4 w-4 fill-white" />
            ) : (
              <PlayGlyph className="h-4 w-4 fill-white" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setOpen(!isOpen)}
            aria-expanded={isOpen}
            className="min-w-0 flex-1 text-left"
          >
            <div className="line-clamp-2 min-h-[22px] break-words font-display text-[16px] font-bold leading-snug tracking-[-0.01em] text-bean-ink">
              {clip.title}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono-ui text-[9.5px] tracking-[0.03em] text-bean-faint">
              <span>{clip.mimeType}</span>
              <span>·</span>
              <span>{fmtSize(clip.sizeBytes)}</span>
              {isCurrent && duration > 0 && <><span>·</span><span>{fmtTime(duration)}</span></>}
              <span>·</span>
              <span>{formatDate(clip.createdAt)}</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setOpen(!isOpen)}
            aria-label={isOpen ? 'Collapse clip' : 'Expand clip'}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-bean-line bg-bean-card2 text-bean-faint transition hover:text-bean-ink ${isOpen ? 'rotate-180' : ''}`}
          >
            <ChevronGlyph className="h-4 w-4 stroke-current" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className="max-w-[180px] truncate rounded-full border px-2.5 py-1 font-mono-ui text-[8.5px] font-bold uppercase tracking-[0.1em]"
            style={{ color: accent, background: `${accent}16`, borderColor: `${accent}38` }}
          >
            {sectionName}
          </span>
          <span className={`rounded-full border px-2.5 py-1 font-mono-ui text-[8.5px] font-bold uppercase tracking-[0.1em] ${
            clip.isPublished
              ? 'border-bean-brand/25 bg-bean-brand/[0.07] text-bean-brand'
              : 'border-bean-gold/30 bg-bean-gold/[0.08] text-bean-gold'
          }`}>
            {clip.isPublished ? 'Published' : 'Hidden'}
          </span>
          {isCurrent && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-bean-live/25 bg-bean-live/[0.07] px-2.5 py-1 font-mono-ui text-[8.5px] font-bold uppercase tracking-[0.1em] text-bean-live">
              <i className={`h-1.5 w-1.5 rounded-full bg-bean-live ${isPlaying ? 'animate-bean-blink' : ''}`} />
              {isPlaying ? 'Playing' : 'Paused'}
            </span>
          )}
        </div>

        <div className={`mt-3 ${isOpen ? '' : 'min-h-[62px]'}`}>
          {points.length > 0 ? (
            <ul className="space-y-1.5">
              {points.slice(0, isOpen ? points.length : 3).map((point, i) => (
                <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-bean-muted">
                  <span
                    className="mt-[7px] h-[3.5px] w-[3.5px] shrink-0 rounded-full"
                    style={{ background: `${accent}CC` }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">{point}</span>
                </li>
              ))}
              {!isOpen && points.length > 3 && (
                <li className="pl-[11px] text-[11.5px] font-medium text-bean-faint">
                  + {points.length - 3} more point{points.length - 3 === 1 ? '' : 's'}
                </li>
              )}
            </ul>
          ) : (
            <p className="text-[12.5px] italic text-bean-faint">No coaching notes added yet.</p>
          )}
        </div>

        <div className="mt-4 flex min-h-9 flex-wrap items-center gap-2 border-t border-bean-line pt-3">
          <button
            type="button"
            onClick={() => setOpen(!isOpen)}
            className="text-[12.5px] font-semibold text-bean-brand transition hover:text-bean-brand-bright"
          >
            {isOpen ? 'Close details' : clip.transcript ? 'Open audio & transcript' : 'Open audio'}
          </button>

          {clip.uploadedBy && (
            <span className="hidden truncate text-[10.5px] text-bean-faint sm:inline">
              Added by {clip.uploadedBy.firstName} {clip.uploadedBy.lastName}
            </span>
          )}

          <div className="ml-auto flex items-center gap-0.5">
            <IconBtn
              label={saved.has(clip.id) ? 'Remove from saved' : 'Save'}
              active={saved.has(clip.id)}
              onClick={() => {
                const next = new Set<string>(saved);
                if (next.has(clip.id)) next.delete(clip.id); else next.add(clip.id);
                persistSaved(next);
              }}
            >
              <StarGlyph className="h-[15px] w-[15px]" filled={saved.has(clip.id)} />
            </IconBtn>

            {isAdmin && (
              <>
                <IconBtn label="Edit title, description and transcript" onClick={startEdit}>
                  <PencilGlyph className="h-[15px] w-[15px]" />
                </IconBtn>
                <IconBtn label="Copy to…" disabled={others.length === 0} onClick={() => setMenu(menu === 'copy' ? null : 'copy')}>
                  <CopyGlyph className="h-[15px] w-[15px]" />
                </IconBtn>
                <IconBtn label="Move to…" disabled={others.length === 0} onClick={() => setMenu(menu === 'move' ? null : 'move')}>
                  <MoveGlyph className="h-[15px] w-[15px]" />
                </IconBtn>
                <IconBtn
                  label={clip.isPublished ? 'Hide from agents' : 'Show to agents'}
                  onClick={() =>
                    run(
                      () => contentApi.updateClip(token, clip.id, { isPublished: !clip.isPublished }),
                      clip.isPublished ? 'Clip hidden' : 'Clip visible',
                    )
                  }
                >
                  <EyeOffGlyph className="h-[15px] w-[15px]" />
                </IconBtn>
                <ConfirmPopover
                  open={confirming}
                  onClose={() => setConfirming(false)}
                  title={`Delete “${clip.title}”?`}
                  body={
                    <>
                      Agents will no longer hear this clip and the audio file is removed. It sits in{' '}
                      <b className="font-semibold text-bean-ink">{sectionName}</b>. This cannot be undone.
                    </>
                  }
                  onConfirm={() => run(() => contentApi.deleteClip(token, clip.id), 'Clip deleted')}
                >
                  <IconBtn
                    label="Delete"
                    danger
                    active={confirming}
                    onClick={() => setConfirming((v: boolean) => !v)}
                  >
                    <TrashGlyph className="h-[15px] w-[15px]" />
                  </IconBtn>
                </ConfirmPopover>
              </>
            )}
          </div>
        </div>
      </div>

      {draft && (
        <form onSubmit={saveEdit} className="mx-5 mb-4 space-y-3 rounded-[14px] border border-bean-line bg-bean-card2 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono-ui text-[10px] font-bold uppercase tracking-[0.12em] text-bean-faint">
              Edit clip · {sectionName}
            </p>
            <button type="button" onClick={() => setDraft(null)} className="text-[12px] font-semibold text-bean-faint hover:text-bean-ink">
              Cancel
            </button>
          </div>

          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-bean-ink">Title</span>
            <input
              required
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full rounded-xl border border-bean-line bg-bean-card px-3 py-2.5 text-[13px] text-bean-ink outline-none transition focus:border-bean-brand"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-bean-ink">Coaching notes</span>
            <textarea
              rows={4}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="w-full rounded-xl border border-bean-line bg-bean-card px-3 py-2.5 text-[13px] leading-relaxed text-bean-ink outline-none transition focus:border-bean-brand"
            />
            <span className="mt-1 block text-[11px] text-bean-faint">Use one coaching point per line for the cleanest card layout.</span>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-bean-ink">Transcript</span>
            <textarea
              rows={10}
              value={draft.transcript}
              onChange={(e) => setDraft({ ...draft, transcript: e.target.value })}
              placeholder={'Speaker 0\nWhat the agent says.\n\nSpeaker 1\nWhat the customer says.'}
              className="w-full rounded-xl border border-bean-line bg-bean-card px-3 py-2.5 font-mono-ui text-[12px] leading-relaxed text-bean-ink outline-none transition focus:border-bean-brand"
            />
          </label>

          <div className="flex justify-end gap-2 border-t border-bean-line pt-3">
            <button type="button" onClick={() => setDraft(null)} className="rounded-xl border border-bean-line bg-bean-card px-3.5 py-2 text-[12.5px] font-semibold text-bean-muted hover:text-bean-ink">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded-xl bg-gradient-to-r from-bean-brand to-bean-brand-bright px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      )}

      {menu && (
        <div className="mx-5 mb-4 rounded-[14px] border border-bean-line bg-bean-card2 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[12.5px] font-semibold text-bean-ink">
              {menu === 'copy' ? 'Copy clip to section' : 'Move clip to section'}
            </span>
            <button type="button" onClick={() => setMenu(null)} className="text-[12px] text-bean-faint hover:text-bean-ink">Cancel</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {others.map((c: Category) => (
              <button
                type="button"
                key={c.id}
                onClick={() => {
                  setMenu(null);
                  if (menu === 'copy') {
                    run(() => contentApi.copyClip(token, clip.id, c.id), `Copied to ${c.name}`);
                  } else {
                    run(() => contentApi.updateClip(token, clip.id, { categoryId: c.id }), `Moved to ${c.name}`);
                  }
                }}
                className="rounded-lg border border-bean-line bg-bean-card px-3 py-1.5 text-[12.5px] font-medium text-bean-ink transition hover:border-bean-brand/35 hover:text-bean-brand"
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className="overflow-hidden px-5 transition-all duration-300 ease-out"
        style={{
          maxHeight: isOpen ? (view === 'transcript' ? 430 : 220) : 0,
          opacity: isOpen ? 1 : 0,
          paddingBottom: isOpen ? 20 : 0,
        }}
      >
        <div className="rounded-[14px] border border-bean-line bg-bean-card2 p-4">
          {clip.transcript && (
            <div className="mb-3 flex items-center gap-1.5">
              <PanelTab on={view === 'audio'} onClick={() => setView('audio')}>Audio</PanelTab>
              <PanelTab on={view === 'transcript'} onClick={() => setView('transcript')}>Transcript</PanelTab>
            </div>
          )}

          {view === 'audio' || !clip.transcript ? (
            <div className="flex items-center gap-3.5">
              <button
                type="button"
                onClick={() => togglePlay(clip)}
                disabled={loadingId === clip.id}
                aria-label={isPlaying ? `Pause ${clip.title}` : `Play ${clip.title}`}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full transition hover:scale-105 disabled:opacity-60"
                style={{ background: `linear-gradient(135deg, ${accent}, ${accent}A6)` }}
              >
                {loadingId === clip.id ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : isPlaying ? (
                  <PauseGlyph className="h-[17px] w-[17px] fill-white" />
                ) : (
                  <PlayGlyph className="h-[17px] w-[17px] fill-white" />
                )}
              </button>

              <div className="min-w-0 flex-1">
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label={`Seek ${clip.title}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(pct * 100)}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    if (!isCurrent) { togglePlay(clip); return; }
                    seekTo((e.clientX - r.left) / r.width);
                  }}
                  onKeyDown={(e) => {
                    if (!isCurrent) return;
                    if (e.key === 'ArrowRight') seekTo(pct + 0.05);
                    if (e.key === 'ArrowLeft') seekTo(pct - 0.05);
                  }}
                  className="flex h-9 cursor-pointer items-center gap-[2.5px]"
                >
                  {bars.map((h, i) => {
                    const done = i / BAR_COUNT <= pct;
                    const head = isPlaying && Math.floor(pct * BAR_COUNT) === i;
                    return (
                      <span
                        key={i}
                        className="min-w-[2px] flex-1 rounded-full"
                        style={{
                          height: `${h}%`,
                          background: head
                            ? 'rgb(var(--bean-gold))'
                            : done
                              ? `linear-gradient(180deg, ${accent}B3, ${accent})`
                              : 'var(--bean-wave-idle)',
                          boxShadow: head ? '0 0 8px rgb(var(--bean-gold))' : undefined,
                        }}
                      />
                    );
                  })}
                </div>
                <div className="mt-1.5 flex justify-between font-mono-ui text-[10px] tracking-[0.04em] text-bean-faint">
                  <span style={{ color: isCurrent ? accent : undefined }}>{fmtTime(isCurrent ? position : 0)}</span>
                  <span>{isCurrent && duration ? fmtTime(duration) : '·'}</span>
                </div>
              </div>
            </div>
          ) : (
            <TranscriptView transcript={clip.transcript} />
          )}
        </div>
      </div>
    </article>
  );
}

// ── now playing ───────────────────────────────────────────────

function NowPlaying({ clip, sectionName, playing, position, duration, onToggle, onSeek, onClose }: any) {
  const pct = duration > 0 ? (position / duration) * 100 : 0;
  const [sidebarWidth, setSidebarWidth] = useState(256);

  useEffect(() => {
    const sidebar = document.getElementById('admin-sidebar');
    if (!sidebar) return;

    const syncWidth = () => setSidebarWidth(Math.round(sidebar.getBoundingClientRect().width));
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(sidebar);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-0 right-0 z-[70]" style={{ left: sidebarWidth }}>
      <div className="w-full px-6 pb-4 lg:px-8">
        <div className="mx-auto w-full max-w-[1500px]">
          <div className="bean-card pointer-events-auto flex min-w-0 items-center gap-4 rounded-[18px] border px-5 py-3.5 shadow-[0_16px_40px_rgba(0,0,0,0.16)] backdrop-blur-xl">
          <span className="hidden shrink-0 items-center gap-2 rounded-lg border border-bean-live/40 bg-bean-live/[0.08] px-2.5 py-1.5 font-mono-ui text-[9px] font-bold tracking-[0.2em] text-bean-live sm:inline-flex">
            <i className="h-[7px] w-[7px] rounded-full bg-bean-live animate-bean-blink" />
            ON AIR
          </span>

          <button
            onClick={onToggle}
            aria-label={playing ? 'Pause' : 'Play'}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-bean-brand to-bean-brand-bright"
          >
            {playing ? <PauseGlyph className="h-[17px] w-[17px] fill-white" /> : <PlayGlyph className="h-[17px] w-[17px] fill-white" />}
          </button>

          <div className="hidden w-[160px] min-w-0 shrink-0 md:block">
            <b className="block truncate text-[13.5px] font-bold">{clip.title}</b>
            <span className="block truncate font-mono-ui text-[9.5px] uppercase tracking-[0.06em] text-bean-faint">
              {sectionName}
            </span>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div
              role="slider"
              tabIndex={0}
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pct)}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onSeek((e.clientX - r.left) / r.width);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') onSeek(pct / 100 + 0.05);
                if (e.key === 'ArrowLeft') onSeek(pct / 100 - 0.05);
              }}
              className="relative h-1.5 flex-1 cursor-pointer overflow-hidden rounded-full"
              style={{ background: 'var(--bean-wave-idle)' }}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-bean-brand-bright to-bean-brand"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="whitespace-nowrap font-mono-ui text-[11px] text-bean-muted">
              <span className="text-bean-brand">{fmtTime(position)}</span> / {fmtTime(duration)}
            </span>
          </div>

          <button onClick={onClose} aria-label="Close player" className="shrink-0 p-1.5 text-bean-faint transition hover:text-bean-ink">
            <CloseGlyph className="h-4 w-4 stroke-current" />
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── small pieces ──────────────────────────────────────────────

function MetricCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="bean-card rounded-[15px] border px-4 py-3.5">
      <p className="font-mono-ui text-[9px] font-bold uppercase tracking-[0.12em] text-bean-faint">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <strong className="font-display text-[22px] font-extrabold leading-none tracking-[-0.03em] text-bean-ink">{value}</strong>
        <span className="truncate text-[10.5px] text-bean-faint">{hint}</span>
      </div>
    </div>
  );
}

function Tab({ on, count, onClick, children }: any) {
  return (
    <button
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-2 rounded-[10px] border px-3.5 py-2 text-[12.5px] font-semibold transition ${
        on
          ? 'border-transparent bg-gradient-to-r from-bean-brand to-bean-brand-bright text-white'
          : 'bean-card text-bean-muted hover:text-bean-ink'
      }`}
    >
      {children}
      <span
        className={`rounded-full px-2 py-0.5 font-mono-ui text-[10px] font-bold ${
          on ? 'bg-white/25 text-white' : 'bg-bean-card2 text-bean-muted'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function IconBtn({ label, onClick, children, danger, active, disabled }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`grid h-[29px] w-[29px] place-items-center rounded-[9px] border border-transparent transition disabled:opacity-30 ${
        danger
          ? 'text-bean-faint hover:border-bean-live/25 hover:bg-bean-live/10 hover:text-bean-live'
          : active
            ? 'text-bean-gold'
            : 'text-bean-faint hover:border-bean-line hover:bg-bean-card2 hover:text-bean-brand'
      }`}
    >
      {children}
    </button>
  );
}

function PanelTab({ on, onClick, children }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1 font-mono-ui text-[10px] font-bold uppercase tracking-[0.1em] transition ${
        on
          ? 'border-transparent bg-gradient-to-r from-bean-brand to-bean-brand-bright text-white'
          : 'border-bean-line bg-bean-card text-bean-muted hover:text-bean-ink'
      }`}
    >
      {children}
    </button>
  );
}

/** The stored transcript is a "Speaker N" dialogue — turn it into readable entries. */
function TranscriptView({ transcript }: any) {
  const entries = useMemo(() => {
    const out: { speaker: string; text: string }[] = [];
    let speaker = '';
    let parts: string[] = [];
    const flush = () => {
      if (speaker && parts.some((p) => p.trim())) out.push({ speaker, text: parts.join(' ').trim() });
      parts = [];
    };
    for (const raw of String(transcript).split('\n')) {
      const m = raw.match(/^Speaker\s+(\d+)\s*$/i);
      if (m) { flush(); speaker = `Speaker ${m[1]}`; }
      else if (raw.trim()) parts.push(raw.trim());
    }
    flush();
    return out;
  }, [transcript]);

  if (entries.length === 0) {
    return (
      <p className="py-2 font-mono-ui text-[11px] tracking-[0.04em] text-bean-faint">
        No transcription yet.
      </p>
    );
  }

  // The card's expand animation runs on a fixed max-height, so a long
  // transcript has to scroll inside its own box rather than be clipped by it.
  return (
    <div className="bean-scroll max-h-[300px] space-y-2.5 overflow-y-auto overscroll-contain pr-1.5">
      {entries.map((e, i) => (
        <div key={i} className="flex items-start gap-2.5">
          <span className="mt-px shrink-0 rounded-full border border-bean-line bg-bean-card2 px-2 py-0.5 font-mono-ui text-[9px] font-bold uppercase tracking-[0.1em] text-bean-muted">
            {e.speaker}
          </span>
          <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-bean-ink">{e.text}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Add audio. Uploads into the section currently filtered to; on "All clips" or
 * "Saved" the admin picks the destination first, so a file can never land in a
 * section by accident.
 */
function AddAudioButton({ categories, activeFilter, busy, onFiles }: any) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const targetRef = useRef<string | null>(null);

  const direct = categories.find((c: Category) => c.id === activeFilter) ?? null;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = '';
          const target = targetRef.current;
          if (picked.length && target) onFiles(target, picked);
          targetRef.current = null;
        }}
      />

      <div className="relative">
        <button
          type="button"
          disabled={busy || categories.length === 0}
          onClick={() => {
            if (direct) { targetRef.current = direct.id; inputRef.current?.click(); }
            else setPicking((v) => !v);
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-bean-brand to-bean-brand-bright px-4 py-[11px] text-[13px] font-semibold text-white transition hover:-translate-y-px disabled:opacity-60"
        >
          <PlusGlyph className="h-[15px] w-[15px] stroke-white" />
          {busy ? 'Uploading…' : 'Add audio'}
        </button>

        {picking && !direct && (
          <div className="bean-card absolute left-0 top-full z-30 mt-2 w-64 rounded-xl border p-2">
            <p className="px-2 py-1 font-mono-ui text-[10px] uppercase tracking-[0.08em] text-bean-faint">
              Add to which section?
            </p>
            {categories.map((c: Category) => (
              <button
                key={c.id}
                onClick={() => {
                  setPicking(false);
                  targetRef.current = c.id;
                  inputRef.current?.click();
                }}
                className="block w-full rounded-lg px-2 py-2 text-left text-[13px] text-bean-ink hover:bg-bean-card2"
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function SectionManager({
  categories, newSection, setNewSection, onCreate, onRename, onToggleActive, onMove, onDelete,
}: any) {
  // Which section is being confirmed, so only one panel is ever open.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  return (
    <div className="bean-card mb-6 rounded-[18px] border p-5 shadow-sm">
      <h2 className="mb-1 font-display text-[17px] font-bold tracking-[-0.01em] text-bean-ink">Manage sections</h2>
      <p className="mb-4 text-[13px] text-bean-muted">
        Agents see active sections in this order. A section holding clips cannot be deleted — move
        its clips out first, or hide it to retire it without losing anything.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={newSection}
          onChange={(e) => setNewSection(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCreate(); } }}
          placeholder="New section name"
          className="bean-card max-w-xs flex-1 rounded-xl border px-3 py-2 text-[13.5px] text-bean-ink outline-none placeholder:text-bean-faint focus:border-bean-brand"
        />
        <button
          onClick={onCreate}
          className="rounded-xl bg-gradient-to-r from-bean-brand to-bean-brand-bright px-4 py-2 text-[13px] font-semibold text-white"
        >
          Add section
        </button>
      </div>

      <div className="divide-y divide-bean-line rounded-xl border border-bean-line">
        {[...categories].sort((a: Category, b: Category) => a.sortOrder - b.sortOrder).map((c: Category, i: number, arr: Category[]) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 px-3.5 py-3 transition hover:bg-bean-card2/60">
            <div className="flex shrink-0 gap-1">
              <button onClick={() => onMove(c, -1)} disabled={i === 0} aria-label={`Move ${c.name} up`}
                className="rounded px-2 py-1 text-bean-faint hover:bg-bean-card2 disabled:opacity-30">↑</button>
              <button onClick={() => onMove(c, 1)} disabled={i === arr.length - 1} aria-label={`Move ${c.name} down`}
                className="rounded px-2 py-1 text-bean-faint hover:bg-bean-card2 disabled:opacity-30">↓</button>
            </div>
            <input
              defaultValue={c.name}
              aria-label={`Rename ${c.name}`}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== c.name) onRename(c, next);
              }}
              className="max-w-xs flex-1 rounded-lg border border-bean-line bg-transparent px-2 py-1.5 text-[13.5px] text-bean-ink outline-none focus:border-bean-brand"
            />
            <span className="font-mono-ui text-[10px] text-bean-faint">{c.slug}</span>
            <span className="font-mono-ui text-[10px] text-bean-faint">{c._count?.clips ?? 0} clips</span>
            <div className="ml-auto flex shrink-0 gap-3">
              <button onClick={() => onToggleActive(c)} className="text-[13px] font-medium text-bean-muted hover:text-bean-ink">
                {c.isActive ? 'Hide' : 'Show'}
              </button>
              <ConfirmPopover
                open={confirmingId === c.id}
                onClose={() => setConfirmingId(null)}
                title={`Delete the “${c.name}” section?`}
                body={<>This section is empty, so nothing is lost. It cannot be undone.</>}
                onConfirm={() => onDelete(c)}
              >
                <button
                  onClick={() => setConfirmingId(confirmingId === c.id ? null : c.id)}
                  disabled={(c._count?.clips ?? 0) > 0}
                  title={(c._count?.clips ?? 0) > 0 ? 'Move or delete this section’s clips first' : undefined}
                  className="text-[13px] font-medium text-bean-live hover:opacity-80 disabled:cursor-not-allowed disabled:text-bean-faint disabled:opacity-40"
                >
                  Delete
                </button>
              </ConfirmPopover>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── glyphs ────────────────────────────────────────────────────
const S = { fill: 'none', strokeWidth: 1.9, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
const p = (d: string) => <path strokeLinecap="round" strokeLinejoin="round" d={d} />;

const FilmGlyph = ({ className }: any) => <svg className={className} {...S}>{p('M3.375 19.5h17.25M3.375 19.5a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m18.375 12.75V5.625M20.625 4.5H3.375M6 5.625v12.75m0-12.75h12m0 0v12.75M9 9.75h6M9 12h6m-6 2.25h6')}</svg>;
const LockGlyph = ({ className }: any) => <svg className={className} {...S}>{p('M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z')}</svg>;
const SearchGlyph = ({ className }: any) => <svg className={className} {...S}>{p('M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z')}</svg>;
const FolderGlyph = ({ className }: any) => <svg className={className} {...S}>{p('M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776')}</svg>;
const PlusGlyph = ({ className }: any) => <svg className={className} {...S}>{p('M12 4.5v15m7.5-7.5h-15')}</svg>;
const ChevronGlyph = ({ className }: any) => <svg className={className} {...S}>{p('M19.5 8.25l-7.5 7.5-7.5-7.5')}</svg>;
const PencilGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{p('M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125')}</svg>;
const CopyGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{p('M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25')}</svg>;
const MoveGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{p('M8.25 6.75L12 3m0 0l3.75 3.75M12 3v18')}</svg>;
const EyeOffGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{p('M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65')}</svg>;
const TrashGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{p('M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0')}</svg>;
const NoteGlyph = ({ className }: any) => <svg className={className} {...S} strokeWidth={1.5}>{p('M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z')}</svg>;
const CloseGlyph = ({ className }: any) => <svg className={className} {...S} strokeWidth={2.5}>{p('M6 18L18 6M6 6l12 12')}</svg>;
const PlayGlyph = ({ className }: any) => <svg className={className} viewBox="0 0 24 24" aria-hidden><path d="M8 5v14l11-7z" /></svg>;
const PauseGlyph = ({ className }: any) => <svg className={className} viewBox="0 0 24 24" aria-hidden><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>;
const StarGlyph = ({ className, filled }: any) => (
  <svg className={className} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.9} aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
  </svg>
);
