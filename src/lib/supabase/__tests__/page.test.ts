import { describe, expect, it } from "vitest";
import { fetchAllPages } from "../page";

/** A fake table that answers ranges the way PostgREST does, including its own
 *  server cap — the behaviour this helper exists to survive. */
function server(rows: number, cap: number) {
  const asked: [number, number][] = [];
  const table = Array.from({ length: rows }, (_, i) => ({ i }));
  return {
    asked,
    page: (from: number, to: number) => {
      asked.push([from, to]);
      const want = to - from + 1;
      return Promise.resolve({
        data: table.slice(from, from + Math.min(want, cap)),
        error: null,
      });
    },
  };
}

describe("fetchAllPages", () => {
  it("returns every row when the table fits in one page", async () => {
    const s = server(300, 1000);
    const all = await fetchAllPages(s.page, { size: 1000 });
    expect(all).toHaveLength(300);
    // One trip for the rows, one to learn there are no more.
    expect(s.asked).toEqual([[0, 999], [300, 1299]]);
  });

  it("walks past the server cap instead of stopping at it", async () => {
    // The real shape of the bug: 1,262 rows behind a 1,000-row cap.
    const s = server(1262, 1000);
    const all = await fetchAllPages(s.page, { size: 1000 });
    expect(all).toHaveLength(1262);
    expect(all.map((r) => r.i)).toEqual(Array.from({ length: 1262 }, (_, i) => i));
  });

  it("advances by what arrived, not by what was asked for", async () => {
    // Asking for 1,000 while the server gives 400 must not skip rows 400-999.
    const s = server(1000, 400);
    const all = await fetchAllPages(s.page, { size: 1000 });
    expect(all).toHaveLength(1000);
    expect(s.asked.map(([from]) => from)).toEqual([0, 400, 800, 1000]);
  });

  it("does not trust a short page as the end of the table", async () => {
    // 1,200 rows, 500 cap: the first page is short of the 1,000 asked for, and
    // a reader that took that as the end would lose 700 rows in silence.
    const s = server(1200, 500);
    const all = await fetchAllPages(s.page, { size: 1000 });
    expect(all).toHaveLength(1200);
  });

  it("is empty, and asks once, for a table with nothing in it", async () => {
    const s = server(0, 1000);
    expect(await fetchAllPages(s.page, { size: 1000 })).toEqual([]);
    expect(s.asked).toHaveLength(1);
  });

  it("throws the query's error rather than returning what it had", async () => {
    let call = 0;
    const page = () => {
      call += 1;
      return Promise.resolve(
        call === 1
          ? { data: [{ i: 1 }], error: null }
          : { data: null, error: { message: "permission denied" } },
      );
    };
    await expect(fetchAllPages(page, { size: 1 })).rejects.toThrow("permission denied");
  });

  it("throws rather than hand back a partial answer at the safety cap", async () => {
    const s = server(5000, 1000);
    await expect(fetchAllPages(s.page, { size: 1000, cap: 2000 })).rejects.toThrow(
      /safety cap/,
    );
  });
});
