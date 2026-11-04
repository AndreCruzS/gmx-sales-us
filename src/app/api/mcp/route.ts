import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyAgentToken } from "@/lib/mcp/context";
import { SERVER_INSTRUCTIONS } from "@/lib/mcp/guide";
import { configuredOrigin } from "@/lib/mcp/metadata";
import { buildMcpServer } from "@/lib/mcp/server";

export const maxDuration = 60;

// mcp-handler 2.x has no basePath: the handler serves whatever route mounts it,
// so this file's location is what makes the endpoint exactly /api/mcp.
const mcp = createMcpHandler((server) => buildMcpServer(server), {
  instructions: SERVER_INSTRUCTIONS,
  serverInfo: { name: "gmx-sales", version: "1.0.0" },
});

const handler = withMcpAuth(mcp, verifyAgentToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource/api/mcp",
  resourceUrl: configuredOrigin(),
});

export { handler as GET, handler as POST, handler as DELETE };
