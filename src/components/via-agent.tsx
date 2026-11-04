import { viaLabel, type Via } from "@/lib/domain/via";

/** A quiet "via Claude" / "via Muse" for agent-made items; nothing for app-made ones. */
export function ViaAgent({ via }: { via: Via | null | undefined }) {
  const label = viaLabel(via);
  if (!label) return null;
  return <span className="t-hint">{label}</span>;
}
