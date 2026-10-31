// Visit capture sections (Dealers page, 2026-10-30): three optional boxes under
// the visit note, one to-do per non-empty line. Pure: text in, rows out.

import type { ItemType } from "@/lib/domain/dealer-items";
import type { NextActionCreate } from "@/lib/domain/schemas";

const DAYS_TO_DUE = 7;

/** 'YYYY-MM-DD' + n days, done on the calendar date (no timezone shift). */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function sectionItems(input: {
  activityId: string;
  orgId: string;
  ownerId: string;
  accountId: string;
  today: string; // local calendar date, YYYY-MM-DD
  actions: string;
  coordinate: string;
  followUps: string;
}): NextActionCreate[] {
  const due = addDays(input.today, DAYS_TO_DUE);
  const sections: [ItemType, string][] = [
    ["ACTION", input.actions],
    ["COORDINATE", input.coordinate],
    ["FOLLOW_UP", input.followUps],
  ];
  const out: NextActionCreate[] = [];
  for (const [item_type, text] of sections) {
    for (const line of text.split(/\r?\n/)) {
      const action = line.trim();
      if (!action) continue;
      out.push({
        id: crypto.randomUUID(),
        org_id: input.orgId,
        owner_id: input.ownerId,
        account_id: input.accountId,
        activity_id: input.activityId,
        action,
        due_date: due,
        item_type,
        source: "VISIT_CAPTURE",
      });
    }
  }
  return out;
}
