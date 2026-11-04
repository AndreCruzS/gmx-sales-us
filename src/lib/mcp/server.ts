import type { McpServer } from "@modelcontextprotocol/server";
import { ZodError } from "zod";
import { AgentAuthError } from "./auth";
import { contextFrom, type AgentContext } from "./context";
import { fail, type CallToolResult } from "./result";
import { registerAgendaTools } from "./tools/agenda";
import { registerDiscoveryTools } from "./tools/discovery";
import { registerAccountTools } from "./tools/accounts";
import { registerPkTools } from "./tools/pk";
import { registerUndoTools } from "./tools/undo";
import { registerViewTools } from "./tools/views";

/** What the SDK hands a tool callback; only the bit we read. */
export type ToolExtra = { http?: { authInfo?: Parameters<typeof contextFrom>[0] } };
export type GetCtx = (extra: ToolExtra) => Promise<AgentContext>;

export const getCtx: GetCtx = async (extra) => {
  const info = extra.http?.authInfo;
  if (!info) throw new AgentAuthError("Not signed in — reconnect the agent.");
  return contextFrom(info);
};

export const BAD_DATE =
  "That date or time isn't valid — use ISO 8601 with the UTC offset, e.g. 2026-11-04T18:30:00-08:00.";

export const BAD_ZONE = "That time zone isn't valid — use an IANA name like America/Los_Angeles.";

/** The first problem of a schema check, with the field it is about. */
export function zodMessage(e: ZodError): string {
  const i = e.issues[0];
  const path = i?.path.join(".");
  return `${path ? `${path}: ` : ""}${i?.message ?? "That input isn't valid."}`;
}

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
      if (e instanceof ZodError) return fail(zodMessage(e));
      if (e instanceof RangeError) {
        if (/time zone/i.test(e.message)) return fail(BAD_ZONE);
        if (/invalid (time|date)/i.test(e.message)) return fail(BAD_DATE);
      }
      console.error("[mcp] tool failed:", e);
      return fail("Something went wrong on GMX Sales — try again.");
    }
  };
}

export function buildMcpServer(server: McpServer, getContext: GetCtx = getCtx) {
  registerDiscoveryTools(server, getContext);
  registerAgendaTools(server, getContext);
  registerPkTools(server, getContext);
  registerAccountTools(server, getContext);
  registerViewTools(server, getContext);
  registerUndoTools(server, getContext);
}
