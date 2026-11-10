import { createClient } from "@supabase/supabase-js";
import type { AgentContext } from "../context";

export const IT_URL = "http://127.0.0.1:54341";
// Local-stack demo anon key (public, identical for every `supabase start`).
export const IT_ANON =
  process.env.MCP_IT_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

/** Point the app env at the local stack. Call before importing tool modules. */
export function useLocalStack() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = IT_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = IT_ANON;
  process.env.MCP_CONFIRM_SECRET ??= "integration-test-secret-0123456789abcdef";
}

export async function contextFor(email: string): Promise<AgentContext> {
  const { verifyAgentToken, contextFrom } = await import("../context");
  const { data, error } = await createClient(IT_URL, IT_ANON).auth.signInWithPassword({ email, password: "password123" });
  if (error) throw error;
  const info = await verifyAgentToken(new Request("http://localhost/api/mcp"), data.session!.access_token);
  return contextFrom(info!);
}
