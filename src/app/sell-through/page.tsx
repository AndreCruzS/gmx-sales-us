"use client";

// Loading a distributor's month.
//
// Every sales screen in this app is downstream of this one, and nobody using the
// app produces the figures: Boise and Hardwoods send a spreadsheet, an admin
// puts it in, and it is always a month behind. Until now it had no home at all.
//
// It takes a PASTE rather than a file, which is a decision and not a shortcut.
// The two houses' files agree about nothing — not the column names, not the
// order, not how a dealer is spelled — so a parser written against one of them
// breaks on the other and on next year's export of either. Selecting a range in
// Excel and pasting it is what the job already looks like, it needs no library to
// go wrong on the eighteenth variant of xlsx, and the admin says which column is
// which once instead of us guessing forever.
//
// The screen is a straight line: which house, which month, paste it, check what
// it found, load it. Nothing is written until the last step, and everything the
// last step will do is on screen before it is pressed — how much volume, how much
// of it landed on a dealer we know, which yards we have never heard of.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOffline } from "@/components/offline-provider";
import { formatMoney } from "@/lib/format";
import { manages } from "@/lib/domain/roles";
import { periodLabel } from "@/lib/domain/sell-through";
import {
  buildImport,
  EMPTY_MAPPING,
  guessMapping,
  mappingProblem,
  parseSheet,
  periodOf,
  type ImportField,
  type KnownBranch,
  type KnownDealer,
  type Mapping,
} from "@/lib/domain/sell-through-import";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const QTY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

interface DistributorRow {
  id: string;
  name: string;
}
interface UploadRow {
  id: string;
  distributor_id: string;
  period: string;
  row_count: number;
  unmatched_count: number;
  uploaded_at: string;
}

const FIELDS: readonly { key: ImportField; label: string; need: boolean }[] = [
  { key: "branch", label: "Branch", need: false },
  { key: "branch_code", label: "Branch code", need: false },
  { key: "dealer", label: "Customer", need: true },
  // The item, and it earns more than a name: the length in its description is
  // what turns a piece count into linear feet.
  { key: "product", label: "Item", need: false },
  { key: "quantity", label: "Quantity", need: true },
  { key: "unit", label: "Unit (UOM)", need: false },
  { key: "last_year", label: "Last year's quantity", need: false },
  { key: "value", label: "Value", need: false },
];

/** The month a file is most likely to be for: the one just finished. */
function lastMonth(now: Date): { year: number; month: number } {
  const m = now.getUTCMonth();
  return m === 0
    ? { year: now.getUTCFullYear() - 1, month: 12 }
    : { year: now.getUTCFullYear(), month: m };
}

export default function SellThroughPage() {
  const router = useRouter();
  const { profile } = useOffline();

  const [distributors, setDistributors] = useState<DistributorRow[]>([]);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [branches, setBranches] = useState<KnownBranch[]>([]);
  const [dealers, setDealers] = useState<KnownDealer[]>([]);

  const [distributorId, setDistributorId] = useState("");
  const [when, setWhen] = useState<{ year: number; month: number } | null>(null);
  const [months, setMonths] = useState<{ value: string; label: string }[]>([]);
  const [pasted, setPasted] = useState("");
  const [mapping, setMapping] = useState<Mapping>(EMPTY_MAPPING);
  const [touchedMapping, setTouchedMapping] = useState(false);
  const [addBranches, setAddBranches] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Removing a month is destructive and irreversible, so it is deliberately two
  // taps: this holds which upload has been armed. A browser confirm() would be
  // faster to write and is the wrong control — it is dismissable by reflex and
  // says nothing about what is going.
  const [armed, setArmed] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  // Yards that no longer have a single row against them, once a month has gone.
  const [orphans, setOrphans] = useState<{ id: string; name: string }[]>([]);

  // The clock is an external system: stamped once, never read during a render.
  // The month list is built from the same stamp, so the default and the options
  // cannot disagree about what "last month" is.
  useEffect(() => {
    const t = setTimeout(() => {
      const last = lastMonth(new Date());
      setWhen(last);
      // Eighteen back is enough for a late file and a catch-up. The FUTURE is not
      // offered at all: the report is a month behind by definition, so a month
      // that has not finished cannot have one.
      const opts: { value: string; label: string }[] = [];
      let year = last.year;
      let month = last.month;
      for (let i = 0; i < 18; i += 1) {
        opts.push({
          value: `${year}-${String(month).padStart(2, "0")}`,
          label: periodLabel(periodOf(year, month)),
        });
        month -= 1;
        if (month === 0) {
          month = 12;
          year -= 1;
        }
      }
      setMonths(opts);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const [ds, us, br] = await Promise.all([
      supabase
        .from("accounts")
        .select("id, name, account_type")
        .order("name")
        .limit(500),
      supabase
        .from("sell_through_uploads")
        .select("id, distributor_id, period, row_count, unmatched_count, uploaded_at")
        .order("period", { ascending: false })
        .limit(200),
      supabase
        .from("distributor_branches")
        .select("id, distributor_id, name, external_code")
        .limit(1000),
    ]);
    const accounts = ds.error
      ? []
      : ((ds.data as (DistributorRow & { account_type: string })[]) ?? []);
    setDistributors(accounts.filter((a) => a.account_type === "DISTRIBUTOR"));
    // Every account that is not a house is a candidate for a dealer name in the
    // file — a contractor buying off a branch is unusual but it is not an error,
    // and the alternative is silently refusing to match one.
    setDealers(accounts.filter((a) => a.account_type !== "DISTRIBUTOR"));
    setUploads(us.error ? [] : ((us.data as UploadRow[]) ?? []));
    setBranches(
      br.error
        ? []
        : (((br.data as (KnownBranch & { distributor_id: string })[]) ?? []).map(
            (b) => ({ ...b }),
          ) as (KnownBranch & { distributor_id: string })[]),
    );
  }, []);

  useEffect(() => {
    if (!profile) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [profile, load]);

  const sheet = useMemo(() => parseSheet(pasted), [pasted]);

  // Guessed on the first paste and then left alone: re-guessing after every
  // keystroke would undo a correction the moment it was made.
  useEffect(() => {
    if (touchedMapping || sheet.headers.length === 0) return;
    const t = setTimeout(() => setMapping(guessMapping(sheet.headers)), 0);
    return () => clearTimeout(t);
  }, [sheet.headers, touchedMapping]);

  const mineBranches = useMemo(
    () =>
      (branches as (KnownBranch & { distributor_id: string })[]).filter(
        (b) => b.distributor_id === distributorId,
      ),
    [branches, distributorId],
  );

  const plan = useMemo(
    () =>
      sheet.rows.length === 0
        ? null
        : buildImport(sheet, mapping, { branches: mineBranches, dealers }),
    [sheet, mapping, mineBranches, dealers],
  );

  const period = when ? periodOf(when.year, when.month) : null;
  const existing = uploads.find(
    (u) => u.distributor_id === distributorId && u.period === period,
  );
  const problem = mappingProblem(mapping);
  const loadable = plan
    ? plan.rows.filter((r) => r.branchId !== null || addBranches).length
    : 0;

  async function save() {
    if (!distributorId || !period || !plan || problem || !profile) return;
    setSaving(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    try {
      // A month is REPLACED, never added to. Deleting the upload takes its rows
      // with it, which is the whole reason uploads exist as a row of their own —
      // reloading a corrected file must not double the book.
      if (existing) {
        const { error: delErr } = await supabase
          .from("sell_through_uploads")
          .delete()
          .eq("id", existing.id);
        if (delErr) throw new Error(delErr.message);
      }

      // Branches the file named that we do not hold. Only ever on request: a
      // yard invented from a typo would sit on the coverage map for good.
      const resolved = new Map<string, string>();
      for (const b of mineBranches) {
        if (b.external_code) resolved.set(`c:${b.external_code.toLowerCase()}`, b.id);
      }
      if (addBranches && plan.newBranches.length > 0) {
        const { data, error: insErr } = await supabase
          .from("distributor_branches")
          .insert(
            plan.newBranches.map((b) => ({
              org_id: profile.orgId,
              distributor_id: distributorId,
              name: b.name,
              external_code: b.code,
            })),
          )
          .select("id, name, external_code");
        if (insErr) throw new Error(insErr.message);
        for (const b of (data as KnownBranch[]) ?? []) {
          resolved.set(`n:${b.name}`, b.id);
          if (b.external_code) resolved.set(`c:${b.external_code.toLowerCase()}`, b.id);
        }
      }

      const rows = plan.rows
        .map((r) => {
          const branchId =
            r.branchId ??
            (r.branchCode ? resolved.get(`c:${r.branchCode.toLowerCase()}`) : undefined) ??
            (r.newBranchName ? resolved.get(`n:${r.newBranchName}`) : undefined) ??
            null;
          return branchId === null ? null : { ...r, branchId };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      const { data: up, error: upErr } = await supabase
        .from("sell_through_uploads")
        .insert({
          org_id: profile.orgId,
          distributor_id: distributorId,
          period,
          uploaded_by: profile.membershipId,
          row_count: rows.length,
          unmatched_count: rows.filter((r) => r.dealerId === null).length,
        })
        .select("id")
        .single();
      if (upErr) throw new Error(upErr.message);
      const uploadId = (up as { id: string }).id;

      // Chunked, because a real month is thousands of lines and one request
      // carrying all of them is one request that can fail all of them.
      for (let i = 0; i < rows.length; i += 400) {
        const { error: rowErr } = await supabase.from("sell_through").insert(
          rows.slice(i, i + 400).map((r) => ({
            org_id: profile.orgId,
            upload_id: uploadId,
            branch_id: r.branchId,
            dealer_id: r.dealerId,
            dealer_label: r.dealerLabel,
            period,
            product: r.product,
            quantity: r.quantity,
            unit: "LF",
            source_quantity: r.sourceQuantity,
            source_unit: r.sourceUnit,
            value: r.value,
          })),
        );
        if (rowErr) throw new Error(rowErr.message);
      }

      setDone(
        `${QTY.format(rows.length)} ${rows.length === 1 ? "row" : "rows"} loaded for ${periodLabel(period)}.`,
      );
      setPasted("");
      setTouchedMapping(false);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the file.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Remove one month, and only that month.
   *
   * The cascade does the work: rows point at their upload, so deleting the upload
   * takes its rows and nothing else's — proven in 16_sell_through and measured
   * again here (108 rows to 81, other houses untouched).
   *
   * What the cascade CANNOT reach is the branch list. Yards are reference data
   * created alongside an upload rather than owned by it, so a month loaded with a
   * misspelled branch leaves that branch behind, sitting on the coverage map and
   * inflating its denominator for good. They are collected afterwards and offered
   * — never removed automatically, because a yard with no sales is exactly what a
   * coverage map exists to show, and telling those two cases apart is a judgement
   * only the person who typed it can make.
   */
  async function removeUpload(uploadId: string) {
    setRemoving(true);
    setError(null);
    setOrphans([]);
    const supabase = getSupabaseBrowserClient();
    try {
      const { error: delErr } = await supabase
        .from("sell_through_uploads")
        .delete()
        .eq("id", uploadId);
      if (delErr) throw new Error(delErr.message);

      // Which of this house's yards are now empty across EVERY month.
      const { data: left } = await supabase
        .from("sell_through")
        .select("branch_id")
        .limit(5000);
      const stillUsed = new Set(
        ((left as { branch_id: string }[]) ?? []).map((r) => r.branch_id),
      );
      setOrphans(
        mineBranches
          .filter((b) => !stillUsed.has(b.id))
          .map((b) => ({ id: b.id, name: b.name })),
      );

      setArmed(null);
      setDone(null);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove that month.");
    } finally {
      setRemoving(false);
    }
  }

  async function removeOrphanBranches() {
    setRemoving(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    try {
      const { error: delErr } = await supabase
        .from("distributor_branches")
        .delete()
        .in("id", orphans.map((o) => o.id));
      if (delErr) throw new Error(delErr.message);
      setOrphans([]);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove those yards.");
    } finally {
      setRemoving(false);
    }
  }

  if (profile && !manages(profile.role)) {
    return (
      <div className="stack pt-2">
        <div className="card card-pad">
          <p className="t-sub">
            The distributors&rsquo; reports are loaded by an admin. Nothing to do
            here.
          </p>
        </div>
      </div>
    );
  }

  const mine = uploads.filter((u) => u.distributor_id === distributorId);

  return (
    <div className="stack pt-2">
      <section>
        <h1 className="text-[22px] font-extrabold leading-tight tracking-tight">
          Load a sales report
        </h1>
        <p className="t-sub mt-1" style={{ maxWidth: "52ch" }}>
          The month a distributor sends you. Paste the sheet — any columns, any
          order — say which is which, and check what it found before it lands.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="t-meta">Which house sent it</span>
          <select
            value={distributorId}
            onChange={(e) => setDistributorId(e.target.value)}
            className="field"
          >
            <option value="">Pick the distributor</option>
            {distributors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        {/* A LIST, not <input type="month">. Safari sizes a native month control
            to its own formatted value and will not shrink below it, so "July
            2026" plus the spinner ran off the edge of a handset even at
            width:100% — and Chrome honours the width, which is why it only
            showed up on a phone. A month is a pick from eighteen options; that
            never needed a date widget, and a select cannot overflow. */}
        <label className="flex flex-col gap-1">
          <span className="t-meta">
            Which month it covers — the report is always a month behind
          </span>
          <select
            value={when ? `${when.year}-${String(when.month).padStart(2, "0")}` : ""}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number);
              if (y && m) setWhen({ year: y, month: m });
            }}
            className="field"
          >
            {months.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {existing && (
          <p className="t-sub" style={{ color: "var(--warn-ink)" }}>
            {periodLabel(period)} is already loaded for this house
            {` — ${QTY.format(existing.row_count)} rows. Loading again REPLACES it, so the book cannot double.`}
          </p>
        )}
      </section>

      {distributorId && (
        <section className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="t-meta">
              Paste the sheet, header row included
            </span>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              className="field paste-box"
              rows={6}
              placeholder={"Branch\tCustomer\tProduct\tQty\tValue\n…"}
            />
          </label>

          {sheet.headers.length > 0 && (
            <div className="card card-pad flex flex-col gap-3">
              <p className="t-meta uppercase tracking-wide">
                Which column is which
              </p>
              {FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-3">
                  <span className="t-sub" style={{ flex: "0 0 42%" }}>
                    {f.label}
                    {f.need ? "" : " (optional)"}
                  </span>
                  <select
                    value={mapping[f.key]}
                    onChange={(e) => {
                      setTouchedMapping(true);
                      setMapping({ ...mapping, [f.key]: Number(e.target.value) });
                    }}
                    className="field"
                    style={{ flex: "1 1 0", minWidth: 0 }}
                  >
                    <option value={-1}>Not in the file</option>
                    {sheet.headers.map((h, i) => (
                      <option key={`${h}-${i}`} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {problem && (
                <p className="t-sub" style={{ color: "var(--danger)" }}>
                  {problem}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {plan && !problem && (
        <section className="flex flex-col gap-3">
          <div className="section-head">
            <h2 className="t-section">What it found</h2>
            <span className="t-meta">{periodLabel(period)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="card card-pad">
              <div className="t-meta uppercase tracking-wide">Volume</div>
              <div className="mt-1 text-2xl font-bold tracking-tight">
                {QTY.format(plan.quantity)} LF
              </div>
              <div className="t-meta mt-0.5">
                {QTY.format(plan.rows.length)} rows
                {plan.skipped > 0 ? `, ${QTY.format(plan.skipped)} skipped` : ""}
              </div>
            </div>
            <div className="card card-pad">
              <div className="t-meta uppercase tracking-wide">Matched</div>
              <div className="mt-1 text-2xl font-bold tracking-tight">
                {QTY.format(plan.matchedRows)}
                <span className="t-meta"> / {QTY.format(plan.rows.length)}</span>
              </div>
              <div className="t-meta mt-0.5">
                {plan.value !== null
                  ? formatMoney(Math.round(plan.value))
                  : "no price in this file"}
              </div>
            </div>
          </div>

          {/* The arithmetic laid out, because it is the one thing on this screen
              nobody can check by eye. An admin can put the middle line against
              the bottom of their own spreadsheet; if it disagrees, the mapping is
              wrong and nothing has been written yet. */}
          <div className="card card-pad">
            <p className="t-meta uppercase tracking-wide">How that was reached</p>
            <ul className="mt-1.5 flex flex-col gap-1">
              <li className="t-sub flex justify-between gap-3">
                <span>Lines in the sheet</span>
                <span className="t-meta tabular-nums">
                  {QTY.format(sheet.rows.length)}
                </span>
              </li>
              {plan.subtotals > 0 && (
                <li className="t-sub flex justify-between gap-3">
                  <span style={{ color: "var(--warn-ink)", fontWeight: 600 }}>
                    Subtotal lines thrown away
                  </span>
                  <span className="t-meta tabular-nums">
                    −{QTY.format(plan.subtotals)}
                  </span>
                </li>
              )}
              {plan.lostBusiness > 0 && (
                <li className="t-sub flex justify-between gap-3">
                  <span>Bought last year, nothing now</span>
                  <span className="t-meta tabular-nums">
                    −{QTY.format(plan.lostBusiness)}
                  </span>
                </li>
              )}
              {plan.skipped > 0 && (
                <li className="t-sub flex justify-between gap-3">
                  <span>Blank or not a sales line</span>
                  <span className="t-meta tabular-nums">
                    −{QTY.format(plan.skipped)}
                  </span>
                </li>
              )}
              <li className="t-sub flex justify-between gap-3">
                <span style={{ fontWeight: 700 }}>Sales lines to load</span>
                <span className="t-meta tabular-nums" style={{ fontWeight: 700 }}>
                  {QTY.format(plan.rows.length)}
                </span>
              </li>
              {plan.sourceQuantity !== Math.round(plan.quantity) && (
                <li className="t-sub flex justify-between gap-3">
                  <span>
                    Their quantity, converted to linear feet by the length in the
                    item name
                  </span>
                  <span className="t-meta shrink-0 tabular-nums">
                    {QTY.format(plan.sourceQuantity)} → {QTY.format(plan.quantity)}{" "}
                    LF
                  </span>
                </li>
              )}
            </ul>
          </div>

          {plan.unconvertible.length > 0 && (
            <div className="card card-pad">
              <p className="t-title">
                {`${plan.unconvertible.length} ${
                  plan.unconvertible.length === 1 ? "line" : "lines"
                } in a unit we can’t turn into feet`}
              </p>
              <p className="t-sub mt-1">
                A piece count needs a length to multiply by, and these items
                don&rsquo;t carry one. Their volume is unknown rather than zero, so
                they are left out instead of loaded as nothing — map the Item
                column if you haven&rsquo;t, or send me one of these lines.
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {plan.unconvertible.slice(0, 5).map((u, i) => (
                  <li
                    key={`${u.label}-${i}`}
                    className="t-sub flex justify-between gap-3"
                  >
                    <span className="min-w-0 truncate">{u.label}</span>
                    <span className="t-meta shrink-0 tabular-nums">
                      {QTY.format(u.quantity)} {u.unit}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.newBranches.length > 0 && (
            <div className="card card-pad">
              {/* One expression, not text wrapped around one: JSX strips the
                  leading space of a text chunk that spans lines, which turned
                  this into "1 yardwe don't hold yet". */}
              <p className="t-title">
                {`${plan.newBranches.length} ${
                  plan.newBranches.length === 1 ? "yard" : "yards"
                } we don’t hold yet`}
              </p>
              <p className="t-sub mt-1">
                {plan.newBranches.map((b) => b.name).join(", ")}
              </p>
              <label className="mt-2.5 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={addBranches}
                  onChange={(e) => setAddBranches(e.target.checked)}
                />
                <span className="t-sub">
                  Add them to this house&rsquo;s branch list. Unticked, their rows
                  are left out — a branch is where a row lives, so it cannot be
                  loaded without one.
                </span>
              </label>
            </div>
          )}

          {plan.unmatched.length > 0 && (
            <div className="card card-pad">
              <p className="t-title">
                {`${plan.unmatched.length} ${
                  plan.unmatched.length === 1 ? "dealer" : "dealers"
                } we couldn’t name`}
              </p>
              <p className="t-sub mt-1">
                These load anyway and keep the file&rsquo;s own spelling, so the
                volume is not lost. They count towards nobody&rsquo;s patch until
                somebody maps them.
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {plan.unmatched.slice(0, 8).map((u) => (
                  <li key={u.label} className="t-sub flex justify-between gap-3">
                    <span className="min-w-0 truncate">{u.label}</span>
                    <span className="t-meta shrink-0 tabular-nums">
                      {QTY.format(u.quantity)} LF
                    </span>
                  </li>
                ))}
              </ul>
              {plan.unmatched.length > 8 && (
                <p className="t-meta mt-1">
                  and {plan.unmatched.length - 8} more
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="t-sub" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}

          <button
            type="button"
            className="btn-primary"
            disabled={saving || loadable === 0}
            onClick={() => void save()}
          >
            {saving
              ? "Loading…"
              : `${existing ? "Replace" : "Load"} ${periodLabel(period)} · ${QTY.format(loadable)} rows`}
          </button>
        </section>
      )}

      {done && (
        <section className="card card-pad flex flex-col gap-2">
          <p className="t-title">{done}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => router.push("/")}
          >
            See it on the dashboard
          </button>
        </section>
      )}

      {distributorId && mine.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="t-section">Already loaded</h2>
          </div>
          <ul className="list">
            {mine.map((u) => (
              <li key={u.id}>
                {armed === u.id ? (
                  /* Armed. It names the month and the count, because "are you
                     sure?" is not information — what a person needs before
                     pressing this is what disappears. */
                  <span className="row" style={{ borderColor: "var(--danger)" }}>
                    <span className="row-body">
                      <span className="t-title">
                        {`Remove ${periodLabel(u.period)}?`}
                      </span>
                      <span className="t-sub block">
                        {`Its ${QTY.format(u.row_count)} rows go with it. No other month is touched, and it cannot be undone — but the file can be loaded again.`}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col gap-1.5">
                      <button
                        type="button"
                        className="btn-quiet"
                        style={{ color: "var(--danger)", fontWeight: 700 }}
                        disabled={removing}
                        onClick={() => void removeUpload(u.id)}
                      >
                        {removing ? "Removing…" : "Remove"}
                      </button>
                      <button
                        type="button"
                        className="btn-quiet"
                        disabled={removing}
                        onClick={() => setArmed(null)}
                      >
                        Keep
                      </button>
                    </span>
                  </span>
                ) : (
                  <span className="row">
                    <span className="row-body">
                      <span className="t-title">{periodLabel(u.period)}</span>
                      <span className="t-sub block">
                        {QTY.format(u.row_count)} rows
                        {u.unmatched_count > 0
                          ? ` · ${QTY.format(u.unmatched_count)} unnamed`
                          : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn-quiet shrink-0"
                      onClick={() => setArmed(u.id)}
                    >
                      Remove
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="t-sub mt-2 px-1">
            Loading a month that is already here replaces it, so a corrected file
            needs no removal first. Remove is for a month that should never have
            been loaded at all — the wrong house, or the wrong month on the right
            sheet.
          </p>
        </section>
      )}

      {/* The one thing the cascade cannot reach. Yards are reference data, not
          owned by the upload that introduced them, so a misspelling survives the
          month it arrived with and keeps inflating the coverage denominator. */}
      {orphans.length > 0 && (
        <section className="card card-pad">
          <p className="t-title">
            {`${orphans.length} ${orphans.length === 1 ? "yard has" : "yards have"} no sales left against them`}
          </p>
          <p className="t-sub mt-1">
            Removing a month does not remove the yards it introduced, because a
            yard is a place rather than a figure. Keep them if they are real and
            simply quiet — a branch buying nothing is exactly what the coverage map
            is for. Remove them if they arrived from a misspelling.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {orphans.map((o) => (
              <li key={o.id} className="t-sub">
                {o.name}
              </li>
            ))}
          </ul>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              className="btn-quiet"
              style={{ color: "var(--danger)", fontWeight: 700 }}
              disabled={removing}
              onClick={() => void removeOrphanBranches()}
            >
              {removing ? "Removing…" : "Remove these yards"}
            </button>
            <button
              type="button"
              className="btn-quiet"
              onClick={() => setOrphans([])}
            >
              Keep them
            </button>
          </div>
        </section>
      )}

      <p className="t-sub px-1">
        <Link href="/" className="t-action underline underline-offset-2">
          Back to the dashboard
        </Link>
      </p>
    </div>
  );
}
