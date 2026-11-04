// Pure helpers for the AI connector guide (settings page + Home card).

export const DISMISS_KEY = "gmx.aiConnectorCard.dismissed";

/** The connector address: the configured public origin, else the request's. */
export function connectorAddress(configured: string | undefined, requestOrigin: string): string {
  const o = (configured?.trim() || requestOrigin).replace(/\/+$/, "");
  return `${o}/api/mcp`;
}

/** The origin a request arrived at, honouring the proxy headers Vercel sets. */
export function originFromHeaders(get: (name: string) => string | null): string {
  const host = (get("x-forwarded-host") ?? get("host") ?? "localhost").split(",")[0].trim();
  const proto =
    get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** Home card: only for allowed people who have not connected and not said "Not now". */
export function shouldShowConnectorCard(s: {
  allowed: boolean;
  hasAgentActions: boolean;
  dismissed: boolean;
}): boolean {
  return s.allowed && !s.hasAgentActions && !s.dismissed;
}
