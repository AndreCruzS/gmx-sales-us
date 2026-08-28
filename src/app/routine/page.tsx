"use client";

// Routine — the customer's to-do list, grouped by chore. A rep lands here
// from the Home tile ("5 · Routine — 2 samples · 2 quotes · 1 display") and
// sees exactly what's still open, sorted the way they think about it: samples
// waiting on a follow-up call, quotes waiting on a chase, display walls
// waiting on a check. Nothing here is "ticked" — a row clears itself the
// moment the rep records the call (SAMPLE_FOLLOW_UP/QUOTE_FOLLOW_UP/OTHER) or
// checks the wall (DISPLAY_CHECK), same as the rest of the app's D45/D46
// "done is earned, not ticked" rule. An item that's ignored past its
// threshold leaves this list and becomes an exception on /visits — one home
// rule, no double-listing (see src/lib/routine/items.ts).
//
// Offline-first like every other screen: the cache-first build
// (buildRoutineItems/groupRoutine) renders instantly from what's already on
// the device — the same working set Home reads (D56). A background refresh
// then reads the `routine_items` view directly and, on success, REPLACES the
// cache-built list with server truth (mapped into the same RoutineItem
// shape) — the view is the source of truth whenever there's a signal; the
// cache-built list is only ever a stand-in for when there isn't one.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOffline } from "@/components/offline-provider";
import {
  BuildingIcon,
  CheckIcon,
  FileIcon,
} from "@/components/icons";
import { displayAccountName, relativizeDates } from "@/lib/format";
import {
  getOfflineLayer,
  type CachedAccount,
  type CachedAgendaItem,
} from "@/lib/offline";
import {
  buildRoutineItems,
  groupRoutine,
  type RoutineItem,
  type RoutineSettings,
} from "@/lib/routine/items";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Same 4/6 defaults the `routine_items` view falls back to server-side
// (coalesce(...,4) / coalesce(...,6) in the migration) and the same shape
// Home parses org_settings into — duplicated here rather than imported
// because home-client.tsx doesn't export it; every page that reads this
// cache key owns its own small parse, same as isoDate is duplicated across
// pages rather than shared.
const DEFAULT_SETTINGS: RoutineSettings = {
  display_routine_months: 4,
  display_verify_months: 6,
  overdue_follow_up_days: 7,
};

function parseSettings(raw: string | null): RoutineSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<RoutineSettings>;
    return {
      display_routine_months:
        typeof parsed.display_routine_months === "number"
          ? parsed.display_routine_months
          : DEFAULT_SETTINGS.display_routine_months,
      display_verify_months:
        typeof parsed.display_verify_months === "number"
          ? parsed.display_verify_months
          : DEFAULT_SETTINGS.display_verify_months,
      overdue_follow_up_days: DEFAULT_SETTINGS.overdue_follow_up_days,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// The `routine_items` view's row shape (supabase/migrations/20260729000100_routine.sql):
// kind, item_id, org_id, owner_membership_id, account_id, account_name,
// action, context_date, due_date. Mapped 1:1 into RoutineItem below.
interface RoutineViewRow {
  kind: string;
  item_id: string;
  account_id: string | null;
  account_name: string | null;
  action: string;
  context_date: string;
  due_date: string;
}

function fromViewRow(row: RoutineViewRow): RoutineItem {
  return {
    kind: row.kind as RoutineItem["kind"],
    itemId: row.item_id,
    accountId: row.account_id,
    accountName: row.account_name ?? "",
    action: row.action,
    contextDate: row.context_date,
    dueDate: row.due_date,
  };
}

const KIND_ICON: Record<RoutineItem["kind"], typeof FileIcon> = {
  SAMPLE_FOLLOW_UP: FileIcon,
  QUOTE_FOLLOW_UP: FileIcon,
  DISPLAY_CHECK: BuildingIcon,
  OTHER: CheckIcon,
};

// Context line by kind — exactly the three phrases the brief specifies, run
// through relativizeDates so the ISO date reads "today"/"in 3 days"/"Jul 21"
// the way every other screen's dates do. OTHER has no server-specified
// phrase (it's a catch-all for chores that aren't samples/quotes/displays),
// so the sub-line falls back to the next_action's own action text.
function contextLine(item: RoutineItem): string {
  switch (item.kind) {
    case "SAMPLE_FOLLOW_UP":
      return relativizeDates(`sample sent ${item.contextDate}`);
    case "QUOTE_FOLLOW_UP":
      return relativizeDates(`quoted ${item.contextDate}`);
    case "DISPLAY_CHECK":
      return relativizeDates(`last checked ${item.contextDate}`);
    case "OTHER":
      return item.action;
  }
}

// Row action by kind (Task 5's landed deep links): display checks send the
// rep to plan a visit with the objective preset; everything else sends them
// to Record with the account and the specific next_action preselected.
function rowAction(item: RoutineItem): { label: string; href: string } {
  if (item.kind === "DISPLAY_CHECK") {
    return {
      label: "Plan visit",
      href: `/visits?plan=${item.accountId ?? ""}&objective=MERCHANDISING_CHECK`,
    };
  }
  const params = new URLSearchParams();
  if (item.accountId) params.set("account", item.accountId);
  params.set("item", item.itemId);
  return { label: "Record call", href: `/record?${params.toString()}` };
}

export default function RoutinePage() {
  const { profile, status } = useOffline();

  const [todayIso, setTodayIso] = useState("");
  const [agenda, setAgenda] = useState<CachedAgendaItem[]>([]);
  const [accounts, setAccounts] = useState<CachedAccount[]>([]);
  const [settings, setSettings] = useState<RoutineSettings>(DEFAULT_SETTINGS);
  // null = no server signal yet (or the fetch failed) — the cache-built list
  // renders instead. Populated array = server truth, replaces the cache list.
  const [onlineItems, setOnlineItems] = useState<RoutineItem[] | null>(null);
  const [offlineView, setOfflineView] = useState(false);

  const load = useCallback(async () => {
    const layer = getOfflineLayer();
    const [a, accts, settingsRaw] = await Promise.all([
      layer.local.getAgenda(),
      layer.local.getAccounts(),
      layer.local.getMeta("org_settings"),
    ]);
    setAgenda(a);
    setAccounts(accts);
    setSettings(parseSettings(settingsRaw));
    setTodayIso(isoDate(new Date()));
  }, []);

  // Deferred via setTimeout — a bare synchronous setState in an effect body
  // trips the "avoid cascading renders" React-compiler lint (same pattern as
  // Home's own load effect).
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, status.pending, status.lastPulledAt]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;

    async function loadOnline() {
      try {
        const { data, error } = await getSupabaseBrowserClient()
          .from("routine_items")
          .select(
            "kind, item_id, org_id, owner_membership_id, account_id, account_name, action, context_date, due_date",
          )
          .order("due_date");
        if (error) throw new Error(error.message);
        if (cancelled) return;
        setOnlineItems((data as RoutineViewRow[]).map(fromViewRow));
        setOfflineView(false);
      } catch {
        if (cancelled) return;
        setOnlineItems(null);
        setOfflineView(true);
      }
    }

    void loadOnline();
    return () => {
      cancelled = true;
    };
  }, [profile, status.lastPulledAt]);

  const cacheItems = useMemo(
    () => (todayIso ? buildRoutineItems(agenda, accounts, settings, todayIso) : []),
    [agenda, accounts, settings, todayIso],
  );

  const routineItems = onlineItems ?? cacheItems;
  const routineGroups = useMemo(() => groupRoutine(routineItems), [routineItems]);

  return (
    <div className="stack pt-2">
      {offlineView && (
        <section>
          <p className="tag tag-accent">
            No signal — showing what&apos;s saved on this device
          </p>
        </section>
      )}

      {routineGroups.length === 0 ? (
        <section>
          <p className="t-sub px-1">Nothing due — the list is clear.</p>
        </section>
      ) : (
        routineGroups.map((group) => {
          const Icon = KIND_ICON[group.kind];
          return (
            <section key={group.kind}>
              <div className="section-head">
                <h2 className="t-section">{group.label}</h2>
                <span className="t-meta">{group.items.length}</span>
              </div>
              <ul className="list">
                {group.items.map((item) => {
                  const action = rowAction(item);
                  const title = item.accountName
                    ? displayAccountName(item.accountName)
                    : item.action;
                  const sub =
                    item.kind === "OTHER" && !item.accountName
                      ? null
                      : contextLine(item);
                  return (
                    <li key={`${item.kind}-${item.itemId}`} className="row">
                      <span className="row-lead">
                        <Icon size={17} />
                      </span>
                      <span className="row-body min-w-0">
                        <span className="t-title block truncate">{title}</span>
                        {sub && <span className="t-sub block truncate">{sub}</span>}
                      </span>
                      <Link href={action.href} className="t-action shrink-0">
                        {action.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}

      {routineGroups.length > 0 && (
        <section>
          <p className="t-hint px-1">
            Recording the call or checking the wall clears these — nothing to
            tick.
          </p>
        </section>
      )}
    </div>
  );
}
