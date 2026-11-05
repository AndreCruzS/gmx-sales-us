export type AgentSource = "claude" | "muse";

let warnedNoMuse = false;

export function agentSourceOf(
  clientId: string | undefined,
  museClientId: string | undefined = process.env.MCP_MUSE_CLIENT_ID,
): AgentSource {
  if (!museClientId && !warnedNoMuse) {
    warnedNoMuse = true;
    console.warn("[mcp] MCP_MUSE_CLIENT_ID is not set: every agent will be recorded as Claude.");
  }
  return clientId && museClientId && clientId === museClientId ? "muse" : "claude";
}

export function isAllowedEmail(
  email: string | undefined,
  list: string | undefined = process.env.MCP_ALLOWED_EMAILS,
): boolean {
  const e = email?.trim().toLowerCase();
  if (!e || !list) return false;
  return list
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .includes(e);
}

/** Structural twin of the MCP SDK AuthInfo (the SDK lands in a later task). */
export interface AuthInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  extra?: Record<string, unknown>;
}

/** Thrown with a message that is safe to show the user. */
export class AgentAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentAuthError";
  }
}

/**
 * Where a sign-in may return the person. Clients register themselves (dynamic
 * client registration), so a client's NAME proves nothing: anyone can register
 * "Claude" with their own redirect address. Only these hosts are offered the
 * Allow button.
 */
// agent.meta.ai: Muse's real callback, seen when Bianca's Muse registered in
// prod on 2026-11-05 (https://agent.meta.ai/api/hatch/oauth/callback).
export const KNOWN_AGENT_HOSTS = [
  "claude.ai",
  "claude.com",
  "muse.ai",
  "platform.muse.ai",
  "agent.meta.ai",
] as const;
export const LOCAL_AGENT_HOSTS = ["localhost", "127.0.0.1"] as const;

/** The host of a redirect address when it is a known agent's, else null. */
export function knownAgentHost(uri: string | null | undefined): string | null {
  if (!uri) return null;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if ((KNOWN_AGENT_HOSTS as readonly string[]).includes(host)) return u.protocol === "https:" ? host : null;
  if ((LOCAL_AGENT_HOSTS as readonly string[]).includes(host)) return u.protocol === "http:" || u.protocol === "https:" ? host : null;
  return null;
}

export function isKnownAgentRedirect(uri: string | null | undefined): boolean {
  return knownAgentHost(uri) !== null;
}
