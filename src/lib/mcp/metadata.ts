import { generateProtectedResourceMetadata, getPublicOrigin } from "mcp-handler";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

/** The MCP endpoint URL: the configured public origin, else the request's. */
export function mcpResourceUrl(req: Request): string {
  const origin = process.env.MCP_PUBLIC_ORIGIN || getPublicOrigin(req);
  return `${origin.replace(/\/$/, "")}/api/mcp`;
}

export function protectedResourceMetadata(req: Request): Response {
  const body = generateProtectedResourceMetadata({
    authServerUrls: [`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`],
    resourceUrl: mcpResourceUrl(req),
  });
  return new Response(JSON.stringify(body), {
    headers: { ...CORS, "Cache-Control": "max-age=3600", "Content-Type": "application/json" },
  });
}

export function metadataOptions(): Response {
  return new Response(null, { status: 200, headers: CORS });
}
