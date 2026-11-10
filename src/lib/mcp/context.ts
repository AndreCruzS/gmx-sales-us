import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import {
  AgentAuthError,
  agentSourceOf,
  type AgentSource,
  type AuthInfo,
} from "./auth";

export interface Me {
  userId: string;
  email: string;
  name: string;
  membershipId: string;
  orgId: string;
  role: "rep" | "manager" | "admin" | "support";
  timeZone: string;
  territory?: string | null;
}

export interface AgentContext {
  db: SupabaseClient<Database>;
  me: Me;
  via: AgentSource;
  sessionId: string;
}

// No time zone column exists anywhere; this is the app's fallback
// (see src/lib/domain/commitments.ts).
const DEFAULT_TIME_ZONE = "America/Los_Angeles";

function env() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  };
}

const authOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

/** A client that acts as the token's owner, so RLS applies to every query. */
export function dbForToken(token: string): SupabaseClient<Database> {
  const { url, anon } = env();
  return createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: authOptions,
  });
}

export async function loadMe(
  db: SupabaseClient<Database>,
  claims: Record<string, unknown>,
): Promise<Me> {
  const noOrg = new AgentAuthError("Your GMX Sales account has no active organisation.");
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  const orgId = typeof claims.org_id === "string" ? claims.org_id : "";
  if (!sub || !orgId) throw noOrg;

  const { data: m } = await db
    .from("memberships")
    .select("id, role, territories(name)")
    .eq("user_id", sub)
    .eq("org_id", orgId)
    .eq("status", "active")
    .maybeSingle();
  if (!m) throw noOrg;

  const { data: u } = await db
    .from("users")
    .select("email, full_name")
    .eq("id", sub)
    .maybeSingle();

  const email = u?.email ?? (typeof claims.email === "string" ? claims.email : "");
  const terr = m.territories as { name: string } | { name: string }[] | null;
  return {
    userId: sub,
    email,
    name: u?.full_name || email,
    membershipId: m.id,
    orgId,
    role: m.role,
    timeZone: DEFAULT_TIME_ZONE,
    territory: (Array.isArray(terr) ? terr[0]?.name : terr?.name) ?? null,
  };
}

/** Validates the bearer (JWKS). Never throws. Membership is checked in loadMe. */
export async function verifyAgentToken(
  _req: Request,
  bearer?: string,
): Promise<AuthInfo | undefined> {
  if (!bearer) return undefined;
  try {
    const { url, anon } = env();
    const { data, error } = await createClient(url, anon, { auth: authOptions }).auth.getClaims(bearer);
    if (error || !data?.claims) return undefined;
    const claims = data.claims as Record<string, unknown>;
    if (claims.role !== "authenticated") return undefined;
    return {
      token: bearer,
      clientId: typeof claims.client_id === "string" ? claims.client_id : "",
      scopes: typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [],
      expiresAt: typeof claims.exp === "number" ? claims.exp : undefined,
      extra: { claims },
    };
  } catch {
    return undefined;
  }
}

export async function contextFrom(authInfo: AuthInfo): Promise<AgentContext> {
  const claims = (authInfo.extra?.claims ?? {}) as Record<string, unknown>;
  const sessionId = claims.session_id ? String(claims.session_id) : "";
  if (!sessionId) throw new AgentAuthError("This sign-in has no session — reconnect the agent.");
  const db = dbForToken(authInfo.token);
  const me = await loadMe(db, claims);
  const clientId = typeof claims.client_id === "string" ? claims.client_id : undefined;
  return { db, me, via: agentSourceOf(clientId), sessionId };
}
