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
