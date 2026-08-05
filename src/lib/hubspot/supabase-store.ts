// HubSpotStore over the service-role client (Task 11). Same posture as
// src/lib/email/supabase-store.ts: the service role is used only inside the
// org scope resolved by the cron route, never in a rep's request path.
//
// Row shapes here extend mapping.ts's pure Row types (name/city/stage/...)
// with the sync bookkeeping columns those pure mappers never read
// (id/hubspot_id/updated_at/FKs) — keeps mapping.ts import-free of anything
// but flat field values.
//
// `HubSpotStorePort` is the structural interface run-sync.ts programs
// against — a plain object (test fake) can satisfy it, which the concrete
// `HubSpotStore` class cannot offer directly once it carries a private
// constructor field.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AccountRow,
  ActivityRow,
  ContactRow,
  DealPatch,
  NextActionRow,
  OpportunityRow,
} from "./mapping";
import {
  accountToCompanyProps,
  contactToContactProps,
  dealPropsToPatch,
  opportunityToDealProps,
  splitName,
} from "./mapping";
import { P } from "./properties";
import type { HsProps, HsRecord, HubSpotOrgConfig } from "./port";
import type { LocalLink, Snapshot } from "./sync-core";

export interface ReviewAction {
  id: string;
  action: string;
  owner_id: string;
  due_date: string; // yyyy-mm-dd
  account_id: string;
}

export interface SyncedAccountRow extends AccountRow {
  id: string;
  hubspot_id: string | null;
  updated_at: string;
  parent_account_id: string | null;
}

export interface SyncedContactRow extends ContactRow {
  id: string;
  hubspot_id: string | null;
  updated_at: string;
  account_id: string;
}

export interface SyncedOpportunityRow extends OpportunityRow {
  id: string;
  hubspot_id: string | null;
  updated_at: string;
  primary_account_id: string;
  owner_id: string;
}

export interface SyncedActivityRow extends ActivityRow {
  id: string;
  hubspot_id: string | null;
  updated_at: string;
  primary_account_id: string;
  opportunity_id: string | null;
  contact_ids: string[];
}

export interface SyncedNextActionRow extends NextActionRow {
  id: string;
  hubspot_id: string | null;
  updated_at: string;
  completed_at: string | null;
}

/** A deal LocalLink also carries the opportunity's owner/account — run-sync
 *  needs both to build a review action's `owner_id`/`account_id` without a
 *  second round trip. Structurally still a LocalLink (extra fields ignored
 *  by sync-core's planInbound). */
export interface DealLocalLink extends LocalLink {
  ownerId: string;
  accountId: string;
}

/** The shape run-sync.ts programs against — see file header. */
export interface HubSpotStorePort {
  getCursor(stream: string): Promise<string | null>;
  setCursor(stream: string, cursor: string): Promise<void>;
  changedAccountsSince(iso: string | null): Promise<SyncedAccountRow[]>;
  changedContactsSince(iso: string | null): Promise<SyncedContactRow[]>;
  changedOpportunitiesSince(iso: string | null): Promise<SyncedOpportunityRow[]>;
  changedActivitiesSince(iso: string | null): Promise<SyncedActivityRow[]>;
  changedNextActionsSince(iso: string | null): Promise<SyncedNextActionRow[]>;
  linkHubspotId(table: string, id: string, hubspotId: string): Promise<void>;
  loadSnapshots(entityType: string, entityIds: string[]): Promise<Map<string, Snapshot>>;
  saveSnapshot(entityType: string, s: Snapshot): Promise<void>;
  loadLinksByHubspotId(
    table: "accounts" | "contacts" | "opportunities",
    hubspotIds: string[],
    cfg?: HubSpotOrgConfig,
  ): Promise<Map<string, LocalLink>>;
  /** Local id → hubspot_id, for rows that already have one. Used for
   *  associations (parent company, deal↔company, activity↔contacts). */
  loadHubspotIdsByLocalId(table: string, ids: string[]): Promise<Map<string, string>>;
  applyCompanyPatch(entityId: string, patch: HsProps): Promise<void>;
  applyContactPatch(entityId: string, patch: HsProps): Promise<void>;
  applyDealPatch(
    entityId: string,
    patch: DealPatch,
    review: ReviewAction | null,
  ): Promise<void>;
  createDealFromHubSpot(record: HsRecord, cfg: HubSpotOrgConfig): Promise<void>;
  recordError(
    direction: "outbound" | "inbound",
    entityType: string,
    entityId: string | null,
    hubspotId: string | null,
    payload: unknown,
    error: string,
  ): Promise<void>;
}

/** yyyy-mm-dd, `days` from `base`, in UTC (matches mapping.ts's utcMidnightMs posture). */
function addDaysIso(base: Date, days: number): string {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inverse of accountToCompanyProps for the columns HubSpot can actually
 *  send back (owner/managed are outbound-only in v1 — see mapping.ts). */
function companyPropsToPatch(props: HsProps): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if ("name" in props) patch.name = props.name;
  if ("city" in props) patch.city = props.city;
  if (P.accountType in props) patch.account_type = props[P.accountType];
  if (P.leadSource in props) patch.lead_source = props[P.leadSource];
  if (P.displayWall in props) patch.has_display_wall = props[P.displayWall] === "true";
  return patch;
}

export class HubSpotStore implements HubSpotStorePort {
  constructor(
    private service: SupabaseClient,
    private orgId: string,
  ) {}

  async getCursor(stream: string): Promise<string | null> {
    const { data } = await this.service
      .from("hubspot_sync_cursors")
      .select("cursor")
      .eq("org_id", this.orgId)
      .eq("stream", stream)
      .maybeSingle();
    return (data?.cursor as string | undefined) ?? null;
  }

  async setCursor(stream: string, cursor: string): Promise<void> {
    const { error } = await this.service
      .from("hubspot_sync_cursors")
      .upsert({ org_id: this.orgId, stream, cursor }, { onConflict: "org_id,stream" });
    if (error) throw new Error(`setCursor(${stream}) failed: ${error.message}`);
  }

  async changedAccountsSince(iso: string | null): Promise<SyncedAccountRow[]> {
    let q = this.service
      .from("accounts")
      .select(
        "id, hubspot_id, updated_at, parent_account_id, name, city, account_type, lead_source, has_display_wall, owner_id",
      )
      .eq("org_id", this.orgId);
    if (iso) q = q.gt("updated_at", iso);
    const { data, error } = await q.order("updated_at", { ascending: true }).limit(200);
    if (error) throw new Error(`changedAccountsSince failed: ${error.message}`);
    return (data ?? []) as SyncedAccountRow[];
  }

  async changedContactsSince(iso: string | null): Promise<SyncedContactRow[]> {
    let q = this.service
      .from("contacts")
      .select("id, hubspot_id, updated_at, account_id, name, email, phone, job_title, is_champion")
      .eq("org_id", this.orgId);
    if (iso) q = q.gt("updated_at", iso);
    const { data, error } = await q.order("updated_at", { ascending: true }).limit(200);
    if (error) throw new Error(`changedContactsSince failed: ${error.message}`);
    return (data ?? []) as SyncedContactRow[];
  }

  async changedOpportunitiesSince(iso: string | null): Promise<SyncedOpportunityRow[]> {
    let q = this.service
      .from("opportunities")
      .select(
        "id, hubspot_id, updated_at, primary_account_id, owner_id, name, stage, estimated_revenue, expected_close_date, current_status, current_blocker, lead_source",
      )
      .eq("org_id", this.orgId);
    if (iso) q = q.gt("updated_at", iso);
    const { data, error } = await q.order("updated_at", { ascending: true }).limit(200);
    if (error) throw new Error(`changedOpportunitiesSince failed: ${error.message}`);
    return (data ?? []) as SyncedOpportunityRow[];
  }

  // Append-only stream: activities never patch outbound, so once hubspot_id
  // is set a row can never match again — `iso` just bounds how far back a
  // never-linked backlog gets rescanned.
  async changedActivitiesSince(iso: string | null): Promise<SyncedActivityRow[]> {
    let q = this.service
      .from("activities")
      .select(
        "id, hubspot_id, updated_at, primary_account_id, opportunity_id, activity_type, occurred_at, purpose, objective, objective_detail, what_happened, outcomes",
      )
      .eq("org_id", this.orgId)
      .is("hubspot_id", null);
    if (iso) q = q.gt("updated_at", iso);
    const { data, error } = await q.order("updated_at", { ascending: true }).limit(200);
    if (error) throw new Error(`changedActivitiesSince failed: ${error.message}`);
    const rows = (data ?? []) as Omit<SyncedActivityRow, "contact_ids">[];
    if (rows.length === 0) return [];

    const { data: joinRows, error: joinErr } = await this.service
      .from("activity_contacts")
      .select("activity_id, contact_id")
      .eq("org_id", this.orgId)
      .in(
        "activity_id",
        rows.map((r) => r.id),
      );
    if (joinErr) throw new Error(`changedActivitiesSince (contacts) failed: ${joinErr.message}`);
    const byActivity = new Map<string, string[]>();
    for (const j of joinRows ?? []) {
      const list = byActivity.get(j.activity_id as string) ?? [];
      list.push(j.contact_id as string);
      byActivity.set(j.activity_id as string, list);
    }
    return rows.map((r) => ({ ...r, contact_ids: byActivity.get(r.id) ?? [] }));
  }

  async changedNextActionsSince(iso: string | null): Promise<SyncedNextActionRow[]> {
    let q = this.service
      .from("next_actions")
      .select("id, hubspot_id, updated_at, action, due_date, completed_at, objective_detail, owner_id")
      .eq("org_id", this.orgId);
    if (iso) q = q.gt("updated_at", iso);
    const { data, error } = await q.order("updated_at", { ascending: true }).limit(200);
    if (error) throw new Error(`changedNextActionsSince failed: ${error.message}`);
    return (data ?? []) as SyncedNextActionRow[];
  }

  async linkHubspotId(table: string, id: string, hubspotId: string): Promise<void> {
    const { error } = await this.service
      .from(table)
      .update({ hubspot_id: hubspotId })
      .eq("org_id", this.orgId)
      .eq("id", id);
    if (error) throw new Error(`linkHubspotId(${table}) failed: ${error.message}`);
  }

  async loadSnapshots(entityType: string, entityIds: string[]): Promise<Map<string, Snapshot>> {
    if (entityIds.length === 0) return new Map();
    const { data, error } = await this.service
      .from("hubspot_sync_snapshots")
      .select("entity_id, hubspot_id, synced_props")
      .eq("org_id", this.orgId)
      .eq("entity_type", entityType)
      .in("entity_id", entityIds);
    if (error) throw new Error(`loadSnapshots(${entityType}) failed: ${error.message}`);
    const map = new Map<string, Snapshot>();
    for (const row of data ?? []) {
      map.set(row.entity_id as string, {
        entityId: row.entity_id as string,
        hubspotId: row.hubspot_id as string,
        props: row.synced_props as HsProps,
      });
    }
    return map;
  }

  async saveSnapshot(entityType: string, s: Snapshot): Promise<void> {
    const { error } = await this.service.from("hubspot_sync_snapshots").upsert(
      {
        org_id: this.orgId,
        entity_type: entityType,
        entity_id: s.entityId,
        hubspot_id: s.hubspotId,
        synced_props: s.props,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "org_id,entity_type,entity_id" },
    );
    if (error) throw new Error(`saveSnapshot(${entityType}) failed: ${error.message}`);
  }

  async loadLinksByHubspotId(
    table: "accounts" | "contacts" | "opportunities",
    hubspotIds: string[],
    cfg?: HubSpotOrgConfig,
  ): Promise<Map<string, LocalLink>> {
    const map = new Map<string, LocalLink>();
    if (hubspotIds.length === 0) return map;

    if (table === "accounts") {
      const { data, error } = await this.service
        .from("accounts")
        .select("id, hubspot_id, updated_at, name, city, account_type, lead_source, has_display_wall, owner_id")
        .eq("org_id", this.orgId)
        .in("hubspot_id", hubspotIds);
      if (error) throw new Error(`loadLinksByHubspotId(accounts) failed: ${error.message}`);
      for (const row of (data ?? []) as SyncedAccountRow[]) {
        map.set(row.hubspot_id as string, {
          entityId: row.id,
          updatedAt: row.updated_at,
          props: accountToCompanyProps(row, {}),
        });
      }
      return map;
    }

    if (table === "contacts") {
      const { data, error } = await this.service
        .from("contacts")
        .select("id, hubspot_id, updated_at, name, email, phone, job_title, is_champion")
        .eq("org_id", this.orgId)
        .in("hubspot_id", hubspotIds);
      if (error) throw new Error(`loadLinksByHubspotId(contacts) failed: ${error.message}`);
      for (const row of (data ?? []) as SyncedContactRow[]) {
        map.set(row.hubspot_id as string, {
          entityId: row.id,
          updatedAt: row.updated_at,
          props: contactToContactProps(row, {}),
        });
      }
      return map;
    }

    // opportunities — needs cfg to translate our stage enum into HubSpot's
    // stage ids (opportunityToDealProps), so a deal LocalLink's props are
    // comparable against the props HubSpot itself returns.
    if (!cfg) {
      throw new Error("loadLinksByHubspotId(opportunities) requires cfg");
    }
    const { data, error } = await this.service
      .from("opportunities")
      .select(
        "id, hubspot_id, updated_at, primary_account_id, owner_id, name, stage, estimated_revenue, expected_close_date, current_status, current_blocker, lead_source",
      )
      .eq("org_id", this.orgId)
      .in("hubspot_id", hubspotIds);
    if (error) throw new Error(`loadLinksByHubspotId(opportunities) failed: ${error.message}`);
    for (const row of (data ?? []) as SyncedOpportunityRow[]) {
      try {
        const link: DealLocalLink = {
          entityId: row.id,
          updatedAt: row.updated_at,
          props: opportunityToDealProps(row, cfg),
          ownerId: row.owner_id,
          accountId: row.primary_account_id,
        };
        map.set(row.hubspot_id as string, link);
      } catch {
        // Unmapped local stage (stage_map stale) — leave this hubspot id
        // unlinked; createDealFromHubSpot will hit the same mapping error
        // and record it, rather than silently dropping the row here.
      }
    }
    return map;
  }

  async loadHubspotIdsByLocalId(table: string, ids: string[]): Promise<Map<string, string>> {
    const clean = [...new Set(ids)];
    const map = new Map<string, string>();
    if (clean.length === 0) return map;
    const { data, error } = await this.service
      .from(table)
      .select("id, hubspot_id")
      .eq("org_id", this.orgId)
      .in("id", clean);
    if (error) throw new Error(`loadHubspotIdsByLocalId(${table}) failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.hubspot_id) map.set(row.id as string, row.hubspot_id as string);
    }
    return map;
  }

  async applyCompanyPatch(entityId: string, patch: HsProps): Promise<void> {
    const update = companyPropsToPatch(patch);
    if (Object.keys(update).length === 0) return;
    const { error } = await this.service
      .from("accounts")
      .update(update)
      .eq("org_id", this.orgId)
      .eq("id", entityId);
    if (error) throw new Error(`applyCompanyPatch failed: ${error.message}`);
  }

  async applyContactPatch(entityId: string, patch: HsProps): Promise<void> {
    const update: Record<string, unknown> = {};
    if ("firstname" in patch || "lastname" in patch) {
      let firstname = "firstname" in patch ? patch.firstname : undefined;
      let lastname = "lastname" in patch ? patch.lastname : undefined;
      if (firstname === undefined || lastname === undefined) {
        const { data } = await this.service
          .from("contacts")
          .select("name")
          .eq("org_id", this.orgId)
          .eq("id", entityId)
          .maybeSingle();
        const current = splitName((data?.name as string | undefined) ?? "");
        firstname = firstname ?? current.firstname;
        lastname = lastname ?? current.lastname;
      }
      update.name = [firstname, lastname].filter(Boolean).join(" ").trim();
    }
    if ("email" in patch) update.email = patch.email;
    if ("phone" in patch) update.phone = patch.phone;
    if ("jobtitle" in patch) update.job_title = patch.jobtitle;
    if (P.isChampion in patch) update.is_champion = patch[P.isChampion] === "true";
    if (Object.keys(update).length === 0) return;
    const { error } = await this.service
      .from("contacts")
      .update(update)
      .eq("org_id", this.orgId)
      .eq("id", entityId);
    if (error) throw new Error(`applyContactPatch failed: ${error.message}`);
  }

  async applyDealPatch(
    entityId: string,
    patch: DealPatch,
    review: ReviewAction | null,
  ): Promise<void> {
    const { error } = await this.service.rpc("hubspot_apply_deal", {
      p_org_id: this.orgId,
      p_opportunity_id: entityId,
      p_patch: patch,
      p_review_action: review,
    });
    if (error) throw new Error(`applyDealPatch failed: ${error.message}`);
  }

  async createDealFromHubSpot(record: HsRecord, cfg: HubSpotOrgConfig): Promise<void> {
    // v1 resolves the owning company through the deal's primary-company
    // association (HubSpot's legacy `associatedcompanyid` property, always
    // populated for the primary company — see run-sync.ts's inbound deal
    // properties list). No association, or no local account carrying that
    // company's hubspot_id, means the deal can't be placed — surfaced as an
    // error row for an admin to link by hand, never silently dropped.
    const companyHsId = record.props.associatedcompanyid;
    if (!companyHsId) {
      await this.recordError(
        "inbound",
        "opportunity",
        null,
        record.id,
        record.props,
        "unlinked deal from HubSpot has no associated company — cannot resolve owner/territory",
      );
      return;
    }

    const { data: account, error: accountErr } = await this.service
      .from("accounts")
      .select("id, owner_id, territory_id")
      .eq("org_id", this.orgId)
      .eq("hubspot_id", companyHsId)
      .maybeSingle();
    if (accountErr) throw new Error(`createDealFromHubSpot account lookup failed: ${accountErr.message}`);
    if (!account) {
      await this.recordError(
        "inbound",
        "opportunity",
        null,
        record.id,
        record.props,
        `no local account linked to HubSpot company ${companyHsId}`,
      );
      return;
    }

    let patch: DealPatch;
    try {
      patch = dealPropsToPatch(record.props, cfg);
    } catch (err) {
      await this.recordError(
        "inbound",
        "opportunity",
        null,
        record.id,
        record.props,
        err instanceof Error ? err.message : String(err),
      );
      return;
    }

    const opportunityId = crypto.randomUUID();
    const now = new Date();
    const { error: rpcErr } = await this.service.rpc("create_opportunity_with_action", {
      p_opportunity: {
        id: opportunityId,
        org_id: this.orgId,
        name: patch.name ?? "Deal from HubSpot",
        primary_account_id: account.id,
        territory_id: account.territory_id,
        owner_id: account.owner_id,
        stage: patch.stage,
        current_status: patch.current_status ?? "Created in HubSpot",
        current_blocker: patch.current_blocker ?? null,
        estimated_revenue: patch.estimated_revenue ?? null,
        expected_close_date: patch.expected_close_date ?? null,
        lead_source: "OTHER",
        source_detail: "Created in HubSpot",
      },
      p_next_action: {
        id: crypto.randomUUID(),
        org_id: this.orgId,
        action: "Review deal — created in HubSpot",
        owner_id: account.owner_id,
        due_date: addDaysIso(now, 2),
        account_id: account.id,
        opportunity_id: opportunityId,
      },
    });
    if (rpcErr) throw new Error(`createDealFromHubSpot create failed: ${rpcErr.message}`);

    await this.linkHubspotId("opportunities", opportunityId, record.id);
    // What's now true in HubSpot for this deal is exactly record.props (minus
    // associatedcompanyid, which isn't part of the outbound prop space) — use
    // it as the snapshot baseline so the next outbound pass sees it as an
    // echo, not a fresh backfill-adopted patch.
    const snapshotProps: HsProps = { ...record.props };
    delete snapshotProps.associatedcompanyid;
    await this.saveSnapshot("opportunity", {
      entityId: opportunityId,
      hubspotId: record.id,
      props: snapshotProps,
    });
  }

  async recordError(
    direction: "outbound" | "inbound",
    entityType: string,
    entityId: string | null,
    hubspotId: string | null,
    payload: unknown,
    error: string,
  ): Promise<void> {
    const { error: dbErr } = await this.service.from("hubspot_sync_errors").insert({
      org_id: this.orgId,
      direction,
      entity_type: entityType,
      entity_id: entityId,
      hubspot_id: hubspotId,
      payload: payload ?? {},
      error,
    });
    // recordError is itself the last line of defense (D62) — if the error
    // log write fails there is no higher catch to hand it to, so log and
    // move on rather than aborting the pass over a logging failure.
    if (dbErr) {
      console.error(`hubspot recordError insert failed: ${dbErr.message}`, { direction, entityType, entityId, hubspotId, error });
    }
  }
}
