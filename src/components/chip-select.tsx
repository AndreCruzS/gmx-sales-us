"use client";

// A narrowing that looks like every other control on this row.
//
// The dealer lens's region and house filters shipped as native <select>s and
// came straight back (Andre, 2026-09-11: "eles tem que ser igual aos de cima em
// estilo, igual ao dropdown do período"). He is right twice over: a native
// select cannot be styled to match the chips beside it, and this codebase has
// already settled that argument once — the period picker is a chip that opens a
// panel precisely because the select it replaced was sent back.
//
// So this is the period picker's shape with a simpler panel: a chip carrying
// the current choice, a list of options under it, each with what it is worth.
// Same close-on-outside, same Escape, same z-index.
//
// THE PANEL IS ABSOLUTE, WHICH MEANS ITS ANCESTORS MUST NOT CLIP IT. A row with
// `overflow-x: auto` computes `overflow-y: auto` along with it and swallows the
// panel whole — and the accessibility tree still lists the buried options, so
// it reads as working right up until somebody looks. The period picker carries
// the same warning in CSS; heed it when placing this.

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "@/components/icons";

export interface ChipOption {
  id: string;
  label: string;
  /** The quiet figure beside a choice — what it is worth. Optional. */
  hint?: string;
}

export function ChipSelect({
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  /** What this narrows, for the screen reader and the chip's own title. */
  label: string;
  /** "" means nothing is narrowed. */
  value: string;
  options: readonly ChipOption[];
  /** What "no narrowing" is called — "All regions", "All distributors". */
  allLabel: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const picked = options.find((o) => o.id === value) ?? null;

  return (
    <div className="chipsel" ref={rootRef}>
      <button
        type="button"
        className="chip"
        // Pressed only when it is actually narrowing something, so a row of
        // chips reads at a glance as "this one is doing work".
        aria-pressed={value !== ""}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={label}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {picked ? picked.label : allLabel}
        <ChevronDownIcon size={11} aria-hidden="true" />
      </button>

      {open && (
        <div className="chipsel-panel" role="dialog" aria-label={label}>
          <button
            type="button"
            className="chipsel-opt"
            aria-pressed={value === ""}
            onClick={() => {
              onChange("");
              close();
            }}
          >
            <span className="chipsel-opt-name">{allLabel}</span>
          </button>
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className="chipsel-opt"
              aria-pressed={value === o.id}
              onClick={() => {
                onChange(o.id);
                close();
              }}
            >
              <span className="chipsel-opt-name">{o.label}</span>
              {o.hint && <span className="chipsel-opt-hint fig-sm">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
