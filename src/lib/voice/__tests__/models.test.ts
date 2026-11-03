import { describe, expect, it } from "vitest";
import { TRANSCRIBE_MODEL, transcribePrompt } from "@/lib/voice/models";

describe("TRANSCRIBE_MODEL", () => {
  it("is off the model OpenAI retires on 2027-02-26", () => {
    if (process.env.VOICE_TRANSCRIBE_MODEL) return; // an environment may pin its own
    expect(TRANSCRIBE_MODEL).toBe("openai/gpt-transcribe");
  });
});

describe("transcribePrompt", () => {
  it("names the people by first name only, and the GMX words", () => {
    const p = transcribePrompt(["João Silva", "Bianca Admin"]);
    expect(p).toContain("Names: João, Bianca.");
    expect(p).not.toContain("Silva");
    expect(p).toContain("Maximo");
    expect(p).toContain("PK (product knowledge training)");
  });
  it("keeps one copy of a name said twice and skips blanks", () => {
    const p = transcribePrompt(["Deon", "Deon", "  "]);
    expect(p.match(/Deon/g)).toHaveLength(1);
  });
  it("still carries the GMX words with no names", () => {
    const p = transcribePrompt([]);
    expect(p).not.toContain("Names:");
    expect(p).toContain("Terms: GMX");
  });
});
