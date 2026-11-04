import { draftedQuadrant } from "@/lib/domain/eisenhower";
import { alertDate, DEFAULT_DAYS, daysFrom, type Priority, type Progress } from "@/lib/domain/pk-follow-up";

export interface PkFollowUpInput {
  action: string;
  urgent: boolean;
  important: boolean;
  reason: string;
  asked_by_dealer: boolean;
  due_date?: string;
  progress?: Progress;
  owner_id?: string;
  subtasks?: string[];
  note?: string;
}

export type PkRowPlan =
  | { save: true; priority: Exclude<Priority, "ELIMINATE">; priority_days: number; due_date: string; reason: string }
  | { save: false; reason: string };

/** The same rule as Say it's debrief sheet: the matrix picks the priority, a said date (or the default days) the alert. */
export function planPkFollowUp(pkDate: string, f: PkFollowUpInput): PkRowPlan {
  const q = draftedQuadrant(f.urgent, f.important, f.asked_by_dealer);
  if (q === null || q === "ELIMINATE") return { save: false, reason: f.reason };
  const days = f.due_date ? Math.max(0, daysFrom(pkDate, f.due_date)) : (DEFAULT_DAYS[q] as number);
  return { save: true, priority: q, priority_days: days, due_date: alertDate(pkDate, days), reason: f.reason };
}
