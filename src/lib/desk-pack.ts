// HOW A DESK PAGE PACKS ITSELF (Andre, 2026-10-02).
//
// Every block used to be nailed to a column in the CSS: the recurrence card on
// the left, the goal chart on the right. That reads well only while both of
// them exist. Choose Year to date and "Who kept buying" cannot be drawn — it
// needs two months to compare — so the goal chart sat alone in the right
// column with 826 pixels of empty page beside it. The page could not close its
// own hole because nothing in it knew what else was on screen.
//
// So a block no longer names a column; it names the width it NEEDS, and the
// page packs them in reading order:
//   wide (8/12) + narrow (4/12) = a full line,
//   narrow + narrow = a full line, split evenly — six and six, because two
//     cards of the same weight should not be read as one and its appendix,
//   anything left alone on its line grows to the full width.
// Two wides never pair: squeezed to six each they would both be worse off than
// stacked.
//
// It lives here rather than in one page because it is a RULE, not a layout:
// Sales packs this way, Reps packs this way, and every dashboard the admin
// adds after them packs this way without re-deriving it (see [[desk-dashboard-
// state]] rule 2). The CSS half is `.mgr-home > [data-span="…"]` at ≥1280 —
// there is no two-column reading below that, by design.

/** What a block asks for. "full" never shares its line. */
export type DeskWidth = "full" | "wide" | "narrow";

/** What it gets. "half" only ever comes out of two narrows meeting. */
export type DeskSpan = "full" | "wide" | "half" | "narrow";

/**
 * Pack the blocks that are actually on screen. Callers list ONLY the ones they
 * render — a block that draws nothing must not be in here, or its ghost takes
 * a place on a line and the hole comes back (MonthByMonth with no won deals
 * taught us that one).
 */
export function packDesk(
  want: readonly { k: string; w: DeskWidth }[],
): Map<string, DeskSpan> {
  const out = new Map<string, DeskSpan>();
  for (let i = 0; i < want.length; ) {
    const a = want[i];
    const b = want[i + 1];
    const pairs =
      a.w !== "full" && b && b.w !== "full" && !(a.w === "wide" && b.w === "wide");
    if (!pairs) {
      // Alone on its line — whatever it asked for, it takes the width.
      out.set(a.k, "full");
      i += 1;
      continue;
    }
    const even = a.w === "narrow" && b.w === "narrow";
    out.set(a.k, even ? "half" : a.w);
    out.set(b.k, even ? "half" : b.w);
    i += 2;
  }
  return out;
}

/** The reader for a packed map: anything unplaced owns its line. */
export function spanner(
  spans: Map<string, DeskSpan>,
): (k: string) => DeskSpan {
  return (k) => spans.get(k) ?? "full";
}
