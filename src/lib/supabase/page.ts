// Reading a whole table when the server will not give you one.
//
// PostgREST caps every request at the project's `max-rows` — 1,000 on this
// project — and NOTHING in the client overrides it. `.limit(10000)` is not a
// request for ten thousand rows, it is a request for at most ten thousand, and
// the server quietly answers with a thousand. `.range(0, 4999)` behaves the
// same. There is no error, no flag, no short-read warning: the query succeeds
// and the numbers are simply wrong.
//
// This mattered the day it was found (2026-09-11). `sell_through` held 1,262
// rows against that cap, and the page that removes a loaded month was reading
// every branch_id to decide which yards had gone empty. It saw 1,000 of them,
// so a yard whose rows sat past the cap read as ORPHANED — and the button next
// to it deletes branches, which cascades onto their sell-through rows. A silent
// truncation was one click from destroying real sales history.
//
// So: page until the server says there is nothing left, and advance by what
// ACTUALLY CAME BACK rather than by what was asked for. A page shorter than the
// request is not proof of the end — it is the ordinary shape of a capped
// answer — so only an empty page ends the walk. That costs one extra round trip
// and buys the guarantee that the figure on the screen is the whole figure.

/** What one page of a PostgREST query answers with. */
export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export interface PageOptions {
  /** Rows per request. Kept under a typical cap so most tables finish in one
   *  or two trips; a smaller server cap still works, because the walk follows
   *  what came back. */
  size?: number;
  /** A stop, so a server that never returns an empty page cannot spin forever.
   *  Crossing it throws rather than returning a half answer quietly — a short
   *  read is the very bug this exists to prevent. */
  cap?: number;
}

/**
 * Every row a query matches, gathered a page at a time.
 *
 * @param page  asks for one inclusive range, exactly as `.range(from, to)` does
 *
 * The query handed in MUST carry a deterministic order. Range paging over an
 * unordered result is free to repeat one row and skip another, and on sales
 * data that reads as a number nobody can reproduce.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: PageOptions = {},
): Promise<T[]> {
  const size = Math.max(1, options.size ?? 1000);
  const cap = options.cap ?? 200_000;
  const all: T[] = [];

  for (let from = 0; ; ) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    const got = data ?? [];
    if (got.length === 0) return all;
    all.push(...got);
    // By what arrived, never by `size`: when the server's own cap is smaller
    // than the page asked for, stepping by `size` skips the rows in between.
    from += got.length;
    if (all.length >= cap) {
      throw new Error(
        `fetchAllPages stopped at ${all.length} rows, which is the safety cap. ` +
          `Either the query needs narrowing or the cap needs raising — it must ` +
          `not return a partial answer.`,
      );
    }
  }
}
