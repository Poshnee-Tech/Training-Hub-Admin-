'use client';

/**
 * Knowledge screens.
 *
 * A guide topic's screen is a list of blocks — plan tiers, carrier badges, the
 * rows of the comparison table. This is where they are edited.
 *
 * The form is built from the server's kind registry rather than hardcoded per
 * shape: `listBlockKinds` returns each shape's fields and this page renders an
 * input per field. A shape gaining a field reaches this editor without a
 * release here, and the same registry validates the save, so what the form
 * offers and what the server accepts cannot drift apart.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminSidebar from '@/components/layout/AdminSidebar';
import { useAuthStore } from '@/store/auth.store';
import {
  contentApi,
  type BlockField,
  type BlockKind,
  type KnowledgeBlock,
} from '@/lib/api';

const CAMPAIGNS = [
  { value: 'ACA', label: 'ACA' },
  { value: 'MEDICARE', label: 'Medicare' },
] as const;

/**
 * The icon names the guide can render.
 *
 * Kept in step with the agent portal's registry by hand — a name this list
 * offers that the guide does not know renders as a neutral fallback there
 * rather than breaking, so drift is visible and harmless.
 */
const ICON_NAMES = [
  'Accessibility', 'Activity', 'Ambulance', 'Baby', 'BadgeCheck', 'BadgePercent', 'Ban',
  'Banknote', 'BarChart3', 'BedDouble', 'BookMarked', 'Brain', 'Briefcase', 'Building2',
  'CalendarClock', 'Car', 'Check', 'CircleX', 'ClipboardCheck', 'CreditCard', 'Dumbbell',
  'Ear', 'Eye', 'FileText', 'Gift', 'Globe', 'HeartHandshake', 'HeartPulse', 'Info',
  'Landmark', 'Layers', 'MapPin', 'Microscope', 'NotebookPen', 'PhoneCall', 'Pill',
  'Puzzle', 'Quote', 'ScrollText', 'ShieldCheck', 'ShieldPlus', 'Smile', 'Sparkles',
  'Stethoscope', 'Store', 'Syringe', 'User', 'UserCheck', 'Users', 'Wallet',
];

/**
 * A one-line preview of a block, so a list of rows is readable at a glance.
 *
 * Icons and colours are skipped even though they come first in several shapes'
 * field order — an add-on row summarised by its icon read "Store", "CreditCard",
 * "Ear", which names the glyph and not the thing.
 */
function summarise(block: KnowledgeBlock, kinds: BlockKind[]): string {
  const spec = kinds.find((k) => k.kind === block.kind);
  if (!spec) return JSON.stringify(block.data).slice(0, 80);
  for (const field of spec.fields) {
    if (field.type === 'icon' || field.type === 'color') continue;
    const value = block.data[field.name];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return `(${spec.label})`;
}

function emptyData(spec: BlockKind): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of spec.fields) {
    out[field.name] = field.type === 'boolean' ? false : field.type === 'list' ? [] : '';
  }
  return out;
}

export default function KnowledgeScreensPage() {
  const { token, loadFromStorage } = useAuthStore();

  const [campaign, setCampaign] = useState<string>('ACA');
  const [kinds, setKinds] = useState<BlockKind[]>([]);
  const [blocks, setBlocks] = useState<KnowledgeBlock[]>([]);
  const [openSection, setOpenSection] = useState<string | null>(null);
  /** Topic key -> the label an admin actually named it, for the section headers. */
  const [sectionLabels, setSectionLabels] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  /** The row being edited, held as a draft so a cancel changes nothing. */
  const [editing, setEditing] = useState<{ id: string; kind: string; data: Record<string, unknown> } | null>(null);
  /** A new row being composed, before it exists on the server. */
  const [adding, setAdding] = useState<{ sectionKey: string; kind: string; data: Record<string, unknown> } | null>(null);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const [kindRes, blockRes, sectionRes] = await Promise.all([
        contentApi.listBlockKinds(token),
        contentApi.listBlocks(token, campaign),
        // Labels only — a header reading "capture" tells a trainer nothing;
        // "Call checklist" is the topic they know.
        contentApi.listKnowledgeSections(token).catch(() => null),
      ]);
      setKinds(kindRes.data);
      setBlocks(blockRes.data);
      const forCampaign = sectionRes?.data?.[campaign] ?? [];
      setSectionLabels(
        Object.fromEntries(
          (forCampaign as { key: string; label: string }[]).map((x) => [x.key, x.label]),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the screens.');
    } finally {
      setLoading(false);
    }
  }, [token, campaign]);

  useEffect(() => { void load(); }, [load]);

  /** Blocks grouped by topic, then by shape — the order the guide reads them. */
  const bySection = useMemo(() => {
    const out: Record<string, Record<string, KnowledgeBlock[]>> = {};
    for (const block of blocks) {
      const section = (out[block.sectionKey] ??= {});
      (section[block.kind] ??= []).push(block);
    }
    for (const section of Object.values(out)) {
      for (const list of Object.values(section)) list.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return out;
  }, [blocks]);

  const sectionKeys = useMemo(() => Object.keys(bySection).sort(), [bySection]);

  async function saveEdit() {
    if (!token || !editing) return;
    setBusy(editing.id);
    setError('');
    try {
      await contentApi.updateBlock(token, editing.id, { data: editing.data });
      setEditing(null);
      setNotice('Saved. Agents see it on their next load.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that block.');
    } finally {
      setBusy('');
    }
  }

  async function saveNew() {
    if (!token || !adding) return;
    setBusy('new');
    setError('');
    try {
      await contentApi.createBlock(token, {
        campaign,
        sectionKey: adding.sectionKey,
        kind: adding.kind,
        data: adding.data,
      });
      setAdding(null);
      setNotice('Added.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that block.');
    } finally {
      setBusy('');
    }
  }

  async function remove(block: KnowledgeBlock) {
    if (!token) return;
    // Deleting content an agent is reading deserves a beat of friction.
    if (!window.confirm(`Delete this ${block.kind}? Agents will stop seeing it immediately.`)) return;
    setBusy(block.id);
    try {
      await contentApi.deleteBlock(token, block.id);
      setNotice('Deleted.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that block.');
    } finally {
      setBusy('');
    }
  }

  async function move(list: KnowledgeBlock[], index: number, delta: number) {
    if (!token) return;
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(list[index].id);
    try {
      await contentApi.reorderBlocks(token, next.map((b) => b.id));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reorder those.');
    } finally {
      setBusy('');
    }
  }

  function renderField(
    field: BlockField,
    value: unknown,
    onChange: (next: unknown) => void,
  ) {
    const common = 'w-full rounded-lg border border-bean-line bg-white px-3 py-2 text-[13.5px] text-bean-ink outline-none focus:border-bean-ink';

    if (field.type === 'boolean') {
      return (
        <label className="flex items-center gap-2 text-[13.5px] text-bean-ink">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          {field.label}
        </label>
      );
    }
    if (field.type === 'list') {
      // One per line is the least surprising editor for a short list, and it
      // round-trips cleanly: split on save, join on load.
      return (
        <textarea
          rows={4}
          className={common}
          value={Array.isArray(value) ? (value as string[]).join('\n') : ''}
          onChange={(e) => onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
        />
      );
    }
    if (field.type === 'icon') {
      return (
        <select className={common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">(none)</option>
          {ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      );
    }
    if (field.type === 'color') {
      return (
        <div className="flex items-center gap-2">
          <input
            type="color"
            className="h-9 w-12 rounded border border-bean-line"
            value={/^#[0-9a-fA-F]{6}$/.test(String(value ?? '')) ? String(value) : '#888888'}
            onChange={(e) => onChange(e.target.value)}
          />
          <input className={common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    }
    if (field.type === 'number') {
      return (
        <input
          type="number"
          className={common}
          value={value === '' || value === undefined ? '' : Number(value)}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      );
    }
    if (field.type === 'longtext') {
      return (
        <textarea rows={3} className={common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      );
    }
    return <input className={common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }

  function fieldsFor(kind: string, data: Record<string, unknown>, onChange: (next: Record<string, unknown>) => void) {
    const spec = kinds.find((k) => k.kind === kind);
    if (!spec) return <p className="text-[13px] text-bean-mute">Unknown shape “{kind}”.</p>;
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {spec.fields.map((field) => (
          <label key={field.name} className="block">
            <span className="mb-1 block text-[12px] font-semibold text-bean-ink">
              {field.label}
              {field.required && <span className="text-red-600"> *</span>}
            </span>
            {renderField(field, data[field.name], (next) => onChange({ ...data, [field.name]: next }))}
            {field.hint && <span className="mt-1 block text-[11.5px] text-bean-mute">{field.hint}</span>}
          </label>
        ))}
      </div>
    );
  }

  return (
    // Same shell as every other admin page: the sidebar is `fixed w-64`, so the
    // content is offset with ml-64 rather than laid out beside it — a flex
    // sibling has no width reserved for it and slides underneath. `bean-scope`
    // is what defines the bean-* tokens this page paints with; without it they
    // resolve to nothing and the page renders as a white sheet.
    <div className="relative flex">
      <AdminSidebar />
      <main className="bean-scope relative ml-64 min-h-screen flex-1 bg-bean-bg p-8 font-body text-bean-ink antialiased">
        <header className="mb-6">
          <h1 className="font-display text-[26px] font-extrabold tracking-[-0.03em] text-bean-ink">Knowledge screens</h1>
          <p className="mt-1 max-w-[70ch] text-[13.5px] text-bean-mute">
            Everything on a topic&rsquo;s screen in the agent guide — the tiers, the carriers, the
            comparison rows, the cheat sheet. Editing here changes what agents read; there is no
            copy of any of this left in the app.
          </p>
        </header>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          {CAMPAIGNS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => { setCampaign(c.value); setOpenSection(null); setEditing(null); setAdding(null); }}
              className={`rounded-lg border px-3.5 py-1.5 text-[13px] font-semibold ${
                campaign === c.value
                  ? 'border-bean-ink bg-bean-ink text-white'
                  : 'border-bean-line bg-white text-bean-ink'
              }`}
            >
              {c.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-bean-line bg-white px-3.5 py-1.5 text-[13px] font-semibold text-bean-ink"
          >
            Refresh
          </button>
        </div>

        {error && <p className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-800">{error}</p>}
        {notice && <p className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-800">{notice}</p>}

        {loading ? (
          <p className="text-[13.5px] text-bean-mute">Loading…</p>
        ) : sectionKeys.length === 0 ? (
          <p className="text-[13.5px] text-bean-mute">No screens for this campaign yet.</p>
        ) : (
          <div className="grid gap-3">
            {sectionKeys.map((sectionKey) => {
              const kindGroups = bySection[sectionKey];
              const count = Object.values(kindGroups).flat().length;
              const isOpen = openSection === sectionKey;

              return (
                <section key={sectionKey} className="rounded-xl border border-bean-line bg-white">
                  <button
                    type="button"
                    onClick={() => setOpenSection(isOpen ? null : sectionKey)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <span className="font-display text-[16px] font-semibold text-bean-ink">
                      {sectionLabels[sectionKey] ?? sectionKey}
                    </span>
                    <span className="text-[12.5px] text-bean-mute">{count} blocks</span>
                  </button>

                  {isOpen && (
                    <div className="border-t border-bean-line px-4 py-4">
                      {Object.entries(kindGroups).map(([kind, list]) => (
                        <div key={kind} className="mb-5 last:mb-0">
                          <p className="mb-2 font-mono text-[11px] uppercase tracking-wider text-bean-mute">
                            {kinds.find((k) => k.kind === kind)?.label ?? kind} · {list.length}
                          </p>

                          <ul className="grid gap-2">
                            {list.map((block, i) => (
                              <li key={block.id} className="rounded-lg border border-bean-line px-3 py-2.5">
                                {editing?.id === block.id ? (
                                  <div className="grid gap-3">
                                    {fieldsFor(block.kind, editing.data, (data) => setEditing({ ...editing, data }))}
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        disabled={busy === block.id}
                                        onClick={() => void saveEdit()}
                                        className="rounded-lg bg-bean-ink px-3.5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
                                      >
                                        {busy === block.id ? 'Saving…' : 'Save'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditing(null)}
                                        className="rounded-lg border border-bean-line px-3.5 py-1.5 text-[13px] font-semibold text-bean-ink"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-bean-ink">
                                      {summarise(block, kinds)}
                                    </span>
                                    <span className="flex shrink-0 items-center gap-1.5">
                                      <button type="button" onClick={() => void move(list, i, -1)} disabled={i === 0} className="rounded border border-bean-line px-2 py-1 text-[12px] disabled:opacity-30">↑</button>
                                      <button type="button" onClick={() => void move(list, i, 1)} disabled={i === list.length - 1} className="rounded border border-bean-line px-2 py-1 text-[12px] disabled:opacity-30">↓</button>
                                      <button type="button" onClick={() => setEditing({ id: block.id, kind: block.kind, data: { ...block.data } })} className="rounded border border-bean-line px-2.5 py-1 text-[12px] font-semibold">Edit</button>
                                      <button type="button" onClick={() => void remove(block)} className="rounded border border-red-300 px-2.5 py-1 text-[12px] font-semibold text-red-700">Delete</button>
                                    </span>
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}

                      {adding?.sectionKey === sectionKey ? (
                        <div className="mt-4 rounded-lg border border-bean-line bg-bean-bg/40 p-3.5">
                          <label className="mb-3 block">
                            <span className="mb-1 block text-[12px] font-semibold text-bean-ink">Shape</span>
                            <select
                              className="w-full rounded-lg border border-bean-line bg-white px-3 py-2 text-[13.5px]"
                              value={adding.kind}
                              onChange={(e) => {
                                const spec = kinds.find((k) => k.kind === e.target.value);
                                setAdding({ ...adding, kind: e.target.value, data: spec ? emptyData(spec) : {} });
                              }}
                            >
                              {kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                            </select>
                            <span className="mt-1 block text-[11.5px] text-bean-mute">
                              {kinds.find((k) => k.kind === adding.kind)?.description}
                            </span>
                          </label>
                          {fieldsFor(adding.kind, adding.data, (data) => setAdding({ ...adding, data }))}
                          <div className="mt-3 flex gap-2">
                            <button type="button" disabled={busy === 'new'} onClick={() => void saveNew()} className="rounded-lg bg-bean-ink px-3.5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50">
                              {busy === 'new' ? 'Adding…' : 'Add block'}
                            </button>
                            <button type="button" onClick={() => setAdding(null)} className="rounded-lg border border-bean-line px-3.5 py-1.5 text-[13px] font-semibold text-bean-ink">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const spec = kinds[0];
                            setAdding({ sectionKey, kind: spec?.kind ?? '', data: spec ? emptyData(spec) : {} });
                          }}
                          className="mt-3 rounded-lg border border-bean-line bg-white px-3.5 py-1.5 text-[13px] font-semibold text-bean-ink"
                        >
                          Add a block
                        </button>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
