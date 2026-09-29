import { describe, expect, it } from "vitest";
import { avatarLetter, displayAccountName, displayDealerLabel } from "../format";

describe("avatarLetter", () => {
  it("is one letter, not the first two characters", () => {
    // The bug Andre spotted: "BI" for Bianca is a word fragment, not a monogram.
    expect(avatarLetter("Bianca Admin")).toBe("B");
    expect(avatarLetter("Joao Manager")).toBe("J");
    expect(avatarLetter("Deonn Deford")).toBe("D");
  });

  it("skips whatever is not a letter", () => {
    // A name that arrives quoted or bracketed should still show the letter a
    // reader expects, not the punctuation in front of it.
    expect(avatarLetter('  "Anthony Peca"')).toBe("A");
    expect(avatarLetter("(TJ)")).toBe("T");
  });

  it("takes a whole code point, never half a surrogate pair", () => {
    // name[0] here returns a lone surrogate and renders as a replacement glyph.
    // A person's own name is the worst place in the app for that.
    expect(avatarLetter("\u{1D49C}lvaro")).toBe("\u{1D49C}");
  });

  it("uppercases accents rather than dropping them", () => {
    expect(avatarLetter("álvaro")).toBe("Á");
  });

  it("has an answer for a name that is not one", () => {
    expect(avatarLetter("")).toBe("?");
    expect(avatarLetter("   ")).toBe("?");
    expect(avatarLetter("—")).toBe("?");
  });
});

describe("displayAccountName", () => {
  // Kept beside avatarLetter deliberately: they are the two places a company or a
  // person's name is reshaped for reading, and a change to one usually wants a
  // look at the other.
  it("softens a shouted name without touching a normal one", () => {
    expect(displayAccountName("GANAHL LUMBER - ANAHEIM")).toBe(
      "Ganahl Lumber - Anaheim",
    );
    expect(displayAccountName("Ganahl Anaheim")).toBe("Ganahl Anaheim");
  });
});

// Bianca's own wording, from the matching sheet of 2026-09-28: the names read
// plainly on screen and the distributor's codes stay in the machine.
describe("displayDealerLabel", () => {
  it("drops the distributor's customer code", () => {
    expect(displayDealerLabel("LEEROJDA - LEE ROY JORDAN REDWOOD LUMBER")).toBe(
      "Lee Roy Jordan Redwood Lumber",
    );
    expect(displayDealerLabel("THRBUSCO - MAXIMUS BUILDING SUPPLY")).toBe(
      "Maximus Building Supply",
    );
  });

  it("spells out the trade's abbreviations", () => {
    expect(displayDealerLabel("CASJOLLO - CASSITY JONES LBR & BLDG MTLS")).toBe(
      "Cassity Jones Lumber & Building Materials",
    );
  });

  it("keeps what is said as letters in capitals", () => {
    expect(displayDealerLabel("OPEN4553 - OPEN ENCLOSE, LLC")).toBe("Open Enclose, LLC");
    expect(displayDealerLabel("LKLASWJ - LKL ASSOCIATES INC")).toBe("LKL Associates Inc");
  });

  it("capitalises both sides of a hyphen", () => {
    expect(displayDealerLabel("OWEADCA - OWEN-ADAMS INC")).toBe("Owen-Adams Inc");
  });

  it("keeps a one-word company that is not a code", () => {
    // Russin writes "COMPANY - YARD"; Tague is the company, not a code
    expect(displayDealerLabel("TAGUE - PHILADELPHIA")).toBe("Tague - Philadelphia");
  });

  it("keeps a yard that is part of the name", () => {
    expect(displayDealerLabel("INTERSTATE & LAKELAND LUMBER - NEWTOWN")).toBe(
      "Interstate & Lakeland Lumber - Newtown",
    );
  });

  it("leaves a name somebody already cased alone", () => {
    expect(displayDealerLabel("Ganahl Lumber")).toBe("Ganahl Lumber");
  });

  // The four the round-2 sheet caught, read back off Bianca's own list.
  it("capitalises both sides of a slash", () => {
    expect(displayDealerLabel("CONCORD/LITTLETON - LITTLETON")).toBe(
      "Concord/Littleton - Littleton",
    );
  });

  it("keeps a person's initials in capitals", () => {
    expect(displayDealerLabel("C.A. NIECE CO INC - LAMBERTVILLE")).toBe(
      "C.A. Niece Co Inc - Lambertville",
    );
  });

  it("keeps a company said as letters in capitals", () => {
    expect(displayDealerLabel("ABCSUBE - ABC SUPPLY COMPANY INC")).toBe(
      "ABC Supply Company Inc",
    );
    expect(displayDealerLabel("PAC3201 - JBI LLC")).toBe("JBI LLC");
  });

  it("does not shout a joining word", () => {
    expect(displayDealerLabel("INTE8391 - INTEGRO WINDOWS AND DOORS LLC")).toBe(
      "Integro Windows and Doors LLC",
    );
  });

  it("drops the conjunction a truncated column left hanging", () => {
    expect(displayDealerLabel("CAS3100 - CASTLE ROCK DOORS MOULDINGS &")).toBe(
      "Castle Rock Doors Mouldings",
    );
  });
});
