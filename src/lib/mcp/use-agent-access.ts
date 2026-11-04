"use client";

// Whether this person may connect an AI agent. The allow-list is server-only,
// so the nav and the Home card ask /api/agent-access once and remember the
// answer (in memory, and in sessionStorage so a reload does not flash). The
// answer is stored WITH the email it belongs to — a different person signing
// in on the same tab never inherits it.

import { useEffect, useState } from "react";

const KEY = "gmx.agentAccess";
type Memo = { email: string; allowed: boolean };
let memo: Memo | null = null;
let inflight: Promise<boolean> | null = null;

function readSession(email: string): boolean | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Memo | null;
    return v && v.email === email ? v.allowed : null;
  } catch {
    return null;
  }
}

async function load(email: string): Promise<boolean> {
  if (memo?.email === email) return memo.allowed;
  const stored = readSession(email);
  if (stored !== null) {
    memo = { email, allowed: stored };
    return stored;
  }
  inflight ??= fetch("/api/agent-access", { credentials: "same-origin" })
    .then(async (r) => (r.ok ? ((await r.json()) as { allowed?: boolean }).allowed === true : false))
    .catch(() => false)
    .finally(() => {
      inflight = null;
    });
  const allowed = await inflight;
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
  useEffect(() => {
    if (!email) return;
    let live = true;
    void load(email).then((allowed) => {
      if (live) setState({ email, allowed });
    });
    return () => {
      live = false;
    };
  }, [email]);
  return email && state?.email === email ? state.allowed : null;
}
