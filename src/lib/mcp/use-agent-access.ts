"use client";

// Whether this person may connect an AI agent. The allow-list is server-only,
// so the nav and the Home card ask /api/agent-access once and remember the
// answer (in memory, and in sessionStorage so a reload does not flash). The
// answer is stored WITH the email it belongs to — a different person signing
// in on the same tab never inherits it.

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const KEY = "gmx.agentAccess";
type Memo = { email: string; allowed: boolean };
let memo: Memo | null = null;
let inflight: Promise<boolean | null> | null = null;

function readSession(email: string): boolean | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Memo | null;
    return v && v.email === email ? v.allowed : null;
  } catch {
    return null;
  }
}

export async function load(email: string): Promise<boolean> {
  if (memo?.email === email) return memo.allowed;
  const stored = readSession(email);
  if (stored !== null) {
    memo = { email, allowed: stored };
    return stored;
  }
  // Only a signed-in answer (200) is remembered. A 401 — the login screen
  // asking before the session exists — or a network failure means "not now",
  // not "no": caching it would hide the menu for the rest of the tab even
  // after the person signs in (found 2026-11-04).
  inflight ??= fetch("/api/agent-access", { credentials: "same-origin" })
    .then(async (r) =>
      r.ok ? ((await r.json()) as { allowed?: boolean }).allowed === true : null,
    )
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  const answer = await inflight;
  if (answer === null) return false;
  const allowed = answer;
  memo = { email, allowed };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(memo));
  } catch {
    // private mode — the memory cache still works
  }
  return allowed;
}

/** null while unknown (and when signed out), then true / false. */
export function useAgentAccess(email: string | undefined): boolean | null {
  const [state, setState] = useState<Memo | null>(null);
  // Re-asked on every navigation (cheap once remembered): signing in is a
  // client-side navigation, so a "not yet" from the login screen must clear.
  const pathname = usePathname();
  useEffect(() => {
    if (!email) return;
    let live = true;
    void load(email).then((allowed) => {
      if (live) setState({ email, allowed });
    });
    return () => {
      live = false;
    };
  }, [email, pathname]);
  return email && state?.email === email ? state.allowed : null;
}

/** Test seam: forget what was remembered. */
export function resetAgentAccessForTests(): void {
  memo = null;
  inflight = null;
}
