// The HubSpot sync pass. Pure planning over ports — no HubSpot SDK, no
// Supabase client, no Date.now() — so echo suppression and patch shaping are
// fixture-testable. The store applies Task 7 mappers before candidates reach
// here; this module only reasons about already-mapped HsProps.
//
// Rules, in the order they gate (outbound direction):
//   no hubspotId                         → creates
//   hubspotId + props === last snapshot  → echoes (our own inbound write
//                                           coming back around; skip it or
//                                           we'd ping-pong with HubSpot)
//   hubspotId + props differ from snapshot → patches, only the changed keys
//                                             (keeps HubSpot's property
//                                             history clean)
//   hubspotId + no snapshot (backfill-adopted record) → full-props patch

import type { HsProps } from "./port";

// ── Outbound ─────────────────────────────────────────────────────────────

export interface Snapshot {
  entityId: string;
  hubspotId: string;
  props: HsProps;
}

export interface OutboundCandidate {
  entityType: "account" | "contact" | "opportunity";
  entityId: string;
  hubspotId: string | null;
  updatedAt: string; // our updated_at ISO
  props: HsProps; // already mapped (Task 7 mappers, applied by the store)
}

export interface OutboundPlan {
  creates: OutboundCandidate[];
  patches: { entityId: string; hubspotId: string; props: HsProps }[];
  echoes: string[]; // entityIds skipped as echoes
}

/** Key-set + value compare over flat HsProps — no lodash. */
function propsEqual(a: HsProps, b: HsProps): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[k] === b[k] && k in b);
}

/** Only the keys whose values differ from the snapshot (minimal patch). */
function diffProps(current: HsProps, snapshot: HsProps): HsProps {
  const diff: HsProps = {};
  for (const [k, v] of Object.entries(current)) {
    if (snapshot[k] !== v || !(k in snapshot)) {
      diff[k] = v;
    }
  }
  return diff;
}

export function planOutbound(
  candidates: OutboundCandidate[],
  snapshots: Map<string, Snapshot>,
): OutboundPlan {
  const plan: OutboundPlan = { creates: [], patches: [], echoes: [] };

  for (const cand of candidates) {
    if (!cand.hubspotId) {
      plan.creates.push(cand);
      continue;
    }

    const snapshot = snapshots.get(cand.entityId);
    if (!snapshot) {
      // Backfill-adopted record — no prior snapshot to diff against.
      plan.patches.push({
        entityId: cand.entityId,
        hubspotId: cand.hubspotId,
        props: cand.props,
      });
      continue;
    }

    if (propsEqual(cand.props, snapshot.props)) {
      plan.echoes.push(cand.entityId);
      continue;
    }

    const diff = diffProps(cand.props, snapshot.props);
    if (Object.keys(diff).length === 0) {
      // The only difference is a key present in the snapshot but absent from
      // the candidate (e.g. hubspot_owner_id omitted once a membership drops
      // out of the owner map) — nothing in the candidate's own props changed,
      // so there's nothing to send. Treat as an echo, not a no-op patch call.
      plan.echoes.push(cand.entityId);
      continue;
    }

    plan.patches.push({
      entityId: cand.entityId,
      hubspotId: cand.hubspotId,
      props: diff,
    });
  }

  return plan;
}
