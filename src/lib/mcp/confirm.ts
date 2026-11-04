import { createHmac, timingSafeEqual } from "node:crypto";

export interface ConfirmSubject {
  userId: string;
  tool: string;
  args: unknown;
}

const TTL_MS = 5 * 60 * 1000;
const ADMIN_TOOLS = ["set_territory_target", "save_dealer_alias", "close_deal"];

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

function withoutConfirmation(args: unknown): unknown {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const { confirmation: _c, ...rest } = args as Record<string, unknown>;
    return rest;
  }
  return args;
}

function resolveSecret(secret?: string): string | null {
  const s = secret ?? process.env.MCP_CONFIRM_SECRET;
  return s && Buffer.byteLength(s) >= 32 ? s : null;
}

function mac(secret: string, s: ConfirmSubject, expUnix: string): Buffer {
  const payload = `${s.userId}|${s.tool}|${stableStringify(withoutConfirmation(s.args))}|${expUnix}`;
  return createHmac("sha256", secret).update(payload).digest();
}

export function issueConfirmation(
  s: ConfirmSubject,
  now: Date,
  secret?: string,
): { code: string; expiresAt: string } {
  const key = resolveSecret(secret);
  if (!key) throw new Error("MCP_CONFIRM_SECRET is missing or shorter than 32 bytes");
  const exp = now.getTime() + TTL_MS;
  const expUnix = String(Math.floor(exp / 1000));
  const code = `${Buffer.from(expUnix).toString("base64url")}.${mac(key, s, expUnix).toString("base64url")}`;
  return { code, expiresAt: new Date(exp).toISOString() };
}

export function checkConfirmation(code: string, s: ConfirmSubject, now: Date, secret?: string): boolean {
  try {
    const key = resolveSecret(secret);
    if (!key || typeof code !== "string") return false;
    const parts = code.split(".");
    if (parts.length !== 2) return false;
    const expUnix = Buffer.from(parts[0], "base64url").toString();
    if (!/^\d+$/.test(expUnix)) return false;
    if (now.getTime() > Number(expUnix) * 1000) return false;
    const given = Buffer.from(parts[1], "base64url");
    const want = mac(key, s, expUnix);
    return given.length === want.length && timingSafeEqual(given, want);
  } catch {
    return false;
  }
}

export function confirmationReason(
  tool: string,
  args: Record<string, unknown>,
  me: { membershipId: string },
): string | null {
  if (tool.startsWith("delete_")) return "This deletes a record.";
  if (args.owner_id !== undefined && args.owner_id !== null && args.owner_id !== me.membershipId)
    return "This acts in someone else's name.";
  if (Object.values(args).some((v) => Array.isArray(v) && v.length >= 5))
    return "This changes 5 or more records at once.";
  if (ADMIN_TOOLS.includes(tool)) return "This changes an admin setting.";
  return null;
}
