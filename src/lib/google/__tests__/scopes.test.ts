// What each role asks Google for (2026-10-20): reps are asked to let the app
// read their mail, admins never are; a grant made before the ask grew reads
// as unfinished, so the banner asks once more.

import { describe, expect, it } from "vitest";
import {
  CALENDAR_APP_CREATED,
  CALENDAR_EVENTS,
  CALENDAR_FULL,
  GMAIL_READ,
  GMAIL_SEND,
  missingScopes,
  scopesFor,
} from "../scopes";

describe("what each role asks for", () => {
  it("a rep: send, read, and a calendar of the app's own in their account", () => {
    expect([...scopesFor("rep")].sort()).toEqual([CALENDAR_APP_CREATED, GMAIL_READ, GMAIL_SEND].sort());
  });

  it("a rep is no longer asked to reach every event they hold", () => {
    expect(scopesFor("rep")).not.toContain(CALENDAR_EVENTS);
  });

  it("an admin is never asked to have their mail read", () => {
    expect(scopesFor("admin")).not.toContain(GMAIL_READ);
    expect(scopesFor("admin")).toContain(CALENDAR_FULL);
  });
});

describe("a grant against the ask", () => {
  it("a rep connected before 2026-10-20 is missing the read and the agenda", () => {
    expect(missingScopes("rep", [GMAIL_SEND, CALENDAR_EVENTS])).toEqual([GMAIL_READ, CALENDAR_APP_CREATED]);
  });

  it("a whole grant is missing nothing", () => {
    expect(missingScopes("rep", [GMAIL_SEND, GMAIL_READ, CALENDAR_APP_CREATED])).toEqual([]);
    expect(missingScopes("admin", [GMAIL_SEND, CALENDAR_FULL])).toEqual([]);
  });

  it("no grant at all is missing everything", () => {
    expect(missingScopes("rep", null)).toHaveLength(3);
  });
});
