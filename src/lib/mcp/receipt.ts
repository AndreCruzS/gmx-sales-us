export function linkTo(path: string): string {
  const origin = (process.env.MCP_PUBLIC_ORIGIN || "https://sales.gmxgroup.com").replace(/\/+$/, "");
  return `${origin}/${path.replace(/^\/+/, "")}`;
}

export function receipt(lines: string[], refs: { id: string; path: string }[]): string {
  return [...lines, ...refs.map((r) => `Open: ${linkTo(r.path)}`)].join("\n");
}
