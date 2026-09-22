'use client';

/**
 * A search box that offers the agents it can see, and filters exactly once one
 * is picked.
 *
 * Free text alone is ambiguous: "Ali" matches two people, and an admin hunting
 * one trainee's calls cannot tell from the results which rows belong to whom.
 * Picking a suggestion switches the request from a LIKE over names to that
 * agent's id, so the list is exactly theirs and the count beside it is theirs
 * too.
 *
 * Typing still works on its own. Somebody who types "welder" and presses
 * nothing gets the free-text search, because the customer is not an agent and
 * will never appear in this list.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { admin } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export interface AgentOption {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export function agentLabel(agent: AgentOption): string {
  const name = [agent.firstName, agent.lastName].filter(Boolean).join(' ').trim();
  return name || agent.email || 'Unnamed agent';
}

export default function AgentSearch({
  query,
  onQueryChange,
  selected,
  onSelect,
  placeholder = 'Search agent or customer…',
  className = '',
}: {
  query: string;
  onQueryChange: (value: string) => void;
  /** The agent currently filtering the list, if one was picked. */
  selected: AgentOption | null;
  onSelect: (agent: AgentOption | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const { token } = useAuthStore();
  const [options, setOptions] = useState<AgentOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);

  /**
   * Two characters before asking. One letter matches most of the roster, which
   * is a list nobody reads and a request nobody needed.
   */
  useEffect(() => {
    const term = query.trim();
    if (!token || selected || term.length < 2) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const res = await admin.listAgents(token, { search: term, limit: '6', page: '1' });
        if (cancelled) return;
        setOptions(Array.isArray(res.data) ? res.data : []);
        setActive(0);
      } catch {
        // A failed lookup is not a failed search: the free-text request still
        // runs and the list below is still correct.
        if (!cancelled) setOptions([]);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(id); };
  }, [query, token, selected]);

  // Close on a click outside, so the list does not follow the admin around.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = useCallback((agent: AgentOption) => {
    onSelect(agent);
    onQueryChange(agentLabel(agent));
    setOpen(false);
    setOptions([]);
  }, [onSelect, onQueryChange]);

  const clear = useCallback(() => {
    onSelect(null);
    onQueryChange('');
    setOptions([]);
    setOpen(false);
  }, [onSelect, onQueryChange]);

  const visible = open && !selected && options.length > 0;

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        type="search"
        value={query}
        onChange={(event) => {
          // Editing the text abandons the pinned agent: the box would otherwise
          // read as one person while the list showed another.
          if (selected) onSelect(null);
          onQueryChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (!visible) {
            if (event.key === 'Escape') clear();
            return;
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((i) => (i + 1) % options.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((i) => (i - 1 + options.length) % options.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const picked = options[active];
            if (picked) choose(picked);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        aria-label="Search by agent or customer"
        aria-expanded={visible}
        role="combobox"
        aria-controls="agent-suggestions"
        className={`bean-card min-h-10 w-full rounded-xl border px-3.5 py-2.5 pr-8 text-[13px] text-bean-ink outline-none transition placeholder:text-bean-faint focus:border-bean-brand ${
          selected ? 'border-bean-brand' : ''
        }`}
      />

      {query && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-2 top-[18px] -translate-y-1/2 rounded px-1 text-[15px] leading-none text-bean-faint transition hover:text-bean-ink"
        >
          ×
        </button>
      )}

      {/* Says WHY the list is short. Without it, a filtered list and a list
          with two results look the same. */}
      {selected && (
        <p className="mt-1 text-[11.5px] text-bean-brand">
          Showing {agentLabel(selected)} only
        </p>
      )}

      {visible && (
        <ul
          id="agent-suggestions"
          role="listbox"
          className="bean-scope absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-bean-line bg-bean-card py-1 shadow-[0_24px_50px_-24px_rgba(0,0,0,0.55)]"
        >
          {options.map((agent, index) => (
            <li key={agent.id} role="option" aria-selected={index === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(agent)}
                className={`block w-full px-3.5 py-2 text-left transition ${
                  index === active ? 'bg-bean-card2' : ''
                }`}
              >
                <span className="block text-[13px] font-semibold text-bean-ink">
                  {agentLabel(agent)}
                </span>
                {agent.email && (
                  <span className="block text-[11.5px] text-bean-muted">{agent.email}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
