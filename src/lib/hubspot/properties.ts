// The single source for every custom property name and definition HubSpot
// needs to provision (ensureProperty, task 8+). Enum-ish fields stay plain
// string/text in v1 — our own enum tables remain authoritative; HubSpot just
// mirrors the value for filtering/reporting. Boolean-shaped fields (mappers
// only ever emit "true"/"false" for these) get bool/booleancheckbox, which
// is what HubSpot expects a checkbox property's stored value to look like.

import type { HsPropertyDef } from "./port";

export const P = {
  managed: "maximo_managed",
  accountType: "maximo_account_type",
  leadSource: "maximo_lead_source",
  displayWall: "maximo_display_wall",
  isChampion: "maximo_is_champion",
  currentStatus: "maximo_current_status",
  currentBlocker: "maximo_current_blocker",
} as const;

export const COMPANY_PROPERTY_DEFS: HsPropertyDef[] = [
  {
    name: P.managed,
    label: "Managed by MAXIMO app",
    type: "bool",
    fieldType: "booleancheckbox",
    groupName: "companyinformation",
  },
  {
    name: P.accountType,
    label: "Account type (MAXIMO)",
    type: "string",
    fieldType: "text",
    groupName: "companyinformation",
  },
  {
    name: P.leadSource,
    label: "Lead source (MAXIMO)",
    type: "string",
    fieldType: "text",
    groupName: "companyinformation",
  },
  {
    name: P.displayWall,
    label: "Has display wall (MAXIMO)",
    type: "bool",
    fieldType: "booleancheckbox",
    groupName: "companyinformation",
  },
];

export const CONTACT_PROPERTY_DEFS: HsPropertyDef[] = [
  {
    name: P.managed,
    label: "Managed by MAXIMO app",
    type: "bool",
    fieldType: "booleancheckbox",
    groupName: "contactinformation",
  },
  {
    name: P.isChampion,
    label: "Is champion (MAXIMO)",
    type: "bool",
    fieldType: "booleancheckbox",
    groupName: "contactinformation",
  },
];

export const DEAL_PROPERTY_DEFS: HsPropertyDef[] = [
  {
    name: P.managed,
    label: "Managed by MAXIMO app",
    type: "bool",
    fieldType: "booleancheckbox",
    groupName: "dealinformation",
  },
  {
    name: P.currentStatus,
    label: "Current status (MAXIMO)",
    type: "string",
    fieldType: "text",
    groupName: "dealinformation",
  },
  {
    name: P.currentBlocker,
    label: "Current blocker (MAXIMO)",
    type: "string",
    fieldType: "text",
    groupName: "dealinformation",
  },
  {
    name: P.leadSource,
    label: "Lead source (MAXIMO)",
    type: "string",
    fieldType: "text",
    groupName: "dealinformation",
  },
];
