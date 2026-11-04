export type AgentSource = "claude" | "muse";

export function agentSourceOf(
  clientId: string | undefined,
  museClientId: string | undefined = process.env.MCP_MUSE_CLIENT_ID,
): AgentSource {
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
