import type { McpServer } from "@modelcontextprotocol/server";
import { AgentAuthError } from "./auth";
import { contextFrom, type AgentContext } from "./context";
import { fail, type CallToolResult } from "./result";
import { registerAgendaTools } from "./tools/agenda";
import { registerDiscoveryTools } from "./tools/discovery";

/** What the SDK hands a tool callback; only the bit we read. */
export type ToolExtra = { http?: { authInfo?: Parameters<typeof contextFrom>[0] } };
export type GetCtx = (extra: ToolExtra) => Promise<AgentContext>;

export const getCtx: GetCtx = async (extra) => {
  const info = extra.http?.authInfo;
  if (!info) throw new AgentAuthError("Not signed in — reconnect the agent.");
  return contextFrom(info);
};

/** Wrap a tool body so no error ever reaches the agent as a stack trace. */
export function tool<A>(
  getContext: GetCtx,
  handler: (ctx: AgentContext, args: A) => Promise<CallToolResult>,
) {
  return async (args: A, extra: ToolExtra): Promise<CallToolResult> => {
    try {
      return await handler(await getContext(extra), args);
    } catch (e) {
      if (e instanceof AgentAuthError) return fail(e.message);
      console.error("[mcp] tool failed:", e);
      return fail("Something went wrong on GMX Sales — try again.");
    }
  };
}

export function buildMcpServer(server: McpServer, getContext: GetCtx = getCtx) {
  registerDiscoveryTools(server, getContext);
  registerAgendaTools(server, getContext);
}
