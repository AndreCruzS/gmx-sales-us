// One line per agent call, so a hang names what hung (2026-11-05: ten POSTs
// ran into the 60 s limit and the logs could not say which tool). Only the
// JSON-RPC method and the tool name are logged — never arguments, which carry
// what the person said.

type Rpc = { method?: unknown; params?: { name?: unknown } };

/** "tools/call find", "initialize", "tools/list + notifications/initialized"… */
export function describeRpc(body: unknown): string {
  const msgs = (Array.isArray(body) ? body : [body]) as Rpc[];
  const parts = msgs
    .filter((m) => m && typeof m === "object")
    .map((m) => {
      const method = typeof m.method === "string" ? m.method : "response";
      const name = method === "tools/call" && typeof m.params?.name === "string" ? ` ${m.params.name}` : "";
      return `${method}${name}`.slice(0, 80);
    });
  return parts.length ? parts.join(" + ") : "empty";
}

type Handler = (req: Request) => Promise<Response>;

export function withRequestLog(handler: Handler): Handler {
  return async (req) => {
    const started = Date.now();
    let what = req.method;
    if (req.method === "POST") {
      try {
        what = `POST ${describeRpc(await req.clone().json())}`;
      } catch {
        what = "POST (unreadable body)";
      }
    }
    console.info(`[mcp] -> ${what}`);
    const res = await handler(req);
    console.info(`[mcp] <- ${res.status} ${what} in ${Date.now() - started} ms`);
    return res;
  };
}
