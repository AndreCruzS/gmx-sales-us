// HubSpot integration port. Same philosophy as src/lib/email and
// src/lib/calendar: the sync core knows this interface, never the HubSpot
// SDK/REST client directly — so mapping and reconciliation are provable with
// fixtures before a single API token exists.

export type HsObjectType =
  | "companies" | "contacts" | "deals"
  | "notes" | "meetings" | "calls" | "tasks";

export type HsProps = Record<string, string | null>;

export interface HsRecord {
  id: string;
  props: HsProps;
  lastModifiedAt: string; // ms-epoch string from hs_lastmodifieddate
}

export interface HsFilter {
  propertyName: string;
  operator: "EQ" | "GT";
  value: string;
}

export interface HubSpotPort {
  batchCreate(type: HsObjectType, inputs: { props: HsProps }[]): Promise<HsRecord[]>;
  batchUpdate(type: HsObjectType, inputs: { id: string; props: HsProps }[]): Promise<HsRecord[]>;
  searchModifiedSince(
    type: HsObjectType,
    sinceMs: string,
    extraFilters: HsFilter[],
    properties: string[],
    after?: string,
  ): Promise<{ results: HsRecord[]; after: string | null }>;
  /** v4 default association — no hardcoded association type ids. */
  associateDefault(
    fromType: HsObjectType, fromId: string,
    toType: HsObjectType, toId: string,
  ): Promise<void>;
  listOwners(): Promise<{ id: string; email: string }[]>;
  ensureProperty(objectType: "companies" | "contacts" | "deals", def: HsPropertyDef): Promise<void>;
  ensureDealPipeline(label: string, stageLabels: string[]): Promise<{
    pipelineId: string;
    stageIds: Record<string, string>; // stage label → HubSpot stage id
  }>;
}

export interface HsPropertyDef {
  name: string;
  label: string;
  type: "string" | "bool" | "enumeration";
  fieldType: "text" | "booleancheckbox" | "select";
  groupName: string;
  options?: { label: string; value: string }[];
}

export interface HubSpotOrgConfig {
  pipeline_id: string;
  stage_map: Record<string, string>;   // our stage enum → HubSpot stage id
  owner_map: Record<string, string>;   // membership_id → hubspot_owner_id
}
