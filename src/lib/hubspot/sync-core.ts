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

import type { HsProps, HsRecord } from "./port";

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

// ── Inbound ──────────────────────────────────────────────────────────────
//
// Rules, in the order they gate:
//   no links entry                          → unlinked (store resolves:
//                                              deal → create, else error row)
//   record props === snapshot props         → echo (our own outbound write
//                                              coming back around)
//   HS changed vs snapshot, local unchanged  → apply, only the changed props
//   no snapshot but a link (backfill-adopted
//     during the link) → treat local as unchanged, diff against the link's
//                         current props instead of a snapshot
//   both changed (true conflict)             → newer timestamp wins:
//     local newer  → local-wins, but HubSpot stays stage-authoritative: if
//                     opts.stagePropName is set and the HS stage differs
//                     from the local link's stage, carry a stagePatch anyway
//     HS newer     → apply, patch = props differing from the local link's
//                     current props (the store applies it to local rows)

export interface LocalLink {
  entityId: string;
  updatedAt: string; // our updated_at ISO
  props: HsProps; // current local values mapped to HS prop space
}

export type InboundDecision =
  | { kind: "echo"; hubspotId: string }
  | { kind: "apply"; entityId: string; patch: HsProps; stageChanged: boolean }
  | { kind: "local-wins"; entityId: string; stagePatch: HsProps | null }
  | { kind: "unlinked"; hubspotId: string }; // no local row — store resolves (deal→create, else error row)

/** ISO timestamp or ms-epoch string, normalized to ms for comparison. */
function toMs(iso: string): number {
  return Date.parse(iso);
}

function toApplyDecision(
  entityId: string,
  hsProps: HsProps,
  baseline: HsProps,
  stagePropName: "dealstage" | null,
): InboundDecision {
  const patch = diffProps(hsProps, baseline);
  const stageChanged = stagePropName !== null && stagePropName in patch;
  return { kind: "apply", entityId, patch, stageChanged };
}

export function planInbound(
  records: HsRecord[],
  links: Map<string, LocalLink>,
  snapshots: Map<string, Snapshot>,
  opts: { stagePropName: "dealstage" | null },
): InboundDecision[] {
  const decisions: InboundDecision[] = [];

  for (const record of records) {
    const link = links.get(record.id);
    if (!link) {
      decisions.push({ kind: "unlinked", hubspotId: record.id });
      continue;
    }

    const snapshot = snapshots.get(link.entityId);
    // No prior snapshot (backfill-adopted link) — the local link's current
    // props are the only baseline we have; treat local as unchanged (rule 5).
    const baseline = snapshot ? snapshot.props : link.props;

    if (propsEqual(record.props, baseline)) {
      decisions.push({ kind: "echo", hubspotId: record.id });
      continue;
    }

    const localChanged = snapshot ? !propsEqual(link.props, snapshot.props) : false;

    if (!localChanged) {
      decisions.push(toApplyDecision(link.entityId, record.props, baseline, opts.stagePropName));
      continue;
    }

    // True conflict: both sides changed since the snapshot. Newer wins.
    const hsMs = Number(record.lastModifiedAt);
    const localMs = toMs(link.updatedAt);

    if (localMs >= hsMs) {
      let stagePatch: HsProps | null = null;
      if (opts.stagePropName) {
        const stageProp = opts.stagePropName;
        const hsStage = record.props[stageProp];
        const localStage = link.props[stageProp];
        if (hsStage !== localStage) {
          stagePatch = { [stageProp]: hsStage };
        }
      }
      decisions.push({ kind: "local-wins", entityId: link.entityId, stagePatch });
      continue;
    }

    decisions.push(toApplyDecision(link.entityId, record.props, link.props, opts.stagePropName));
  }

  return decisions;
}
