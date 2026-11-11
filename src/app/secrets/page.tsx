'use client';

/**
 * /secrets — server settings and API keys. Super Admin only, and HIDDEN: no
 * link anywhere in the portal. Anyone else is answered "not found" by the
 * server, and this page shows the same.
 *
 * Flow: edit values → Test (checks a key with its provider, saves nothing) →
 * Review (the server confirms the change is valid AND that the service would
 * still start with it) → password → Apply. In production the server waits for
 * 0 live calls, saves to AWS, restarts, and rolls back if it is not healthy;
 * this page follows that through `status`.
 *
 * Credential values are never sent to the browser — only their last four
 * characters. A new value typed here goes to the server once, on Test or Apply.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import AdminSidebar from '@/components/layout/AdminSidebar';
import { useAuthStore } from '@/store/auth.store';
import { secrets, type SecretChanges, type SecretSetting, type SecretState, type SecretsOverview } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const IN_PROGRESS: SecretState[] = ['requested', 'waiting_for_calls', 'applying'];

const STATE_TEXT: Record<string, { label: string; tone: string }> = {
  requested: { label: 'Waiting for the server', tone: 'text-amber-700 bg-amber-50 ring-amber-200' },
  waiting_for_calls: { label: 'Waiting for live calls to end', tone: 'text-amber-700 bg-amber-50 ring-amber-200' },
  applying: { label: 'Applying and restarting', tone: 'text-amber-700 bg-amber-50 ring-amber-200' },
  applied: { label: 'Applied', tone: 'text-emerald-700 bg-emerald-50 ring-emerald-200' },
  rolled_back: { label: 'Rolled back', tone: 'text-red-700 bg-red-50 ring-red-200' },
  timed_out: { label: 'Not applied (calls kept going)', tone: 'text-red-700 bg-red-50 ring-red-200' },
  failed: { label: 'Failed', tone: 'text-red-700 bg-red-50 ring-red-200' },
  cancelled: { label: 'Cancelled', tone: 'text-gray-700 bg-gray-50 ring-gray-200' },
};

type TestResult = { ok: boolean; message: string };

export default function SecretsPage() {
  const { token, user, loadFromStorage } = useAuthStore();

  const [data, setData] = useState<SecretsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const [edits, setEdits] = useState<SecretChanges>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [tests, setTests] = useState<Record<string, TestResult | 'running'>>({});
  const [filter, setFilter] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const [review, setReview] = useState<{ problems: string[]; bootProblems: string[] } | null>(null);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

  const load = useCallback(async (quiet = false) => {
    if (!token) return;
    if (!quiet) setLoading(true);
    try {
      const res = await secrets.overview(token);
      setData(res.data);
      setError('');
      setRestarting(false);
    } catch (err: any) {
      const message = String(err?.message || '');
      if (/not found/i.test(message)) setHidden(true);
      // While the server restarts to apply a change it does not answer for a
      // few seconds. That is the change working, not an error.
      else if (quiet && /Cannot reach the server/i.test(message)) setRestarting(true);
      else setError(message || 'Could not load the settings.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Follow a change while the server works on it.
  const inProgress = !!data?.status && IN_PROGRESS.includes(data.status.state);
  useEffect(() => {
    if (!inProgress && !restarting) return;
    const id = setInterval(() => load(true), 4000);
    return () => clearInterval(id);
  }, [inProgress, restarting, load]);

  const changes = useMemo(() => {
    const out: SecretChanges = {};
    for (const [key, value] of Object.entries(edits)) {
      if (value === null || value.length > 0) out[key] = value;
    }
    return out;
  }, [edits]);
  const changeCount = Object.keys(changes).length;

  const rows = useMemo(() => {
    const q = filter.trim().toUpperCase();
    const all = data?.settings ?? [];
    return q ? all.filter((s) => s.key.includes(q)) : all;
  }, [data, filter]);

  const existing = useMemo(() => new Set((data?.settings ?? []).map((s) => s.key)), [data]);
  const added = Object.keys(changes).filter((k) => !existing.has(k));

  const setEdit = (key: string, value: string | null | undefined) => {
    setReview(null);
    setEdits((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
    setTests((prev) => { const next = { ...prev }; delete next[key]; return next; });
  };

  const runTest = async (key: string) => {
    if (!token) return;
    setTests((prev) => ({ ...prev, [key]: 'running' }));
    try {
      const typed = edits[key];
      const res = await secrets.test(token, key, typeof typed === 'string' && typed ? typed : undefined, changes);
      setTests((prev) => ({ ...prev, [key]: res.data }));
    } catch (err: any) {
      setTests((prev) => ({ ...prev, [key]: { ok: false, message: err?.message || 'Test failed.' } }));
    }
  };

  const addSetting = () => {
    const key = newKey.trim().toUpperCase();
    if (!key || !newValue) return;
    setEdit(key, newValue);
    setNewKey('');
    setNewValue('');
  };

  const runReview = async () => {
    if (!token || changeCount === 0) return;
    setError('');
    try {
      const res = await secrets.check(token, changes);
      setReview(res.data);
    } catch (err: any) {
      setError(err?.message || 'Could not check the change.');
    }
  };

  const apply = async () => {
    if (!token || !password) return;
    setSubmitting(true);
    setError('');
    try {
      await secrets.apply(token, changes, password);
      setEdits({});
      setTests({});
      setReview(null);
      setPassword('');
      await load(true);
    } catch (err: any) {
      setError(err?.message || 'Could not apply the change.');
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Save ONE setting from its own row: the same server checks as the review
   * (valid change, server would still start), the same password, but only
   * this key — other edits on the page stay as they are.
   */
  const saveOne = async (key: string, pw: string): Promise<string | null> => {
    if (!token) return 'Not signed in.';
    const value = edits[key];
    if (value === undefined || value === '') return 'Type a new value first.';
    const one: SecretChanges = { [key]: value };
    try {
      const check = await secrets.check(token, one);
      const problems = [...check.data.problems, ...check.data.bootProblems];
      if (problems.length) return problems.join('\n');
      await secrets.apply(token, one, pw);
      setEdits((prev) => { const next = { ...prev }; delete next[key]; return next; });
      setTests((prev) => { const next = { ...prev }; delete next[key]; return next; });
      setReview(null);
      await load(true);
      return null;
    } catch (err: any) {
      return err?.message || 'Could not save.';
    }
  };

  const cancel = async () => {
    if (!token) return;
    try {
      await secrets.cancel(token);
      await load(true);
    } catch (err: any) {
      setError(err?.message || 'Could not cancel.');
    }
  };

  if (hidden || (user && user.role !== 'SUPER_ADMIN')) {
    return (
      <div className="flex">
        <AdminSidebar />
        <main className="mt-14 min-w-0 flex-1 px-4 py-24 text-center lg:mt-0 lg:ml-64">
          <h1 className="text-xl font-bold text-gray-900">Page not found</h1>
        </main>
      </div>
    );
  }

  const status = data?.status;
  const tone = status ? STATE_TEXT[status.state] ?? STATE_TEXT.failed : null;
  const locked = inProgress || submitting;

  return (
    <div className="flex">
      <AdminSidebar />
      <main className="mt-14 min-w-0 flex-1 px-4 py-7 sm:px-6 lg:mt-0 lg:ml-64 lg:px-8">
        <div className="mx-auto w-full max-w-[1200px] space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-gray-900">Server settings</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-600">
              API keys and settings the server runs with. Keys show only their last four characters.
              {data?.mode === 'helper'
                ? ' Applying saves to AWS and restarts the server when no call is live; if it does not come back healthy, the previous settings are restored automatically.'
                : data?.mode === 'file'
                  ? ' Local development: changes are written to the backend .env, and the dev server restarts by itself.'
                  : ''}
            </p>
          </header>

          {error && <pre className="whitespace-pre-wrap rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">{error}</pre>}

          {restarting && (
            <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
              The server is restarting with the new settings…
            </div>
          )}

          {status && tone && (
            <section className={`rounded-xl px-4 py-3 text-sm ring-1 ${tone.tone}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <strong>{tone.label}</strong>
                  {status.keys?.length ? <span> · {status.keys.join(', ')}</span> : null}
                  <span className="opacity-70"> · {formatDate(status.updatedAt)}</span>
                  {status.message && <p className="mt-1">{status.message}</p>}
                  {status.stuck && (
                    <p className="mt-1 font-semibold">
                      The server helper has not picked this up. It may not be installed on this server yet.
                    </p>
                  )}
                </div>
                {status.state === 'requested' && (
                  <button type="button" className="btn-secondary" onClick={cancel}>Cancel</button>
                )}
              </div>
            </section>
          )}

          {loading ? (
            <div className="card animate-pulse text-sm text-gray-500">Loading settings…</div>
          ) : data?.mode === 'off' ? (
            <div className="card text-sm text-gray-600">Changing settings from this page is turned off on this server (SECRETS_MODE=off).</div>
          ) : data && (
            <>
              <section className="card space-y-4 !p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
                  <h2 className="font-semibold text-gray-900">{data.settings.length} settings</h2>
                  <input
                    className="input max-w-xs"
                    placeholder="Search, e.g. AZURE"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] table-fixed text-sm">
                    <colgroup><col className="w-[26%]" /><col className="w-[20%]" /><col className="w-[30%]" /><col className="w-[24%]" /></colgroup>
                    <thead>
                      <tr className="border-y border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="px-5 py-2.5">Setting</th>
                        <th className="px-3 py-2.5">Current</th>
                        <th className="px-3 py-2.5">New value</th>
                        <th className="px-5 py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((s) => (
                        <SettingRowView
                          key={s.key}
                          setting={s}
                          edit={edits[s.key]}
                          revealed={!!reveal[s.key]}
                          test={tests[s.key]}
                          disabled={locked}
                          onEdit={(v) => setEdit(s.key, v)}
                          onReveal={() => setReveal((p) => ({ ...p, [s.key]: !p[s.key] }))}
                          onTest={() => runTest(s.key)}
                          onSave={(pw) => saveOne(s.key, pw)}
                        />
                      ))}
                      {added.map((key) => (
                        <AddedRowView
                          key={key}
                          settingKey={key}
                          disabled={locked}
                          onSave={(pw) => saveOne(key, pw)}
                          onUndo={() => setEdit(key, undefined)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-end gap-3 border-t border-gray-100 px-5 pb-5 pt-4">
                  <label className="min-w-[220px] flex-1 text-xs font-semibold text-gray-600">
                    Add a setting
                    <input
                      className="input mt-1 font-mono"
                      list="known-keys"
                      placeholder="NAME_OF_SETTING"
                      value={newKey}
                      disabled={locked}
                      onChange={(e) => setNewKey(e.target.value.toUpperCase())}
                    />
                    <datalist id="known-keys">
                      {data.knownKeys.filter((k) => !existing.has(k)).map((k) => <option key={k} value={k} />)}
                    </datalist>
                  </label>
                  <label className="min-w-[220px] flex-1 text-xs font-semibold text-gray-600">
                    Value
                    <ValueInput masked className="mt-1" value={newValue} disabled={locked} onChange={setNewValue} />
                  </label>
                  <button type="button" className="btn-secondary" disabled={locked || !newKey || !newValue} onClick={addSetting}>Add</button>
                </div>
              </section>

              {changeCount > 0 && (
                <section className="card space-y-4">
                  <h2 className="font-semibold text-gray-900">Review {changeCount} change{changeCount === 1 ? '' : 's'}</h2>
                  <ul className="space-y-1 text-sm">
                    {Object.entries(changes).map(([key, value]) => (
                      <li key={key} className="font-mono text-[13px]">
                        {value === null
                          ? <span className="text-red-700">− {key} (removed)</span>
                          : <span className="text-gray-800">{existing.has(key) ? '~' : '+'} {key} = {describeNew(key, value, data.settings)}</span>}
                      </li>
                    ))}
                  </ul>
                  {Object.keys(changes).includes('JWT_SECRET') && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
                      Changing JWT_SECRET signs everyone out, including you.
                    </p>
                  )}

                  {!review ? (
                    <div className="flex gap-3">
                      <button type="button" className="btn-primary" disabled={locked} onClick={runReview}>Check and save all</button>
                      <button type="button" className="btn-secondary" onClick={() => { setEdits({}); setReview(null); }}>Discard all</button>
                    </div>
                  ) : review.problems.length || review.bootProblems.length ? (
                    <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
                      <p className="font-semibold">{review.problems.length ? 'This change cannot be made:' : 'The server would not start with this change:'}</p>
                      <ul className="mt-1 list-disc pl-5">
                        {[...review.problems, ...review.bootProblems].map((p) => <li key={p}>{p}</li>)}
                      </ul>
                    </div>
                  ) : (
                    <form
                      className="flex flex-wrap items-end gap-3"
                      onSubmit={(e) => { e.preventDefault(); apply(); }}
                    >
                      <p className="w-full text-sm text-emerald-700">Checked: the server would start with these settings.</p>
                      <label className="min-w-[240px] text-xs font-semibold text-gray-600">
                        Your password, to confirm
                        <input className="input mt-1" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                      </label>
                      <button type="submit" className="btn-primary" disabled={submitting || !password || inProgress}>
                        {submitting ? 'Saving…' : data.mode === 'helper' ? 'Save all (restarts when no call is live)' : 'Save all'}
                      </button>
                    </form>
                  )}
                </section>
              )}

              <section className="card !p-0">
                <h2 className="px-5 pt-5 font-semibold text-gray-900">History</h2>
                {data.history.length === 0 ? (
                  <p className="px-5 pb-5 pt-2 text-sm text-gray-500">No changes have been made from this page yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="mt-3 w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="border-y border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                          <th className="px-5 py-2.5">When</th>
                          <th className="px-3 py-2.5">Who</th>
                          <th className="px-3 py-2.5">What changed</th>
                          <th className="px-5 py-2.5">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.history.map((h) => (
                          <tr key={h.id} className="border-b border-gray-100 align-top">
                            <td className="whitespace-nowrap px-5 py-3 text-gray-600">{formatDate(h.createdAt)}</td>
                            <td className="px-3 py-3 text-gray-700">{h.actorEmail}</td>
                            <td className="px-3 py-3 font-mono text-[12.5px] text-gray-800">
                              {h.changes.map((c) => (
                                <div key={c.key}>{c.action === 'removed' ? `− ${c.key}` : `${c.key}${c.last4 ? ` …${c.last4}` : ''}`}</div>
                              ))}
                            </td>
                            <td className="px-5 py-3 text-gray-700">
                              {STATE_TEXT[h.state]?.label ?? h.state}
                              {h.message && <div className="text-xs text-gray-500">{h.message}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/** How a pending value is shown in the review: never the full secret. */
function describeNew(key: string, value: string, settings: SecretSetting[]): string {
  const current = settings.find((s) => s.key === key);
  const secret = current ? current.secret : /(KEY|SECRET|TOKEN|PASSWORD|PASS|PRIVATE|CREDENTIAL|DSN|WEBHOOK|SALT)/.test(key);
  if (!secret) return value;
  return value.length >= 8 ? `…${value.slice(-4)}` : '•'.repeat(value.length);
}

/**
 * A value box the browser's password manager leaves alone.
 *
 * A text box followed by a `type="password"` box looks like a login form, and
 * Chrome filled the admin's own email into REDIS_URL and their saved password
 * into JWT_SECRET — one click of Save from overwriting both. So no box here
 * is `type="password"`: secrets are plain text inputs drawn as dots with
 * `-webkit-text-security`, which no autofill treats as a credential, plus the
 * ignore hints the common password managers honour.
 */
function ValueInput({
  masked, className = '', placeholder, value, disabled, onChange,
}: {
  masked: boolean;
  className?: string;
  placeholder?: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="text"
      name={useId()}
      className={`input ${className}`}
      style={masked ? ({ WebkitTextSecurity: 'disc' } as React.CSSProperties) : undefined}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      data-1p-ignore
      data-lpignore="true"
      data-bwignore
      data-form-type="other"
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * The password confirmation for one row's Save, drawn as its OWN table row
 * under that setting. It used to open inside the narrow actions column and
 * spilled left over the value box. A problem (wrong password, server would
 * not start, …) shows here and the typed value is kept so it can be fixed.
 */
function SaveConfirmRow({ settingKey, onSave, onDone }: {
  settingKey: string;
  onSave: (password: string) => Promise<string | null>;
  onDone: () => void;
}) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  return (
    <tr className="border-b border-gray-100 bg-amber-50/40">
      <td colSpan={4} className="px-5 pb-3 pt-0">
        <form
          className="flex flex-wrap items-center justify-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!pw) return;
            setBusy(true);
            const result = await onSave(pw);
            setBusy(false);
            if (result) { setProblem(result); return; }
            onDone();
          }}
        >
          <span className="text-xs text-gray-600">Save <strong className="font-mono">{settingKey}</strong> — confirm with your password:</span>
          <input
            className="input !w-56 !py-1.5 text-xs"
            type="password"
            autoComplete="current-password"
            placeholder="Your password"
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <button type="submit" className="btn-primary !px-3 !py-1.5 text-xs" disabled={busy || !pw}>{busy ? 'Saving…' : 'Confirm'}</button>
          <button type="button" className="text-xs font-semibold text-gray-500 hover:text-gray-800" disabled={busy} onClick={onDone}>Cancel</button>
          {problem && <p className="w-full whitespace-pre-wrap text-right text-xs text-red-700">{problem}</p>}
        </form>
      </td>
    </tr>
  );
}

const saveButtonClass = 'btn-primary !px-3 !py-1.5 text-xs';

/** A setting added on this page and not saved yet. */
function AddedRowView({ settingKey, disabled, onSave, onUndo }: {
  settingKey: string;
  disabled: boolean;
  onSave: (password: string) => Promise<string | null>;
  onUndo: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <tr className={`bg-emerald-50/40 ${confirming ? '' : 'border-b border-gray-100'}`}>
        <td className="px-5 py-3 font-mono text-[13px] font-semibold text-gray-900">{settingKey} <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-800">new</span></td>
        <td className="px-3 py-3 text-gray-400">—</td>
        <td className="px-3 py-3 text-gray-700">{'•'.repeat(8)}</td>
        <td className="px-5 py-3">
          <div className="flex items-center justify-end gap-2">
            <button type="button" className={saveButtonClass} disabled={disabled || confirming} onClick={() => setConfirming(true)}>Save</button>
            <button type="button" className="text-xs font-semibold text-gray-500 hover:text-gray-800" onClick={onUndo}>Undo</button>
          </div>
        </td>
      </tr>
      {confirming && <SaveConfirmRow settingKey={settingKey} onSave={onSave} onDone={() => setConfirming(false)} />}
    </>
  );
}

function SettingRowView({
  setting, edit, revealed, test, disabled, onEdit, onReveal, onTest, onSave,
}: {
  setting: SecretSetting;
  edit: string | null | undefined;
  revealed: boolean;
  test: TestResult | 'running' | undefined;
  disabled: boolean;
  onEdit: (value: string | null | undefined) => void;
  onReveal: () => void;
  onTest: () => void;
  onSave: (password: string) => Promise<string | null>;
}) {
  // A new value typed, or marked for removal: either can be saved from the row.
  const changed = edit === null || (typeof edit === 'string' && edit.length > 0);
  const removing = edit === null;
  const [confirming, setConfirming] = useState(false);
  const current = setting.secret
    ? (setting.last4 ? `••••${setting.last4}` : `${'•'.repeat(Math.min(setting.length, 8)) || '(empty)'}`)
    : (setting.value || '(empty)');

  return (
    <>
    <tr className={`${confirming && changed ? '' : 'border-b border-gray-100'} ${removing ? 'bg-red-50/50' : typeof edit === 'string' && edit ? 'bg-amber-50/40' : ''}`}>
      <td className="px-5 py-3 font-mono text-[13px] font-semibold text-gray-900">
        {setting.key}
        {setting.locked && <div className="font-sans text-[11px] font-normal text-gray-500">Set by the server; not editable here</div>}
      </td>
      <td className={`px-3 py-3 font-mono text-[12.5px] ${removing ? 'text-red-600 line-through' : 'text-gray-600'}`}>
        <span className="break-all">{current}</span>
      </td>
      <td className="px-3 py-3">
        {setting.locked ? null : removing ? (
          <span className="text-xs font-semibold text-red-700">Will be removed</span>
        ) : (
          <div className="relative">
            <ValueInput
              masked={setting.secret && !revealed}
              className={`!py-1.5 font-mono text-[12.5px] ${setting.secret ? '!pr-14' : ''}`}
              placeholder={setting.secret ? 'Paste a new key' : 'New value'}
              value={typeof edit === 'string' ? edit : ''}
              disabled={disabled}
              onChange={(v) => onEdit(v || undefined)}
            />
            {setting.secret && (
              <button type="button" tabIndex={-1} className="absolute inset-y-0 right-2 my-auto h-6 px-1.5 text-[11px] font-semibold text-gray-500 hover:text-gray-800" onClick={onReveal}>
                {revealed ? 'Hide' : 'Show'}
              </button>
            )}
          </div>
        )}
        {test && test !== 'running' && (
          <p className={`mt-1 text-xs ${test.ok ? 'text-emerald-700' : 'text-red-700'}`}>{test.ok ? '✓ ' : '✗ '}{test.message}</p>
        )}
      </td>
      <td className="px-5 py-3">
        {/* Fixed slots — Save | Test | Remove — so every row lines up whether
            or not it has each button. */}
        <div className="flex items-start justify-end gap-2">
          <div className="flex min-w-[64px] justify-end">
            {changed && !setting.locked && (
              <button type="button" className={saveButtonClass} disabled={disabled || confirming} onClick={() => setConfirming(true)}>Save</button>
            )}
          </div>
          <div className="flex w-[60px] justify-end">
            {setting.test && !removing && (
              <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" disabled={disabled || test === 'running'} onClick={onTest}
                title={`Checks: ${setting.test}. ${typeof edit === 'string' && edit ? 'Tests the new value.' : 'Tests the current value.'}`}>
                {test === 'running' ? '…' : 'Test'}
              </button>
            )}
          </div>
          <div className="flex w-[56px] justify-end pt-1.5">
            {!setting.locked && (
              <button type="button" className="text-xs font-semibold text-gray-500 hover:text-red-700" disabled={disabled}
                onClick={() => onEdit(removing ? undefined : null)}>
                {removing ? 'Undo' : 'Remove'}
              </button>
            )}
          </div>
        </div>
      </td>
    </tr>
    {confirming && changed && (
      <SaveConfirmRow settingKey={setting.key} onSave={onSave} onDone={() => setConfirming(false)} />
    )}
    </>
  );
}
