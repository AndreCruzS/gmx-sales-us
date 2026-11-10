import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEADLINE_DAYS,
  addBusinessDays,
  businessDaysUntil,
  deadlineLabel,
  defaultDeadline,
  derivePriority,
  isTask,
  isUrgent,
  localIsoDate,
  storedPriority,
  todayIn,
  urgentCap,
} from "@/lib/domain/deadline";

describe("business days (Mon-Fri, no holidays)", () => {
  it("adds business days, skipping the weekend", () => {
    expect(addBusinessDays("2026-11-10", 2)).toBe("2026-11-12");
    expect(addBusinessDays("2026-11-13", 2)).toBe("2026-11-17");
  });
  it("starting on a weekend, Monday is the first business day", () => {
    expect(addBusinessDays("2026-11-14", 2)).toBe("2026-11-17");
    expect(addBusinessDays("2026-11-15", 2)).toBe("2026-11-17");
  });
  it("counts business days until a date; negative when late", () => {
    expect(businessDaysUntil("2026-11-10", "2026-11-10")).toBe(0);
    expect(businessDaysUntil("2026-11-13", "2026-11-17")).toBe(2);
    expect(businessDaysUntil("2026-11-14", "2026-11-16")).toBe(1);
    expect(businessDaysUntil("2026-11-10", "2026-11-09")).toBe(-1);
    expect(businessDaysUntil("2026-11-17", "2026-11-13")).toBe(-2);
  });
  it("is urgent at two business days or less, or late", () => {
    expect(isUrgent("2026-11-12", "2026-11-10")).toBe(true);
    expect(isUrgent("2026-11-13", "2026-11-10")).toBe(false);
    expect(isUrgent("2026-11-01", "2026-11-10")).toBe(true);
    expect(isUrgent("2026-11-16", "2026-11-14")).toBe(true);
  });
});

describe("urgentCap", () => {
  it("keeps a nearer given date", () => {
    expect(urgentCap("2026-11-11", "2026-11-10")).toBe("2026-11-11");
  });
  it("pulls a far date in to two business days", () => {
    expect(urgentCap("2026-11-30", "2026-11-10")).toBe("2026-11-12");
  });
  it("uses two business days when there is no date", () => {
    expect(urgentCap(null, "2026-11-10")).toBe("2026-11-12");
  });
});

describe("derivePriority", () => {
  const today = "2026-11-10";
  const urgent = "2026-11-11";
  const later = "2026-11-30";
  it("important and urgent is Do now, for anyone", () => {
    expect(derivePriority(true, urgent, today, false)).toBe("DO_NOW");
    expect(derivePriority(true, urgent, today, true)).toBe("DO_NOW");
  });
  it("important and not urgent is Plan", () => {
    expect(derivePriority(true, later, today, false)).toBe("PLAN");
    expect(derivePriority(true, later, today, true)).toBe("PLAN");
  });
  it("urgent and not important is Plan for a rep, Delegate for an admin", () => {
    expect(derivePriority(false, urgent, today, false)).toBe("PLAN");
    expect(derivePriority(false, urgent, today, true)).toBe("DELEGATE");
  });
  it("neither is Eliminate (a suggestion only)", () => {
    expect(derivePriority(false, later, today, false)).toBe("ELIMINATE");
    expect(derivePriority(false, later, today, true)).toBe("ELIMINATE");
  });
  it("has no priority while important is unknown", () => {
    expect(derivePriority(null, urgent, today, false)).toBeNull();
    expect(derivePriority(null, later, today, true)).toBeNull();
  });
});

describe("storedPriority never stores Eliminate", () => {
  const today = "2026-11-10";
  it("turns Eliminate into Plan for a rep and Delegate for an admin", () => {
    expect(storedPriority(false, "2026-11-30", today, false)).toBe("PLAN");
    expect(storedPriority(false, "2026-11-30", today, true)).toBe("DELEGATE");
  });
  it("has no priority while important is unknown", () => {
    expect(storedPriority(null, "2026-11-11", today, false)).toBeNull();
  });
  it("otherwise equals derivePriority", () => {
    for (const important of [true, false]) {
      for (const due of ["2026-11-11", "2026-11-30"]) {
        for (const admin of [false, true]) {
          if (!important && due === "2026-11-30") continue;
          expect(storedPriority(important, due, today, admin)).toBe(
            derivePriority(important, due, today, admin),
          );
        }
      }
    }
  });
});

describe("default deadlines", () => {
  it("has the agreed business days per kind", () => {
    expect(DEFAULT_DEADLINE_DAYS).toEqual({
      QUOTE_FOLLOW_UP: 2,
      SAMPLE_FOLLOW_UP: 3,
      DISPLAY_CHECK: 10,
      PK: 5,
      OTHER: 5,
    });
  });
  it("counts from the given date", () => {
    expect(defaultDeadline("QUOTE_FOLLOW_UP", false, "2026-11-13")).toBe("2026-11-17");
  });
  it("uses the PK value for a PK, whatever the kind", () => {
    expect(defaultDeadline("OTHER", true, "2026-11-02")).toBe("2026-11-09");
    expect(defaultDeadline("QUOTE_FOLLOW_UP", true, "2026-11-02")).toBe("2026-11-09");
  });
  it("treats an unknown or null kind as OTHER", () => {
    expect(defaultDeadline(null, false, "2026-11-02")).toBe("2026-11-09");
    expect(defaultDeadline("WHATEVER", false, "2026-11-02")).toBe("2026-11-09");
  });
});

describe("localIsoDate", () => {
  it("is the local calendar date, not UTC", () => {
    expect(localIsoDate(new Date(2026, 10, 10, 23, 30))).toBe("2026-11-10");
    expect(localIsoDate(new Date(2026, 0, 5, 0, 5))).toBe("2026-01-05");
  });
});

describe("deadlineLabel", () => {
  it("says due today", () => {
    expect(deadlineLabel("2026-11-10", "2026-11-10")).toEqual({ text: "due today", late: false });
  });
  it("counts calendar days ahead", () => {
    expect(deadlineLabel("2026-11-13", "2026-11-10")).toEqual({ text: "due in 3d", late: false });
  });
  it("counts calendar days late", () => {
    expect(deadlineLabel("2026-11-08", "2026-11-10")).toEqual({ text: "2d late", late: true });
  });
});

describe("isTask", () => {
  it("is false for visit, call and meeting", () => {
    expect(isTask("VISIT")).toBe(false);
    expect(isTask("CALL")).toBe(false);
    expect(isTask("MEETING")).toBe(false);
  });
  it("is true for everything else", () => {
    expect(isTask("QUOTE_FOLLOW_UP")).toBe(true);
    expect(isTask(null)).toBe(true);
  });
});

describe("todayIn", () => {
  it("reads the calendar date in the zone, not UTC", () => {
    const at = new Date("2026-11-11T03:30:00Z");
    expect(todayIn("America/Los_Angeles", at)).toBe("2026-11-10");
    expect(todayIn("UTC", at)).toBe("2026-11-11");
  });
});
