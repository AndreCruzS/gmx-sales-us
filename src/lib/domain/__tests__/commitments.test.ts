import { describe, expect, it } from "vitest";
import {
  endOf,
  formatTime,
  isAgendaKind,
  normalizeTime,
  slotKey,
  timeOrder,
  timedFields,
} from "@/lib/domain/commitments";

describe("timed commitments", () => {
  it("reads a time in its forms, and refuses what is not one", () => {
    expect(normalizeTime("9:05")).toBe("09:05");
    expect(normalizeTime("14:00:00")).toBe("14:00");
    expect(normalizeTime("24:00")).toBeNull();
    expect(normalizeTime("")).toBeNull();
  });

  it("writes it the American way", () => {
    expect(formatTime("14:00")).toBe("2:00 PM");
    expect(formatTime("00:30")).toBe("12:30 AM");
    expect(formatTime("12:15:00")).toBe("12:15 PM");
  });

  it("ends a slot on the clock, across midnight when it must", () => {
    expect(endOf("2026-11-04", "10:00", 60)).toEqual({ date: "2026-11-04", time: "11:00" });
    expect(endOf("2026-11-04", "23:45", 30)).toEqual({ date: "2026-11-05", time: "00:15" });
  });

  it("puts visits, calls and meetings on the agenda, and chores off it", () => {
    expect(isAgendaKind("CALL")).toBe(true);
    expect(isAgendaKind(null)).toBe(true);
    expect(isAgendaKind("SAMPLE_FOLLOW_UP")).toBe(false);
  });

  it("orders a day timed first, by clock", () => {
    expect(["11:00", null, "09:00"].sort(timeOrder)).toEqual(["09:00", "11:00", null]);
  });

  it("carries all three fields or none", () => {
    expect(timedFields("9:00", "CALL", "America/Chicago")).toEqual({
      due_time: "09:00",
      time_zone: "America/Chicago",
      duration_minutes: 30,
    });
    expect(timedFields(null, "VISIT", "America/Chicago")).toEqual({});
    expect(slotKey("09:00", "America/Chicago", 30)).toBe("09:00@America/Chicago/30");
  });
});
