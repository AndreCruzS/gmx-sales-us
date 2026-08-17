import { describe, expect, it } from "vitest";
import { avatarLetter, displayAccountName } from "../format";

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
