"use client";

// A FILTER AS A MENU OF CHECKBOXES (Andre, 2026-11-03: chip rows of kinds and
// people read as labels, not as filters). One button that says what is
// picked — "All kinds", "Promise", "3 kinds" — and opens a short list where
// several can be ticked. Nothing ticked means everything. Closes on Escape,
// on a click outside, and hands focus back to its button.

import { useEffect, useId, useRef, useState } from "react";

export interface CheckOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

export function CheckMenu<T extends string>({
  label,
  allLabel,
  manyLabel,
  options,
  picked,
  onChange,
}: {
  /** What the menu filters, for screen readers: "Kind", "Whose". */
  label: string;
  /** The button's words when nothing is ticked: "All kinds". */
  allLabel: string;
  /** The button's words for several: (n) => `${n} kinds`. */
  manyLabel: (n: number) => string;
  options: readonly CheckOption<T>[];
  picked: ReadonlySet<T>;
  onChange: (next: Set<T>) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const chosen = options.filter((o) => picked.has(o.value));
  const words =
    chosen.length === 0 ? allLabel : chosen.length === 1 ? chosen[0].label : manyLabel(chosen.length);

  function toggle(v: T) {
    const next = new Set(picked);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next);
  }

  return (
    <div className="ckm" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="ckm-btn"
        data-on={chosen.length > 0 || undefined}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${label}: ${words}`}
        onClick={() => setOpen((o) => !o)}
      >
        {words}
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="ckm-pop" id={listId} role="group" aria-label={label}>
          {options.map((o) => (
            <label key={o.value} className="ckm-opt">
              <input type="checkbox" checked={picked.has(o.value)} onChange={() => toggle(o.value)} />
              <span>{o.label}</span>
              {o.count !== undefined && <span className="ckm-count">{o.count}</span>}
            </label>
          ))}
          {chosen.length > 0 && (
            <button type="button" className="t-action ckm-clear" onClick={() => onChange(new Set())}>
              Clear · {allLabel.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
