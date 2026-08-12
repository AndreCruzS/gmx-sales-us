// The exception vocabulary is shared by the rep's day (/visits), the account
// list and the manager's dashboard. The point of centralising it was that the
// same condition cannot be called two names on two screens, so that is what
// these tests hold: every type the SQL union can emit has a word, and the words
// are the business's rather than the column's.

import { describe, expect, it } from "vitest";
import {
  ACCOUNT_EXCEPTION_TYPES,
  DANGER_EXCEPTIONS,
  EXCEPTION_LABEL,
  exceptionLabel,
  exceptionShort,
} from "@/lib/domain/exceptions";

// Mirrors the `exceptions` view in 20260722001500_agenda_exceptions.sql. If a
// migration adds a twelfth branch to that union, this list is where the app is
// reminded to name it.
const UNION_TYPES = [
  "OPPORTUNITY_NO_NEXT_ACTION",
  "OVERDUE_FOLLOW_UP",
  "QUOTE_NO_FOLLOW_UP",
  "STRATEGIC_ACCOUNT_QUIET",
  "OPPORTUNITY_STALE",
  "PROJECT_NO_DEALER",
  "CONTRACTOR_RELATIONSHIP_STALE",
  "NEW_ACCOUNT_NO_FOLLOW_UP",
  "NEXT_WEEK_NOT_PLANNED",
  "NO_CHAMPION",
  "DISPLAY_NOT_VERIFIED",
];

describe("exception vocabulary", () => {
  it("names every type the SQL union can emit", () => {
    for (const type of UNION_TYPES) {
      expect(EXCEPTION_LABEL[type], `${type} has no label`).toBeTruthy();
    }
  });

  it("speaks the business's language, not the column's", () => {
    // The generic humanizer would say "No champion" and "Display not verified".
    expect(exceptionLabel("NO_CHAMPION")).toBe("No captain");
    expect(exceptionShort("NO_CHAMPION")).toBe("No captain");
    expect(exceptionLabel("DISPLAY_NOT_VERIFIED")).toBe(
      "Display wall not verified",
    );
  });

  it("falls back to a readable form rather than inventing a name", () => {
    expect(exceptionLabel("SOME_NEW_RULE")).toBe("some new rule");
    // The chip form defers to the sentence form when it has no short word.
    expect(exceptionShort("SOME_NEW_RULE")).toBe("some new rule");
  });

  it("keeps the danger tier to broken promises and money on the table", () => {
    expect(DANGER_EXCEPTIONS.has("OVERDUE_FOLLOW_UP")).toBe(true);
    expect(DANGER_EXCEPTIONS.has("QUOTE_NO_FOLLOW_UP")).toBe(true);
    // Hygiene the system noticed is attention, not danger — otherwise every
    // row is red and a rep learns to ignore all of them.
    expect(DANGER_EXCEPTIONS.has("NO_CHAMPION")).toBe(false);
    expect(DANGER_EXCEPTIONS.has("DISPLAY_NOT_VERIFIED")).toBe(false);
  });

  it("only lists account-shaped exceptions for the account list", () => {
    for (const type of ACCOUNT_EXCEPTION_TYPES) {
      expect(UNION_TYPES).toContain(type);
    }
    // These hang off an opportunity or an agenda, so they would be a filter
    // that can never match an account row.
    expect(ACCOUNT_EXCEPTION_TYPES).not.toContain("OPPORTUNITY_STALE");
    expect(ACCOUNT_EXCEPTION_TYPES).not.toContain("NEXT_WEEK_NOT_PLANNED");
  });
});
