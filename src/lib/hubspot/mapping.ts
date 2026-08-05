// Pure row → HubSpot-props mappers (and the inverse, for inbound webhooks).
// No network, no Supabase client — just data in, data out. Fixture-tested in
// __tests__/mapping.test.ts. Row types below are minimal structural
// interfaces: only the columns each mapper reads, not database.types.ts.

import { humanize } from "@/lib/domain/enums";
import { P } from "./properties";
import type { HsProps, HubSpotOrgConfig } from "./port";

// ── Row types ────────────────────────────────────────────────────────────

export interface AccountRow {
  name: string;
  city: string | null;
  account_type: string;
  lead_source: string;
  has_display_wall: boolean;
  owner_id: string; // membership_id, looked up in ownerMap
}

export interface ContactRow {
  name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  is_champion: boolean;
}

export interface OpportunityRow {
  name: string;
  stage: string;
  estimated_revenue: number | null;
  expected_close_date: string | null; // yyyy-mm-dd
  current_status: string | null;
  current_blocker: string | null;
  lead_source: string;
}

export interface ActivityRow {
  activity_type: string;
  occurred_at: string; // ISO timestamp
  purpose: string | null;
  objective: string | null;
  what_happened: string | null;
  outcomes: string[];
}

export interface NextActionRow {
  action: string;
  due_date: string; // yyyy-mm-dd
  completed_at: string | null;
  objective_detail: string | null;
  owner_id: string; // membership_id, looked up in ownerMap
}

export interface DealPatch {
  stage?: string;
  name?: string;
  estimated_revenue?: number | null;
  expected_close_date?: string | null; // yyyy-mm-dd
  current_status?: string | null;
  current_blocker?: string | null;
}

/** Thrown when a stage can't be translated in either direction. */
export class MappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MappingError";
  }
}

// ── Date helpers ─────────────────────────────────────────────────────────

/** yyyy-mm-dd → ms-epoch string at UTC midnight of that date. */
function utcMidnightMs(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return String(Date.UTC(year, month - 1, day));
}

/** ms-epoch string → yyyy-mm-dd (UTC). */
function msToDateString(ms: string): string {
  return new Date(Number(ms)).toISOString().slice(0, 10);
}

/** hubspot_owner_id from ownerMap — omit the key entirely on a miss, never "". */
function ownerProp(ownerId: string, ownerMap: Record<string, string>): HsProps {
  const hsOwnerId = ownerMap[ownerId];
  return hsOwnerId ? { hubspot_owner_id: hsOwnerId } : {};
}

export function splitName(full: string): { firstname: string; lastname: string } {
  const [firstname, ...rest] = full.trim().split(/\s+/);
  return { firstname: firstname ?? "", lastname: rest.join(" ") };
}

// ── Company / Contact / Deal ────────────────────────────────────────────

export function accountToCompanyProps(
  a: AccountRow,
  ownerMap: Record<string, string>,
): HsProps {
  return {
    name: a.name,
    city: a.city,
    [P.accountType]: a.account_type,
    [P.leadSource]: a.lead_source,
    [P.displayWall]: a.has_display_wall ? "true" : "false",
    [P.managed]: "true",
    ...ownerProp(a.owner_id, ownerMap),
  };
}

export function contactToContactProps(
  c: ContactRow,
  ownerMap: Record<string, string>,
): HsProps {
  void ownerMap; // contacts carry no owner column in v1 — kept for signature parity
  const { firstname, lastname } = splitName(c.name);
  return {
    firstname,
    lastname,
    email: c.email,
    phone: c.phone,
    jobtitle: c.job_title,
    [P.isChampion]: c.is_champion ? "true" : "false",
    [P.managed]: "true",
  };
}

export function opportunityToDealProps(
  o: OpportunityRow,
  cfg: HubSpotOrgConfig,
): HsProps {
  const dealstage = cfg.stage_map[o.stage];
  if (!dealstage) {
    throw new MappingError(`No HubSpot stage mapped for opportunity stage "${o.stage}"`);
  }
  return {
    dealname: o.name,
    pipeline: cfg.pipeline_id,
    dealstage,
    amount: o.estimated_revenue == null ? null : String(o.estimated_revenue),
    closedate:
      o.expected_close_date == null ? null : utcMidnightMs(o.expected_close_date),
    [P.currentStatus]: o.current_status,
    [P.currentBlocker]: o.current_blocker,
    [P.leadSource]: o.lead_source,
    [P.managed]: "true",
  };
}

/** Inverse of opportunityToDealProps — keys present only when the HS prop is present. */
export function dealPropsToPatch(props: HsProps, cfg: HubSpotOrgConfig): DealPatch {
  const patch: DealPatch = {};

  if ("dealstage" in props) {
    const hsStageId = props.dealstage;
    const ourStage = Object.entries(cfg.stage_map).find(([, id]) => id === hsStageId)?.[0];
    if (!ourStage) {
      throw new MappingError(`Unknown HubSpot deal stage id "${hsStageId}"`);
    }
    patch.stage = ourStage;
  }
  if ("dealname" in props && props.dealname !== null) {
    patch.name = props.dealname;
  }
  if ("amount" in props) {
    patch.estimated_revenue = props.amount == null ? null : Number(props.amount);
  }
  if ("closedate" in props) {
    patch.expected_close_date =
      props.closedate == null ? null : msToDateString(props.closedate);
  }
  if (P.currentStatus in props) {
    patch.current_status = props[P.currentStatus];
  }
  if (P.currentBlocker in props) {
    patch.current_blocker = props[P.currentBlocker];
  }
  return patch;
}

// ── Engagements (notes / meetings / calls) ─────────────────────────────────

const MEETING_ACTIVITY_TYPES = new Set([
  "DEALER_VISIT",
  "DISTRIBUTOR_VISIT",
  "CONTRACTOR_MEETING",
  "ARCHITECT_MEETING",
  "JOBSITE_VISIT",
  "PK_TRAINING",
]);

/** purpose/objective line + what_happened + humanized outcomes, newline-joined, skipping empty parts. */
function composeEngagementBody(act: ActivityRow): string {
  const purposeLine = act.purpose ?? (act.objective ? humanize(act.objective) : null);
  const outcomesLine = act.outcomes.length
    ? act.outcomes.map(humanize).join(", ")
    : null;
  return [purposeLine, act.what_happened, outcomesLine]
    .filter((part): part is string => Boolean(part))
    .join("\n");
}

export function activityToEngagement(act: ActivityRow): {
  type: "meetings" | "calls" | "notes";
  props: HsProps;
} {
  const body = composeEngagementBody(act);
  // Base title — the store appends account context (later task).
  const title = humanize(act.activity_type);

  if (MEETING_ACTIVITY_TYPES.has(act.activity_type)) {
    return {
      type: "meetings",
      props: {
        hs_meeting_title: title,
        hs_meeting_body: body,
        hs_timestamp: act.occurred_at,
      },
    };
  }
  if (act.activity_type === "PHONE_CALL") {
    return {
      type: "calls",
      props: {
        hs_call_title: title,
        hs_call_body: body,
        hs_timestamp: act.occurred_at,
      },
    };
  }
  return {
    type: "notes",
    props: {
      hs_note_body: body,
      hs_timestamp: act.occurred_at,
    },
  };
}

// ── Task ─────────────────────────────────────────────────────────────────

export function nextActionToTaskProps(
  n: NextActionRow,
  ownerMap: Record<string, string>,
): HsProps {
  return {
    hs_task_subject: n.action,
    hs_timestamp: utcMidnightMs(n.due_date),
    hs_task_status: n.completed_at ? "COMPLETED" : "NOT_STARTED",
    hs_task_body: n.objective_detail ?? null,
    ...ownerProp(n.owner_id, ownerMap),
  };
}
