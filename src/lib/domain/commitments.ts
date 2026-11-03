// TIMED COMMITMENTS (spec 2026-11-04): what goes on the agenda, and at what
// time. A visit may have a time; a call or a meeting always has one — said
// without a time, it is a to-do and lives on the routine list instead.
//
// The time is wall-clock in the zone it was said in (the device's), so a
// Riverside rep's 10:00 is 10:00 Pacific on the desk's calendar in Boise.
// Pure: no clock is read here except where a function says so.

export const AGENDA_KINDS = ["VISIT", "CALL", "MEETING"] as const;
export type AgendaKind = (typeof AGENDA_KINDS)[number];

/** PostgREST filter for the agenda: its kinds, and rows not yet classified. */
export const AGENDA_KIND_FILTER = "kind.in.(VISIT,CALL,MEETING),kind.is.null";

/** On the agenda: a visit, a call or a meeting — or a row not yet classified. */
export function isAgendaKind(kind: string | null | undefined): boolean {
  return kind === null || kind === undefined || (AGENDA_KINDS as readonly string[]).includes(kind);
}

export const KIND_LABEL: Record<AgendaKind, string> = {
  VISIT: "Visit",
  CALL: "Call",
  MEETING: "Meeting",
};

/** How long, when nobody said. */
export const DEFAULT_MINUTES: Record<AgendaKind, number> = {
  VISIT: 60,
  CALL: 30,
  MEETING: 60,
};

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

/** "9:05", "09:05", "09:05:00" → "09:05"; anything else → null. */
export function normalizeTime(s: string | null | undefined): string | null {
  const m = s ? HHMM.exec(s.trim()) : null;
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** "14:00" → "2:00 PM"; "09:30" → "9:30 AM". */
export function formatTime(t: string | null | undefined): string {
  const n = normalizeTime(t);
  if (!n) return "";
  const [h, m] = n.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** The end, as a wall-clock date and time in the same zone (may cross midnight). */
export function endOf(date: string, time: string, minutes: number): { date: string; time: string } {
  const n = normalizeTime(time) ?? "00:00";
  const [y, mo, d] = date.split("-").map(Number);
  const [h, m] = n.split(":").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, m + minutes));
  return {
    date: t.toISOString().slice(0, 10),
    time: t.toISOString().slice(11, 16),
  };
}

/** The device's IANA zone. Reads the environment, not the clock. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";
  } catch {
    return "America/Los_Angeles";
  }
}

/** Sort key inside a day: timed first by clock, all-day after. */
export function timeOrder(a: string | null | undefined, b: string | null | undefined): number {
  const x = normalizeTime(a);
  const y = normalizeTime(b);
  if (x && y) return x.localeCompare(y);
  if (x) return -1;
  if (y) return 1;
  return 0;
}

/** A slot as the calendar remembers it, to tell a moved clock from a still one. */
export function slotKey(time: string | null | undefined, zone: string | null | undefined, minutes: number): string {
  const n = normalizeTime(time);
  return n && zone ? `${n}@${zone}/${minutes}` : "";
}

/**
 * The fields a create payload carries for a time: all three or none.
 * `kind` picks the default length when none was said.
 */
export function timedFields(
  time: string | null | undefined,
  kind: AgendaKind,
  zone: string = deviceTimeZone(),
): { due_time: string; time_zone: string; duration_minutes: number } | Record<string, never> {
  const n = normalizeTime(time);
  return n ? { due_time: n, time_zone: zone, duration_minutes: DEFAULT_MINUTES[kind] } : {};
}
