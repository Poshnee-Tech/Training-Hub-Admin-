'use client';

/**
 * Small panels anchored to the control that opened them.
 *
 * These exist to get rid of `confirm()` and `prompt()`. A native dialog is
 * centred on the window with the browser's own chrome and the page's origin in
 * the title, so it appears nowhere near the row being acted on and gives no
 * clue which of eleven recordings is about to go. It also cannot be styled, so
 * it breaks the theme every time it opens.
 *
 * Anchored instead: the panel opens against its trigger, so the thing being
 * deleted stays on screen and next to the question about deleting it.
 *
 * Both close on Escape and on a click outside, and the destructive action is
 * never the one focus lands on.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

const PANEL =
  'absolute right-0 top-[calc(100%+8px)] z-50 w-[290px] rounded-xl border border-bean-line bg-bean-card p-3.5 text-left shadow-[0_24px_50px_-24px_rgba(0,0,0,0.55)]';

/** Shared open/close behaviour: Escape, outside click, and focus return. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };

    document.addEventListener('keydown', onKey);
    // `mousedown` rather than `click`, so a press that starts outside closes
    // before the button under the cursor can fire.
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, close]);

  return ref;
}

export function ConfirmPopover({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Delete',
  danger = true,
  extra,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Extra controls above the buttons — a cascade checkbox, for instance. */
  extra?: ReactNode;
  /** The trigger this panel anchors to. */
  children: ReactNode;
}) {
  const ref = useDismiss(open, onClose);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // Focus lands on Cancel, never on the destructive button — a stray Enter
  // after opening should do nothing.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {children}

      {open && (
        <div role="dialog" aria-label={title} className={PANEL}>
          <p className="text-[13px] font-bold text-bean-ink">{title}</p>
          {body && (
            <div className="mt-1.5 text-[12.5px] leading-relaxed text-bean-muted">{body}</div>
          )}
          {extra && <div className="mt-3">{extra}</div>}

          <div className="mt-3.5 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={onClose}
              className="rounded-lg border border-bean-line bg-bean-card px-3 py-1.5 text-[12.5px] font-semibold text-bean-muted transition hover:text-bean-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { onConfirm(); onClose(); }}
              className={`rounded-lg px-3 py-1.5 text-[12.5px] font-bold text-white transition ${
                danger
                  ? 'bg-bean-live hover:brightness-110'
                  : 'bg-gradient-to-r from-bean-brand to-bean-brand-bright'
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RenamePopover({
  open,
  onClose,
  onSubmit,
  label,
  value,
  hint,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (next: string) => void;
  label: string;
  value: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  const ref = useDismiss(open, onClose);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(value);
  const id = useId();

  // Reopening on a different row must not show the previous row's text.
  useEffect(() => {
    if (open) {
      setDraft(value);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open, value]);

  return (
    <div ref={ref} className="relative">
      {children}

      {open && (
        <form
          role="dialog"
          aria-label={label}
          onSubmit={(e) => {
            e.preventDefault();
            const next = draft.trim();
            if (next && next !== value) onSubmit(next);
            onClose();
          }}
          className={PANEL}
        >
          <label htmlFor={id} className="block text-[13px] font-bold text-bean-ink">
            {label}
          </label>
          <input
            ref={inputRef}
            id={id}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="mt-2 block w-full rounded-lg border border-bean-line bg-bean-card2 px-3 py-2 text-[13px] text-bean-ink outline-none transition focus:border-bean-brand"
          />
          {hint && <p className="mt-1.5 text-[11.5px] leading-relaxed text-bean-faint">{hint}</p>}

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-bean-line bg-bean-card px-3 py-1.5 text-[12.5px] font-semibold text-bean-muted transition hover:text-bean-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!draft.trim()}
              className="rounded-lg bg-gradient-to-r from-bean-brand to-bean-brand-bright px-3 py-1.5 text-[12.5px] font-bold text-white transition disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
