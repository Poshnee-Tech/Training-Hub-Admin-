'use client';

/**
 * Product Knowledge workspace — one place to manage what agents read and hear.
 *
 * This replaces two half-answers. Text lived here with no idea which part of a
 * guide it belonged to (and, until the article payload was wired up, with no
 * way to reach an agent at all), while narration lived on its own page as a
 * flat list per campaign. An admin could not see that a topic had a recording
 * but no notes, or tell which of eleven ACA recordings belonged to which
 * screen, without opening each one.
 *
 * The shape here follows how the guides are actually built: a campaign has
 * topics, and a topic has text and audio. So the page is
 *
 *   campaign tab  →  topic group  →  its notes and its recordings
 *
 * with one "not on a topic" group at the end for content written for the
 * campaign as a whole. Every row states its campaign and topic, so no edit or
 * delete is ever made against something the admin has to guess the home of.
 *
 * The topic list is served by the API (GUIDE_SECTIONS) rather than restated
 * here, so it cannot drift from what the guides render.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminSidebar from '@/components/layout/AdminSidebar';
import AudioRecorder from '@/components/knowledge/AudioRecorder';
import { ConfirmPopover, RenamePopover } from '@/components/ui/Popover';
import { useAuthStore } from '@/store/auth.store';
import { authenticatedFetch, contentApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';

/**
 * Med Alert is deliberately absent. The campaign still exists in the schema and
 * the call engines use it, but it has no product-knowledge guide, so a tab here
 * would offer somewhere to file content that no agent could ever reach.
 */
const CAMPAIGNS = [
  { id: 'ACA', label: 'ACA' },
  { id: 'MEDICARE', label: 'Medicare' },
] as const;

type CampaignId = (typeof CAMPAIGNS)[number]['id'];

/**
 * A guide topic. Built-ins map to a bespoke screen in the guide's code, so the
 * portal can file content under them but cannot rename or remove them. Custom
 * topics were added here and carry the id those actions need.
 */
type Section = {
  /** Custom topics always have one; built-ins only once overridden. */
  id?: string;
  key: string;
  label: string;
  /** What the guide calls a built-in in code, so a rename can be undone. */
  defaultLabel?: string;
  builtIn: boolean;
  isPublished?: boolean;
};

type Article = {
  id: string;
  slug: string;
  campaign: string;
  sectionKey: string | null;
  title: string;
  summary: string | null;
  bodyMarkdown: string;
  sortOrder: number;
  isPublished: boolean;
  updatedAt: string;
};

type Recording = {
  id: string;
  campaign: string;
  sectionKey: string | null;
  title: string;
  description: string | null;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  isPublished: boolean;
  sortOrder: number;
  createdAt: string;
};

/** The pseudo-key for content that belongs to a campaign, not to one topic. */
const UNPINNED = '__general__';

const EMPTY_ARTICLE = {
  id: '',
  slug: '',
  campaign: 'ACA' as string,
  sectionKey: '' as string,
  title: '',
  summary: '',
  bodyMarkdown: '',
  sortOrder: 0,
  isPublished: true,
};

function fmtSize(bytes: number): string {
  if (!bytes) return '·';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDuration(seconds: number | null): string | null {
  if (seconds == null) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Short display names for the ACA script topics — the full labels ("ACA script
 * · Important questions") are right for a card heading but too long for a
 * dropdown option. The keys only exist in the ACA guide, so nothing else is
 * affected.
 */
function shortLabel(section: Section): string {
  if (section.key === 'script-opening') return 'Opening';
  if (section.key === 'script-insurance') return 'Insurance';
  if (section.key === 'script-questions') return 'Imp question';
  return section.label;
}

export default function KnowledgeAdminPage() {
  const { token, loadFromStorage } = useAuthStore();

  const [campaign, setCampaign] = useState<CampaignId>('ACA');
  const [sections, setSections] = useState<Record<string, Section[]>>({});
  const [articles, setArticles] = useState<Article[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);

  const [query, setQuery] = useState('');
  const [newTopic, setNewTopic] = useState('');
  const [addingTopic, setAddingTopic] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  /** Which topic has its "add audio" panel open, and in which mode. */
  const [audioPanel, setAudioPanel] = useState<{ sectionKey: string; mode: 'record' } | null>(null);
  const [uploadingIn, setUploadingIn] = useState<string | null>(null);
  const [editing, setEditing] = useState<typeof EMPTY_ARTICLE | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  // One shared element, so starting a recording stops whatever was playing.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  /**
   * ── AUDIO IS FETCHED, NOT LINKED (2026-09-11) ────────────────────────────
   *
   * `audio.src` was the backend's media URL, which fails twice over: the CSP
   * this app sets allows media from `'self'` and `blob:` only, so the browser
   * blocked it outright, and the route is behind `authenticate` while an
   * `<audio src>` sends neither an Authorization header nor a cross-origin
   * cookie, so it would have answered 401 even with the policy widened.
   *
   * The bytes now come through the shared authenticated boundary and play from
   * a blob, which is same-origin to the page — the pattern the clips library
   * already uses. Cached per recording so re-playing one does not re-download
   * it, and revoked on unmount so the objects are not leaked.
   */
  const blobCache = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const cache = blobCache.current;
    return () => { cache.forEach((url) => URL.revokeObjectURL(url)); cache.clear(); };
  }, []);

  // Playhead of the shared element as a 0..1 fraction, so every waveform row
  // can paint its played bars without each owning the audio element.
  const [timeFrac, setTimeFrac] = useState<number | null>(null);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [secs, arts, recs] = await Promise.all([
        contentApi.listKnowledgeSections(token),
        contentApi.listArticles(token),
        contentApi.listRecordings(token),
      ]);
      setSections(secs.data);
      setArticles(arts.data);
      setRecordings(recs.data);
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const say = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((n) => (n === msg ? '' : n)), 2600);
  }, []);

  /** Run a mutation, report it, and refresh — the shape every action here uses. */
  async function run(fn: () => Promise<any>, message: string) {
    try {
      await fn();
      say(message);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const campaignSections = sections[campaign] ?? [];
  const sectionLabel = (key: string | null) =>
    campaignSections.find((s) => s.key === key)?.label ?? null;

  /**
   * Topics for the open campaign, each with its own content, followed by the
   * general group. A topic with nothing in it still renders — an empty slot is
   * information, and it is where the admin clicks to fill it.
   */
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (...fields: (string | null | undefined)[]) =>
      !q || fields.some((f) => (f ?? '').toLowerCase().includes(q));

    const mine = <T extends { campaign: string; sectionKey: string | null }>(rows: T[]) =>
      rows.filter((r) => r.campaign === campaign);

    const arts = mine(articles).filter((a) => hit(a.title, a.summary, a.slug, a.bodyMarkdown));
    const recs = mine(recordings).filter((r) => hit(r.title, r.description));

    const known = new Set(campaignSections.map((s) => s.key));

    // Annotated so the orphan and general groups, which have no editable
    // section behind them, can be appended without widening the inferred type.
    const built: Group[] = campaignSections.map((section) => ({
      key: section.key,
      label: section.label,
      articles: arts.filter((a) => a.sectionKey === section.key),
      recordings: recs.filter((r) => r.sectionKey === section.key),
      orphan: false,
      section,
    }));

    // Anything pinned to a key this campaign no longer publishes keeps its own
    // group rather than vanishing, so it can be re-pointed or deleted.
    const orphanKeys = Array.from(
      new Set(
        [...arts, ...recs]
          .map((r) => r.sectionKey)
          .filter((k): k is string => !!k && !known.has(k)),
      ),
    );

    for (const key of orphanKeys) {
      built.push({
        key,
        label: key,
        articles: arts.filter((a) => a.sectionKey === key),
        recordings: recs.filter((r) => r.sectionKey === key),
        orphan: true,
        section: undefined,
      });
    }

    built.push({
      key: UNPINNED,
      label: 'Not on a topic',
      articles: arts.filter((a) => !a.sectionKey),
      recordings: recs.filter((r) => !r.sectionKey),
      orphan: false,
      section: undefined,
    });

    // While searching, an empty topic is noise rather than an invitation.
    return q ? built.filter((g) => g.articles.length + g.recordings.length > 0) : built;
  }, [articles, recordings, campaign, campaignSections, query]);

  const countFor = (id: string) =>
    articles.filter((a) => a.campaign === id).length +
    recordings.filter((r) => r.campaign === id).length;

  const campaignArticles = articles.filter((a) => a.campaign === campaign);
  const campaignRecordings = recordings.filter((r) => r.campaign === campaign);
  const visibleItemCount =
    campaignArticles.filter((a) => a.isPublished).length +
    campaignRecordings.filter((r) => r.isPublished).length;
  const activeTopicCount = campaignSections.filter((s) => s.isPublished !== false).length;

  /**
   * Move a recording within its topic.
   *
   * The endpoint assigns sortOrder by list position, so the whole campaign's
   * order is rebuilt from what is on screen with the one pair swapped. Sending
   * just the topic's ids would renumber it from zero and shuffle it against
   * every other topic.
   */
  function nudge(rec: Recording, direction: -1 | 1) {
    const group = groups.find((g) => g.recordings.some((r) => r.id === rec.id));
    if (!group) return;

    const siblings = [...group.recordings];
    const from = siblings.findIndex((r) => r.id === rec.id);
    const to = from + direction;
    if (to < 0 || to >= siblings.length) return;
    [siblings[from], siblings[to]] = [siblings[to], siblings[from]];

    const order = groups.flatMap((g) =>
      (g.key === group.key ? siblings : g.recordings).map((r) => r.id),
    );
    void run(() => contentApi.reorderRecordings(token!, order), 'Order updated');
  }

  // ── topics ───────────────────────────────────────────────────

  async function addTopic(e: React.FormEvent) {
    e.preventDefault();
    const label = newTopic.trim();
    if (!token || !label) return;
    setAddingTopic(true);
    try {
      await contentApi.createKnowledgeSection(token, { campaign, label });
      setNewTopic('');
      say(`Topic “${label}” added`);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAddingTopic(false);
    }
  }

  function renameTopic(section: Section, label: string) {
    // The key stays put in both cases — content points at it, so only the
    // label moves. A built-in stores its new name as an override.
    void run(
      () =>
        section.builtIn
          ? contentApi.updateBuiltInSection(token!, { campaign, key: section.key, label })
          : contentApi.updateKnowledgeSection(token!, section.id!, { label }),
      'Topic renamed',
    );
  }

  /**
   * Remove a topic.
   *
   * The two kinds part company here. A custom topic is a row, so it goes, and
   * `cascade` takes its content with it. A built-in is a screen in the guide's
   * code, so the most that can be done is take it out of the guide — reversible,
   * and its content stays filed where it is.
   */
  function deleteTopic(section: Section, cascade: boolean) {
    if (section.builtIn) {
      void run(
        () =>
          contentApi.updateBuiltInSection(token!, {
            campaign,
            key: section.key,
            isPublished: false,
            cascade,
          }),
        cascade ? 'Topic and its content deleted' : 'Topic deleted',
      );
      return;
    }

    void run(
      () => contentApi.deleteKnowledgeSection(token!, section.id!, cascade),
      cascade ? 'Topic and its content deleted' : 'Topic deleted',
    );
  }

  /** Put a hidden built-in back, or show a hidden custom topic again. */
  function restoreTopic(section: Section) {
    void run(
      () =>
        section.builtIn
          ? contentApi.updateBuiltInSection(token!, {
              campaign,
              key: section.key,
              isPublished: true,
            })
          : contentApi.updateKnowledgeSection(token!, section.id!, { isPublished: true }),
      'Topic restored',
    );
  }

  // ── audio ────────────────────────────────────────────────────

  async function togglePlay(rec: Recording) {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === rec.id) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    if (!token || loadingId) return;

    setLoadingId(rec.id);
    setError('');
    try {
      let url = blobCache.current.get(rec.id);
      if (!url) {
        const res = await authenticatedFetch(contentApi.recordingMediaUrl(rec.id), token);
        if (!res.ok) {
          throw new Error(res.status === 404
            ? 'The stored file for this recording is missing.'
            : `Could not load this recording (${res.status}).`);
        }
        const blob = await res.blob();
        url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: rec.mimeType || 'audio/mpeg' }));
        blobCache.current.set(rec.id, url);
      }
      audio.src = url;
      setTimeFrac(0);
      await audio.play();
      setPlayingId(rec.id);
    } catch (err) {
      // Say WHICH failure it was: "could not play" covers a missing file, a
      // rejected request and a codec the browser will not decode, and an admin
      // can act on only one of those.
      setError(err instanceof Error ? err.message : 'Could not play this recording.');
      setPlayingId(null);
    } finally {
      setLoadingId(null);
    }
  }

  /** Move the shared playhead from a click on a waveform. */
  function seekTo(frac: number) {
    const audio = audioRef.current;
    if (!audio || !audio.duration || !playingId) return;
    audio.currentTime = frac * audio.duration;
    setTimeFrac(frac);
  }

  function syncFromAudio() {
    const audio = audioRef.current;
    if (audio && audio.duration) {
      setTimeFrac(Math.min(audio.currentTime / audio.duration, 1));
    }
  }

  async function uploadInto(sectionKey: string, files: File[]) {
    if (!token || files.length === 0) return;
    setUploadingIn(sectionKey);
    setError('');
    let done = 0;
    for (const file of files) {
      try {
        await contentApi.uploadRecording(token, file, {
          campaign,
          sectionKey: sectionKey === UNPINNED ? undefined : sectionKey,
        });
        done += 1;
      } catch (err: any) {
        setError(`${file.name}: ${err.message}`);
        break;
      }
    }
    if (done) {
      const where = sectionKey === UNPINNED ? 'the general list' : sectionLabel(sectionKey) ?? sectionKey;
      say(`${done} recording${done === 1 ? '' : 's'} added to ${where}`);
    }
    setUploadingIn(null);
    setAudioPanel(null);
    await load();
  }

  function removeRecording(rec: Recording) {
    void run(() => contentApi.deleteRecording(token!, rec.id), 'Recording deleted');
  }

  // ── text ─────────────────────────────────────────────────────

  async function saveArticle(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !editing) return;
    setError('');

    const body = {
      slug: editing.slug,
      campaign: editing.campaign,
      sectionKey: editing.sectionKey || null,
      title: editing.title,
      summary: editing.summary || undefined,
      bodyMarkdown: editing.bodyMarkdown,
      sortOrder: Number(editing.sortOrder),
      isPublished: editing.isPublished,
    };

    try {
      if (editing.id) await contentApi.updateArticle(token, editing.id, body);
      else await contentApi.createArticle(token, body);
      setEditing(null);
      say(editing.id ? 'Note saved' : 'Note added');
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function removeArticle(article: Article) {
    void run(() => contentApi.deleteArticle(token!, article.id), 'Note deleted');
  }

  function openEditor(sectionKey: string, article?: Article) {
    setEditing(
      article
        ? {
            id: article.id,
            slug: article.slug,
            campaign: article.campaign,
            sectionKey: article.sectionKey ?? '',
            title: article.title,
            summary: article.summary ?? '',
            bodyMarkdown: article.bodyMarkdown,
            sortOrder: article.sortOrder,
            isPublished: article.isPublished,
          }
        : {
            ...EMPTY_ARTICLE,
            campaign,
            sectionKey: sectionKey === UNPINNED ? '' : sectionKey,
          },
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="flex">
      <AdminSidebar />
      {/* Same surface as the clips library: warm cream in the bright theme,
          midnight console in the dark one. The legacy `card` / grey classes
          this page started with only had a dark remap, so in the bright theme
          it rendered as a white sheet with nothing of the product in it. */}
      <main
        className="bean-scope relative ml-64 min-h-screen flex-1 bg-bean-bg px-6 py-7 font-body text-bean-ink antialiased lg:px-8"
      >
        <div className="mx-auto w-full max-w-[1500px]">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="inline-flex h-2 w-2 rounded-full bg-bean-brand" />
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-bean-faint">Training content</span>
            </div>
            <h1 className="font-display text-[28px] font-extrabold tracking-[-0.035em] text-bean-ink">
              Product Knowledge
            </h1>
            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-bean-muted">
              Manage the notes and narration agents use inside each product guide, organized by campaign and topic.
            </p>
          </div>
          <div className="rounded-2xl border border-bean-line bg-bean-card px-4 py-3 text-right shadow-sm">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-bean-faint">Current guide</p>
            <p className="mt-0.5 text-[14px] font-bold text-bean-ink">{CAMPAIGNS.find((c) => c.id === campaign)?.label}</p>
          </div>
        </header>

        {!loading && (
          <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KnowledgeMetric label="Topics" value={activeTopicCount} helper="Visible guide sections" />
            <KnowledgeMetric label="Notes" value={campaignArticles.length} helper="Written knowledge" />
            <KnowledgeMetric label="Recordings" value={campaignRecordings.length} helper="Audio guidance" />
            <KnowledgeMetric label="Published" value={visibleItemCount} helper="Items visible to agents" />
          </section>
        )}

        {/* Which product am I editing — answered before anything else. */}
        <div className="bean-card mb-5 flex flex-wrap items-center gap-2 rounded-[18px] border p-2.5" role="tablist" aria-label="Product">
          <span className="mr-1 px-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-bean-faint">Campaign</span>
          {CAMPAIGNS.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={campaign === c.id}
              onClick={() => { setCampaign(c.id); setEditing(null); setAudioPanel(null); }}
              className={`inline-flex items-center gap-2.5 rounded-xl border px-[15px] py-2.5 text-[13px] font-semibold transition hover:-translate-y-px ${
                campaign === c.id
                  ? 'border-transparent bg-gradient-to-r from-bean-brand to-bean-brand-bright text-white'
                  : 'bean-card text-bean-muted hover:text-bean-ink'
              }`}
            >
              {c.label}
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  campaign === c.id ? 'bg-white/25 text-white' : 'bg-bean-card2 text-bean-muted'
                }`}
              >
                {countFor(c.id)}
              </span>
            </button>
          ))}
        </div>

        <div className="bean-card mb-6 flex flex-wrap items-center gap-3 rounded-[18px] border p-3.5">
          <div className="relative min-w-[240px] flex-1 xl:max-w-[520px]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this product's notes and recordings…"
            aria-label="Search product knowledge"
            className={`${FIELD} w-full pr-20`}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[11.5px] font-semibold text-bean-brand hover:text-bean-brand-bright"
            >
              Clear
            </button>
          )}
          </div>

          {/* New topics appear at the end of the guide and hold whatever is
              filed under them. The guide's own topics cannot be added here —
              each of those is a screen in code. */}
          <form onSubmit={addTopic} className="flex w-full flex-wrap items-center justify-end gap-2 border-t border-bean-line pt-3 lg:ml-auto lg:w-auto lg:min-w-[300px] lg:border-l lg:border-t-0 lg:pl-3 lg:pt-0">
            <input
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              placeholder="New topic name"
              aria-label="New topic name"
              className={`${FIELD} max-w-[220px]`}
            />
            <Btn tone="solid" type="submit" disabled={addingTopic || !newTopic.trim()}>
              <PlusGlyph className="h-[15px] w-[15px]" />
              {addingTopic ? 'Adding…' : 'Add topic'}
            </Btn>
          </form>
        </div>

        {notice && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-bean-brand/30 bg-bean-brand/[0.08] px-4 py-3.5 text-[13.5px] font-medium text-bean-ink shadow-sm">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bean-brand/15 text-[12px] font-bold text-bean-brand">✓</span>
            <span className="min-w-0 flex-1">
            {notice}
            </span>
          </div>
        )}
        {error && (
          <div className="mb-4 flex items-start justify-between gap-4 rounded-2xl border border-bean-live/40 bg-bean-live/10 px-4 py-3.5 shadow-sm">
            <p className="text-[13.5px] font-medium text-bean-live">{error}</p>
            <button onClick={() => setError('')} className="text-[13.5px] font-medium text-bean-live">
              Dismiss
            </button>
          </div>
        )}

        {editing && (
          <ArticleForm
            editing={editing}
            setEditing={setEditing}
            sections={sections[editing.campaign] ?? []}
            campaigns={CAMPAIGNS}
            onSubmit={saveArticle}
            onCancel={() => setEditing(null)}
          />
        )}

        {loading ? (
          <div className="space-y-4">
            {[0, 1, 2].map((n) => (
              <div key={n} className="bean-card min-h-[150px] animate-pulse rounded-[18px] border p-5">
                <div className="h-4 w-40 rounded bg-bean-card2" />
                <div className="mt-3 h-3 w-64 rounded bg-bean-card2" />
                <div className="mt-6 h-12 rounded-xl bg-bean-card2" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            {groups.length === 0 && (
              <p className="bean-card rounded-[18px] border py-14 text-center text-[13.5px] text-bean-muted">
                Nothing in {CAMPAIGNS.find((c) => c.id === campaign)?.label ?? campaign} matches
                “{query}”.
              </p>
            )}

            {groups.map((group) => (
              <TopicGroup
                key={group.key}
                group={group}
                campaignLabel={CAMPAIGNS.find((c) => c.id === campaign)?.label ?? campaign}
                busy={uploadingIn === group.key}
                recorderOpen={audioPanel?.sectionKey === group.key}
                playingId={playingId}
                renaming={renaming}
                setRenaming={setRenaming}
                onAddNote={() => openEditor(group.key)}
                onEditNote={(a) => openEditor(group.key, a)}
                onDeleteNote={removeArticle}
                onToggleNotePublished={(a) =>
                  run(
                    () => contentApi.updateArticle(token!, a.id, { isPublished: !a.isPublished }),
                    a.isPublished ? 'Note hidden from agents' : 'Note visible to agents',
                  )
                }
                onUpload={(files) => uploadInto(group.key, files)}
                onOpenRecorder={() => setAudioPanel({ sectionKey: group.key, mode: 'record' })}
                onCloseRecorder={() => setAudioPanel(null)}
                onRecorded={(file) => uploadInto(group.key, [file])}
                onPlay={togglePlay}
                loadingId={loadingId}
                onRenameRecording={(rec, title) =>
                  run(() => contentApi.updateRecording(token!, rec.id, { title }), 'Recording renamed')
                }
                onToggleRecordingPublished={(rec) =>
                  run(
                    () => contentApi.updateRecording(token!, rec.id, { isPublished: !rec.isPublished }),
                    rec.isPublished ? 'Recording hidden from agents' : 'Recording visible to agents',
                  )
                }
                onMoveRecording={(rec, key) =>
                  run(
                    () =>
                      contentApi.updateRecording(token!, rec.id, {
                        sectionKey: key === UNPINNED ? null : key,
                      }),
                    'Recording moved',
                  )
                }
                onDeleteRecording={removeRecording}
                onNudge={nudge}
                onRenameTopic={renameTopic}
                onDeleteTopic={deleteTopic}
                onRestoreTopic={restoreTopic}
                allSections={campaignSections}
                timeFrac={timeFrac}
                onSeek={seekTo}
              />
            ))}
          </div>
        )}

        {/* The waveform doubles as a scrub bar — same note that closes the
            reference design, so admins know the bars are clickable. */}
        <div className="mt-8 flex items-start gap-3 rounded-2xl border border-bean-brand/25 bg-bean-card px-5 py-4 text-[13px] leading-relaxed text-bean-muted">
          <InfoGlyph className="mt-0.5 h-4 w-4 shrink-0 stroke-bean-brand-deep" />
          <p>
            The waveform doubles as a scrub bar — an admin can click anywhere on it to jump to
            that point, not just hit play/pause. The filled progress makes “how much is left”
            visible without reading the timestamp.
          </p>
        </div>

        <audio
          ref={audioRef}
          className="hidden"
          onEnded={() => setPlayingId(null)}
          onPause={() => setPlayingId(null)}
          onTimeUpdate={syncFromAudio}
          onLoadedMetadata={syncFromAudio}
        />
        </div>
      </main>
    </div>
  );
}

// ── one topic ────────────────────────────────────────────────

type Group = {
  key: string;
  label: string;
  articles: Article[];
  recordings: Recording[];
  orphan: boolean;
  /** Absent for the general group and for orphaned keys — neither is editable. */
  section?: Section;
};

function TopicGroup({
  group, campaignLabel, busy, recorderOpen, playingId, loadingId, renaming, setRenaming, allSections,
  timeFrac, onSeek,
  onAddNote, onEditNote, onDeleteNote, onToggleNotePublished,
  onUpload, onOpenRecorder, onCloseRecorder, onRecorded,
  onPlay, onRenameRecording, onToggleRecordingPublished, onMoveRecording, onDeleteRecording, onNudge,
  onRenameTopic, onDeleteTopic, onRestoreTopic,
}: {
  group: Group;
  campaignLabel: string;
  busy: boolean;
  recorderOpen: boolean;
  playingId: string | null;
  renaming: { id: string; title: string } | null;
  setRenaming: (v: { id: string; title: string } | null) => void;
  allSections: Section[];
  timeFrac: number | null;
  onSeek: (frac: number) => void;
  onAddNote: () => void;
  onEditNote: (a: Article) => void;
  onDeleteNote: (a: Article) => void;
  onToggleNotePublished: (a: Article) => void;
  onUpload: (files: File[]) => void;
  onOpenRecorder: () => void;
  onCloseRecorder: () => void;
  onRecorded: (file: File) => void;
  onPlay: (rec: Recording) => void;
  /** The recording whose bytes are being fetched, so its button can say so. */
  loadingId?: string | null;
  onRenameRecording: (rec: Recording, title: string) => void;
  onToggleRecordingPublished: (rec: Recording) => void;
  onMoveRecording: (rec: Recording, key: string) => void;
  onDeleteRecording: (rec: Recording) => void;
  onNudge: (rec: Recording, direction: -1 | 1) => void;
  onRenameTopic: (section: Section, label: string) => void;
  onDeleteTopic: (section: Section, cascade: boolean) => void;
  onRestoreTopic: (section: Section) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const total = group.articles.length + group.recordings.length;
  const empty = total === 0;

  // One id at a time, so opening a second panel closes the first rather than
  // stacking two questions over the same row.
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const [cascade, setCascade] = useState(false);
  const panel = (id: string) => ({
    open: openPanel === id,
    onClose: () => setOpenPanel(null),
  });

  return (
    <section className="bean-card overflow-hidden rounded-[20px] border transition duration-150 hover:border-bean-line2">
      <header className="flex flex-wrap items-center gap-3 border-b border-bean-line bg-bean-card2/35 px-5 py-[18px]">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-bold tracking-[-0.01em] text-bean-ink">
              {group.label}
            </h2>
            {group.orphan && (
              <span className="inline-flex items-center rounded-[6px] border border-bean-gold/35 bg-bean-gold/12 px-[7px] py-[2px] text-[9px] font-bold uppercase tracking-[0.1em] text-bean-gold">Unrecognised topic</span>
            )}
            {/* Deleted first, then what kind of topic it is — a deleted
                built-in can be brought back, an added one is gone for good, and
                the chip is what tells the two apart after the fact. */}
            {group.section?.isPublished === false && (
              <span className="inline-flex items-center rounded-[6px] border border-bean-live/35 bg-bean-live/10 px-[7px] py-[2px] text-[9px] font-bold uppercase tracking-[0.1em] text-bean-live">
                Deleted
              </span>
            )}
            {group.section && !group.section.builtIn && (
              <span className="inline-flex items-center rounded-[6px] border border-bean-brand/30 bg-bean-brand/10 px-[7px] py-[2px] text-[9px] font-bold uppercase tracking-[0.1em] text-bean-brand">Added topic</span>
            )}
          </div>
          {/* Says the whole address, so an edit or delete below is never
              made against something whose home the admin had to infer. */}
          <p className="mt-1 text-[10.5px] tracking-[0.04em] text-bean-faint">
            {campaignLabel}
            {group.key !== UNPINNED && !group.orphan && ` · ${group.key}`}
            {' · '}
            {group.articles.length} note{group.articles.length === 1 ? '' : 's'}
            {' · '}
            {group.recordings.length} recording{group.recordings.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Rename and remove apply to every topic. What removing means
              differs by kind, which is why the tooltip says which one. */}
          {group.section && (
            <div className="flex items-center gap-0.5">
              <RenamePopover
                {...panel('rename')}
                label="Rename this topic"
                value={group.section.label}
                hint={
                  group.section.builtIn
                    ? 'This is one of the guide\u2019s own topics. Renaming changes what agents see; the content filed here is untouched.'
                    : 'The topic keeps its key, so nothing filed here moves.'
                }
                onSubmit={(next) => onRenameTopic(group.section!, next)}
              >
                <IconBtn
                  label="Rename this topic"
                  active={openPanel === 'rename'}
                  onClick={() => setOpenPanel(openPanel === 'rename' ? null : 'rename')}
                >
                  <PencilGlyph className="h-[15px] w-[15px]" />
                </IconBtn>
              </RenamePopover>

              {group.section.isPublished === false ? (
                <IconBtn
                  label="Bring this topic back"
                  onClick={() => onRestoreTopic(group.section!)}
                >
                  <UndoGlyph className="h-[15px] w-[15px]" />
                </IconBtn>
              ) : (
                <ConfirmPopover
                  {...panel('deleteTopic')}
                  title={`Delete “${group.section.label}”?`}
                  confirmLabel="Delete"
                  body={
                    <>
                      Agents stop seeing this topic in the {campaignLabel} guide.
                      {total > 0 && (
                        <>
                          {' '}
                          It holds {group.articles.length} note
                          {group.articles.length === 1 ? '' : 's'} and {group.recordings.length}{' '}
                          recording{group.recordings.length === 1 ? '' : 's'}.
                        </>
                      )}
                      {group.section.builtIn && (
                        <>
                          {' '}
                          This one is built into the guide, so it can be brought back later;
                          anything you delete with it cannot.
                        </>
                      )}
                    </>
                  }
                  extra={
                    total > 0 ? (
                      // Opt in, and it resets each time the panel opens, so
                      // "delete everything" is never left armed from last time.
                      <label className="flex items-start gap-2 rounded-lg border border-bean-live/30 bg-bean-live/[0.07] px-2.5 py-2">
                        <input
                          type="checkbox"
                          checked={cascade}
                          onChange={(e) => setCascade(e.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 rounded border-bean-line text-bean-live focus:ring-bean-live"
                        />
                        <span className="text-[12px] leading-snug text-bean-ink">
                          Delete the {total} item{total === 1 ? '' : 's'} inside as well. Audio
                          files are removed for good.
                        </span>
                      </label>
                    ) : undefined
                  }
                  onConfirm={() => { onDeleteTopic(group.section!, cascade); setCascade(false); }}
                >
                  <IconBtn
                    danger
                    active={openPanel === 'deleteTopic'}
                    label="Delete this topic"
                    onClick={() => {
                      setCascade(false);
                      setOpenPanel(openPanel === 'deleteTopic' ? null : 'deleteTopic');
                    }}
                  >
                    <TrashGlyph className="h-[15px] w-[15px]" />
                  </IconBtn>
                </ConfirmPopover>
              )}

              <span className="mx-1.5 h-[22px] w-px bg-bean-line" aria-hidden />
            </div>
          )}

          <Btn onClick={onAddNote}>
            <PlusGlyph className="h-[15px] w-[15px]" />
            Note
          </Btn>
          <Btn onClick={() => fileRef.current?.click()} disabled={busy}>
            <UploadGlyph className="h-[15px] w-[15px]" />
            {busy ? 'Uploading…' : 'Upload'}
          </Btn>
          <Btn tone="solid" onClick={onOpenRecorder} disabled={busy}>
            <MicGlyph className="h-[15px] w-[15px]" />
            Record
          </Btn>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            multiple
            hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) onUpload(files);
            }}
          />
        </div>
      </header>

      {recorderOpen && (
        <div className="border-b border-bean-line px-5 py-4">
          <AudioRecorder busy={busy} onCancel={onCloseRecorder} onDone={onRecorded} />
        </div>
      )}

      {empty && !recorderOpen ? (
        <p className="px-5 py-7 text-[13.5px] text-bean-muted">
          Nothing here yet. Add a note agents will read on this topic, or attach the narration they
          will hear.
        </p>
      ) : (
        <div className="divide-y divide-bean-line">
          {group.articles.map((article) => (
            <div key={article.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
              <span className="mt-0.5 inline-flex shrink-0 items-center rounded-[5px] bg-bean-brand/10 px-[7px] py-[2px] text-[9px] font-bold uppercase tracking-[0.06em] text-bean-brand">Text</span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[14.5px] font-semibold text-bean-ink">{article.title}</p>
                  {!article.isPublished && (
                    <span className="inline-flex items-center rounded-[6px] border border-bean-line bg-bean-card2 px-[7px] py-[2px] text-[9px] font-bold uppercase tracking-[0.1em] text-bean-faint">Hidden</span>
                  )}
                </div>
                {article.summary && (
                  <p className="mt-0.5 truncate text-[13px] text-bean-muted">{article.summary}</p>
                )}
                <p className="mt-1 text-[10.5px] tracking-[0.03em] text-bean-faint">
                  /{article.slug} · order {article.sortOrder} · updated {formatDate(article.updatedAt)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                <IconBtn
                  label={article.isPublished ? 'Hide from agents' : 'Show to agents'}
                  onClick={() => onToggleNotePublished(article)}
                >
                  {article.isPublished ? (
                    <EyeOffGlyph className="h-[15px] w-[15px]" />
                  ) : (
                    <EyeGlyph className="h-[15px] w-[15px]" />
                  )}
                </IconBtn>
                <IconBtn label="Edit this note" onClick={() => onEditNote(article)}>
                  <PencilGlyph className="h-[15px] w-[15px]" />
                </IconBtn>
                <ConfirmPopover
                  {...panel(`note:${article.id}`)}
                  title={`Delete “${article.title}”?`}
                  body={
                    <>
                      Agents will no longer read this note. It sits under{' '}
                      <b className="font-semibold text-bean-ink">{group.label}</b> in{' '}
                      {campaignLabel}. This cannot be undone.
                    </>
                  }
                  onConfirm={() => onDeleteNote(article)}
                >
                  <IconBtn
                    danger
                    active={openPanel === `note:${article.id}`}
                    label="Delete this note"
                    onClick={() =>
                      setOpenPanel(openPanel === `note:${article.id}` ? null : `note:${article.id}`)
                    }
                  >
                    <TrashGlyph className="h-[15px] w-[15px]" />
                  </IconBtn>
                </ConfirmPopover>
              </div>
            </div>
          ))}

          {group.recordings.map((rec, i) => {
            const isRenaming = renaming?.id === rec.id;
            const duration = fmtDuration(rec.durationSeconds);
            const playing = playingId === rec.id;
            const frac = playing && timeFrac != null ? timeFrac : 0;
            const current = rec.durationSeconds
              ? fmtDuration(frac * rec.durationSeconds)
              : '0:00';
            return (
              <div key={rec.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                {/* Bigger, filled circular play button — the row now reads as
                    an audio player rather than a metadata line. */}
                <button
                  onClick={() => onPlay(rec)}
                  disabled={loadingId === rec.id}
                  title={playing ? 'Pause' : 'Play this recording'}
                  aria-label={playing ? 'Pause' : 'Play this recording'}
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-white shadow-[0_2px_6px_rgba(46,27,51,0.35)] transition-transform duration-150 hover:scale-[1.06] disabled:cursor-wait disabled:hover:scale-100 ${
                    playing ? 'bg-bean-brand-deep' : 'bg-bean-brand'
                  }`}
                >
                  {/* The bytes are fetched now, so a large file has a moment
                      where nothing would otherwise happen on the click. */}
                  {loadingId === rec.id ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : playing ? (
                    <PauseGlyph className="ml-0 h-[16px] w-[16px]" />
                  ) : (
                    <PlayGlyph className="ml-0.5 h-[16px] w-[16px]" />
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  {isRenaming ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const title = renaming!.title.trim();
                        if (title && title !== rec.title) onRenameRecording(rec, title);
                        setRenaming(null);
                      }}
                      className="flex flex-wrap gap-2"
                    >
                      <input
                        autoFocus
                        className={`${FIELD} max-w-sm`}
                        value={renaming!.title}
                        onChange={(e) => setRenaming({ id: rec.id, title: e.target.value })}
                      />
                      <Btn tone="solid" type="submit">Save</Btn>
                      <Btn type="button" onClick={() => setRenaming(null)}>Cancel</Btn>
                    </form>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14.5px] font-semibold text-bean-ink">{rec.title}</span>
                        <span className="rounded-[5px] bg-bean-gold/15 px-[7px] py-[2px] text-[9px] font-bold uppercase tracking-[0.06em] text-bean-gold">Audio</span>
                        {!rec.isPublished && (
                          <span className="inline-flex items-center rounded-[6px] border border-bean-line bg-bean-card2 px-[7px] py-[2px] text-[9px] font-bold uppercase tracking-[0.1em] text-bean-faint">Hidden</span>
                        )}
                      </div>

                      {/* The waveform doubles as a scrub bar — clicking anywhere
                          jumps the shared playhead to that point. */}
                      <Waveform frac={frac} onSeek={playing ? onSeek : undefined} />

                      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-bean-muted">
                        <span className="font-bold text-bean-brand-deep">{current}</span>
                        <span>/ {duration ?? '–'}</span>
                        <span>·</span>
                        <span>{rec.mimeType} · {fmtSize(rec.sizeBytes)}</span>
                        <span>·</span>
                        <span>added {formatDate(rec.createdAt)}</span>
                      </div>
                    </>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {/* Re-point without leaving the row, and without a dialog that
                      hides which topic it is currently on. */}
                  <label className="flex items-center gap-2 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-bean-faint">
                    Topic
                    <select
                      className={`${FIELD} max-w-[150px] py-1.5 text-[12.5px] font-semibold`}
                      value={rec.sectionKey ?? UNPINNED}
                      onChange={(e) => onMoveRecording(rec, e.target.value)}
                    >
                      {allSections.map((s) => (
                        <option key={s.key} value={s.key}>{shortLabel(s)}</option>
                      ))}
                      <option value={UNPINNED}>Not on a topic</option>
                      {rec.sectionKey && !allSections.some((s) => s.key === rec.sectionKey) && (
                        <option value={rec.sectionKey}>{rec.sectionKey} (unrecognised)</option>
                      )}
                    </select>
                  </label>

                  {/* Agents hear a topic's stack in this order. */}
                  {group.recordings.length > 1 && (
                    <span className="flex flex-col">
                      <button
                        onClick={() => onNudge(rec, -1)}
                        disabled={i === 0}
                        aria-label={`Move ${rec.title} up`}
                        className="px-1 text-[9px] leading-none text-bean-faint transition-colors hover:text-bean-ink disabled:opacity-25"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => onNudge(rec, 1)}
                        disabled={i === group.recordings.length - 1}
                        aria-label={`Move ${rec.title} down`}
                        className="px-1 text-[9px] leading-none text-bean-faint transition-colors hover:text-bean-ink disabled:opacity-25"
                      >
                        ▼
                      </button>
                    </span>
                  )}
                  <IconBtn
                    label="Rename this recording"
                    onClick={() => setRenaming({ id: rec.id, title: rec.title })}
                  >
                    <PencilGlyph className="h-[15px] w-[15px]" />
                  </IconBtn>
                  <IconBtn
                    label={rec.isPublished ? 'Hide from agents' : 'Show to agents'}
                    onClick={() => onToggleRecordingPublished(rec)}
                  >
                    {rec.isPublished ? (
                      <EyeOffGlyph className="h-[15px] w-[15px]" />
                    ) : (
                      <EyeGlyph className="h-[15px] w-[15px]" />
                    )}
                  </IconBtn>
                  <ConfirmPopover
                    {...panel(`rec:${rec.id}`)}
                    title={`Delete “${rec.title}”?`}
                    body={
                      <>
                        Agents will no longer hear this, and the audio file is removed. It sits
                        under <b className="font-semibold text-bean-ink">{group.label}</b> in{' '}
                        {campaignLabel}. This cannot be undone.
                      </>
                    }
                    onConfirm={() => onDeleteRecording(rec)}
                  >
                    <IconBtn
                      danger
                      active={openPanel === `rec:${rec.id}`}
                      label="Delete this recording"
                      onClick={() =>
                        setOpenPanel(openPanel === `rec:${rec.id}` ? null : `rec:${rec.id}`)
                      }
                    >
                      <TrashGlyph className="h-[15px] w-[15px]" />
                    </IconBtn>
                  </ConfirmPopover>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── the waveform ─────────────────────────────────────────────

/**
 * The row's scrub bar. Bars are deterministic — a sine envelope plus a
 * per-index jitter — so the shape is stable across re-renders and between
 * admin and agent views of the same file. Clicking anywhere jumps the shared
 * playhead to that point.
 */
function Waveform({ frac, onSeek }: { frac: number; onSeek?: (f: number) => void }) {
  const bars = useMemo(
    () => Array.from({ length: 60 }, (_, i) =>
      4 + Math.round(Math.abs(Math.sin(i * 0.5)) * 16 + ((i * 37) % 5))),
    [],
  );

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const f = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    onSeek(f);
  }

  return (
    <div
      onClick={seek}
      role="slider"
      aria-label="Seek in recording"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(frac * 100)}
      className="mt-1.5 flex h-6 cursor-pointer items-center gap-[2px]"
    >
      {bars.map((h, i) => (
        <span
          key={i}
          className={`w-[3px] shrink-0 rounded-[2px] ${
            i / (bars.length - 1) < frac ? 'bg-bean-brand' : 'bg-bean-line'
          }`}
          style={{ height: h }}
        />
      ))}
    </div>
  );
}

// ── the text editor ──────────────────────────────────────────

function ArticleForm({
  editing, setEditing, sections, campaigns, onSubmit, onCancel,
}: {
  editing: typeof EMPTY_ARTICLE;
  setEditing: (fn: (s: typeof EMPTY_ARTICLE | null) => typeof EMPTY_ARTICLE | null) => void;
  sections: Section[];
  campaigns: typeof CAMPAIGNS;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<typeof EMPTY_ARTICLE>) =>
    setEditing((s) => (s ? { ...s, ...patch } : s));

  return (
    <form onSubmit={onSubmit} className="bean-card mb-6 overflow-hidden rounded-[20px] border">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-bean-line bg-bean-card2/45 px-6 py-5">
        <div>
          <button
            type="button"
            onClick={onCancel}
            className="mb-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-bean-muted transition hover:text-bean-ink"
          >
            ← Back to Product Knowledge
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-[19px] font-extrabold tracking-[-0.02em] text-bean-ink">
              {editing.id ? 'Edit knowledge note' : 'Create knowledge note'}
            </h2>
            <span className="rounded-full border border-bean-line bg-bean-card px-2.5 py-0.5 text-[10.5px] font-semibold text-bean-muted">
              {editing.campaign}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-bean-muted">
            Agents read this under the selected guide topic. Required fields are marked with an asterisk.
          </p>
        </div>
        <Btn type="button" onClick={onCancel}>Close</Btn>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-bean-muted">Product *</label>
            <select
              className={FIELD}
              value={editing.campaign}
              onChange={(e) => set({ campaign: e.target.value, sectionKey: '' })}
            >
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-bean-muted">Topic</label>
            <select
              className={FIELD}
              value={editing.sectionKey}
              onChange={(e) => set({ sectionKey: e.target.value })}
            >
              <option value="">Not on a topic (campaign list)</option>
              {sections.map((s) => (
                <option key={s.key} value={s.key}>{shortLabel(s)}</option>
              ))}
            </select>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-bean-faint">
              Where in the guide this note appears.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-bean-muted">Title *</label>
            <input
              required
              className={FIELD}
              value={editing.title}
              onChange={(e) => {
                const title = e.target.value;
                set({
                  title,
                  ...(editing.id
                    ? {}
                    : {
                        slug: title
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, '-')
                          .replace(/^-|-$/g, ''),
                      }),
                });
              }}
              placeholder="e.g. Eligibility reminders"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-bean-muted">Slug *</label>
            <input
              required
              pattern="[a-z0-9-]+"
              className={`${FIELD} font-mono-ui text-[12.5px]`}
              value={editing.slug}
              onChange={(e) => set({ slug: e.target.value })}
              placeholder="eligibility-reminders"
            />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-bean-faint">Lowercase letters, numbers and hyphens only.</p>
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-semibold text-bean-muted">Order</label>
            <input
              type="number"
              className={FIELD}
              value={editing.sortOrder}
              onChange={(e) => set({ sortOrder: Number(e.target.value) })}
            />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-bean-faint">Lower numbers appear first within the topic.</p>
          </div>

          <div className="flex items-end pb-1">
            <label className="flex min-h-[42px] cursor-pointer items-center gap-3 rounded-xl border border-bean-line bg-bean-card2/45 px-3.5 py-2.5">
              <input
                type="checkbox"
                checked={editing.isPublished}
                onChange={(e) => set({ isPublished: e.target.checked })}
                className="h-4 w-4 rounded border-bean-line text-bean-brand focus:ring-bean-brand"
              />
              <span>
                <span className="block text-[12.5px] font-semibold text-bean-ink">Visible to agents</span>
                <span className="block text-[10.5px] text-bean-faint">Publish this note in the guide</span>
              </span>
            </label>
          </div>

          <div className="md:col-span-2">
            <label className="mb-1.5 block text-[12px] font-semibold text-bean-muted">Summary</label>
            <input
              className={FIELD}
              placeholder="One-line context shown below the title"
              value={editing.summary}
              onChange={(e) => set({ summary: e.target.value })}
            />
          </div>

          <div className="md:col-span-2">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <label className="text-[12px] font-semibold text-bean-muted">Content (Markdown) *</label>
              <span className="text-[10.5px] text-bean-faint">Markdown supported</span>
            </div>
            <textarea
              required
              rows={14}
              className={`${FIELD} resize-y font-mono text-[12.5px] leading-relaxed`}
              value={editing.bodyMarkdown}
              onChange={(e) => set({ bodyMarkdown: e.target.value })}
              placeholder="Write the knowledge agents should see..."
            />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-bean-faint">
              Supports ## headings, - bullets, 1. numbered lists, **bold**, *italic*, `code`, &gt; quotes and links.
            </p>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-bean-line bg-bean-card px-6 py-4 shadow-[0_-8px_24px_rgba(0,0,0,0.04)]">
        <p className="hidden text-[11.5px] text-bean-faint sm:block">
          {editing.id ? 'Saving updates this note for agents immediately.' : 'The note is added to the selected guide topic.'}
        </p>
        <div className="ml-auto flex gap-2.5">
          <Btn type="button" onClick={onCancel}>Cancel</Btn>
          <Btn tone="solid" type="submit">{editing.id ? 'Save changes' : 'Save note'}</Btn>
        </div>
      </div>
    </form>
  );
}

function KnowledgeMetric({ label, value, helper }: { label: string; value: number; helper: string }) {
  return (
    <div className="bean-card rounded-[16px] border px-4 py-3.5">
      <div className="text-[11.5px] font-semibold text-bean-muted">{label}</div>
      <div className="mt-1 font-display text-[22px] font-extrabold tracking-[-0.03em] text-bean-ink">{value}</div>
      <div className="mt-0.5 text-[10.5px] text-bean-faint">{helper}</div>
    </div>
  );
}

// ── controls ─────────────────────────────────────────────────

/**
 * The two button weights this page uses.
 *
 * `solid` is the one action a panel is for; `quiet` is everything else. They
 * are components rather than the global .btn-primary / .btn-secondary classes
 * because those are built on white and grey and only had a dark-theme remap —
 * on the bright theme they punched holes in the warm surface.
 */
function Btn({
  tone = 'quiet',
  danger,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'solid' | 'quiet';
  danger?: boolean;
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition duration-150 disabled:cursor-not-allowed disabled:opacity-50';

  const look =
    tone === 'solid'
      ? 'bg-gradient-to-r from-bean-brand to-bean-brand-bright text-white hover:-translate-y-px disabled:translate-y-0'
      : danger
        ? 'border border-bean-live/35 bg-bean-live/[0.08] text-bean-live hover:bg-bean-live/15'
        : 'border border-bean-line bg-bean-card text-bean-muted hover:border-bean-line2 hover:text-bean-ink';

  return <button {...rest} className={`${base} ${look} ${className}`} />;
}

/** A square control carrying only a glyph; the label is its tooltip. */
function IconBtn({
  label,
  danger,
  active,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      {...rest}
      type="button"
      title={label}
      aria-label={label}
      className={`grid h-7 w-7 place-items-center rounded-full border transition duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'border-transparent text-bean-faint hover:border-bean-live/35 hover:bg-bean-live/10 hover:text-bean-live'
          : active
            ? 'border-bean-brand/30 bg-bean-brand/10 text-bean-brand'
            : 'border-transparent text-bean-faint hover:border-bean-line hover:bg-bean-card2 hover:text-bean-ink'
      }`}
    >
      {children}
    </button>
  );
}

/** Themed text input; the global .input is white-on-white in the bright theme. */
const FIELD =
  'block w-full rounded-xl border border-bean-line bg-bean-card px-3.5 py-2.5 text-[13.5px] text-bean-ink outline-none transition placeholder:text-bean-faint focus:border-bean-brand';

const S = { fill: 'none', strokeWidth: 1.9, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
const g = (d: string) => <path strokeLinecap="round" strokeLinejoin="round" d={d} />;

const PencilGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{g('M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125')}</svg>;
const TrashGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{g('M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166M18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0')}</svg>;
const EyeOffGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{g('M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65')}</svg>;
const EyeGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{g('M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z')}{g('M15 12a3 3 0 11-6 0 3 3 0 016 0z')}</svg>;
const PlayGlyph = ({ className }: any) => <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>;
const PauseGlyph = ({ className }: any) => <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>;
const PlusGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{g('M12 4.5v15m7.5-7.5h-15')}</svg>;
const UploadGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{g('M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z')}</svg>;
const MicGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{g('M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z')}</svg>;
const UndoGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{g('M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3')}</svg>;
const InfoGlyph = ({ className }: any) => <svg className={className} {...S} stroke="currentColor">{g('M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z')}</svg>;
