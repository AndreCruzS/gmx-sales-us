export function linkTo(path: string): string {
  const origin = (process.env.MCP_PUBLIC_ORIGIN || "https://sales.gmxgroup.com").replace(/\/+$/, "");
  return `${origin}/${path.replace(/^\/+/, "")}`;
}

export function receipt(lines: string[], refs: { id: string; path: string }[]): string {
  return [...lines, ...refs.map((r) => `Open: ${linkTo(r.path)}`)].join("\n");
}

const show = (k: string, v: unknown): string => {
  if (k === "completed_at") return v ? "done" : "open";
  if (v === null || v === undefined || v === "") return "empty";
  return String(v);
};

/** "due_date: 2026-11-04 → 2026-11-06; action: A → B" for the fields a patch changed. */
export function changes(before: Record<string, unknown>, patch: Record<string, unknown>): string {
  return Object.keys(patch)
    .map((k) => `${k}: ${show(k, before[k])} → ${show(k, patch[k])}`)
    .join("; ");
}
