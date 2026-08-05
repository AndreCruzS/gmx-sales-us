// Locks in the property-def shapes so a boolean-shaped property (mappers
// only ever emit "true"/"false") can't silently drift back to string/text —
// that mismatch only bites later, when a real property gets provisioned in
// HubSpot from these defs.

import { describe, expect, it } from "vitest";
import type { HsPropertyDef } from "../port";
import {
  COMPANY_PROPERTY_DEFS,
  CONTACT_PROPERTY_DEFS,
  DEAL_PROPERTY_DEFS,
  P,
} from "../properties";

const BOOLEAN_PROPS = new Set<string>([P.managed, P.displayWall, P.isChampion]);

function shapeOf(def: HsPropertyDef) {
  return { type: def.type, fieldType: def.fieldType };
}

describe("property def shapes", () => {
  const allDefs = [
    ...COMPANY_PROPERTY_DEFS,
    ...CONTACT_PROPERTY_DEFS,
    ...DEAL_PROPERTY_DEFS,
  ];

  it("gives every boolean-shaped property bool/booleancheckbox", () => {
    for (const def of allDefs) {
      if (BOOLEAN_PROPS.has(def.name)) {
        expect(shapeOf(def)).toEqual({ type: "bool", fieldType: "booleancheckbox" });
      }
    }
  });

  it("gives every non-boolean (enum-ish) property string/text", () => {
    for (const def of allDefs) {
      if (!BOOLEAN_PROPS.has(def.name)) {
        expect(shapeOf(def)).toEqual({ type: "string", fieldType: "text" });
      }
    }
  });

  it("has at least one def for every custom property in P", () => {
    const declaredNames = new Set(allDefs.map((d) => d.name));
    for (const name of Object.values(P)) {
      expect(declaredNames.has(name)).toBe(true);
    }
  });

  it("groups companies/contacts/deals defs into the right property group", () => {
    for (const def of COMPANY_PROPERTY_DEFS) {
      expect(def.groupName).toBe("companyinformation");
    }
    for (const def of CONTACT_PROPERTY_DEFS) {
      expect(def.groupName).toBe("contactinformation");
    }
    for (const def of DEAL_PROPERTY_DEFS) {
      expect(def.groupName).toBe("dealinformation");
    }
  });
});
