// Which agent made an item (agent connector): the column holds "claude" or
// "muse" for agent-made rows and null for anything made in the app.
export type Via = "claude" | "muse";

export function viaLabel(via: Via | null | undefined): string | null {
  if (via === "claude") return "via Claude";
  if (via === "muse") return "via Muse";
  return null;
}
