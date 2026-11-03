// Where an old /record link lands now (one-mic spec §3.4): Say it, with the
// planned visit (?visit= or the older ?item=) and the account kept.
export function sayHref(params: URLSearchParams): string {
  const next = new URLSearchParams();
  const visit = params.get("visit") ?? params.get("item");
  const account = params.get("account");
  if (visit) next.set("visit", visit);
  if (account) next.set("account", account);
  const q = next.toString();
  return q ? `/say?${q}` : "/say";
}
