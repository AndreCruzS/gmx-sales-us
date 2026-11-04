// WHO MAY PASS, decided in one place so it can be read and tested without a
// request. The middleware asks Supabase whether a session exists, then asks
// here what to do with the answer.
//
// THE GOOGLE RETURN (Andre, 2026-10-14: "when we login in the platform using
// google button the platform does not load ... until a refresh"). Google sends
// the person back to the site root with ?code=…, and the session does not
// exist yet — it is minted by exchanging that code. Before this, the gate saw
// no session, bounced /?code=… to /login?code=…, the browser client exchanged
// the code there and set the cookies, and nothing navigated away: the login
// page sat still until a refresh let the gate see the new cookies. Now a code
// with no session is exchanged server-side, wherever it landed, and the person
// is sent on with the code stripped. A code WITH a session is the calendar
// Connect flow on /settings/google, which the browser finishes itself.

// THE WAY BACK (agent connectors): the OAuth server sends a person to
// /oauth/consent. A stranger is sent to login with `next` set to that page and
// login brings them back. `next` is only honoured when it IS the consent page,
// so it can never become an open redirect.
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/oauth/consent")) return null;
  if (raw.startsWith("//") || raw.includes("\\")) return null;
  const rest = raw.slice("/oauth/consent".length);
  if (rest !== "" && !rest.startsWith("?") && !rest.startsWith("/")) return null;
  return raw;
}

export type GateDecision =
  | { kind: "pass" }
  | { kind: "redirect"; pathname: "/" | "/login"; next?: string }
  | { kind: "exchange" };

export function gate(req: {
  pathname: string;
  search: string;
  signedIn: boolean;
  code: string | null;
}): GateDecision {
  const isLogin = req.pathname.startsWith("/login");
  if (!req.signedIn && req.code) return { kind: "exchange" };
  if (!req.signedIn && !isLogin) {
    return req.pathname.startsWith("/oauth/")
      ? { kind: "redirect", pathname: "/login", next: req.pathname + req.search }
      : { kind: "redirect", pathname: "/login" };
  }
  if (req.signedIn && isLogin) {
    const next = safeNext(new URLSearchParams(req.search).get("next"));
    return next
      ? { kind: "redirect", pathname: "/", next }
      : { kind: "redirect", pathname: "/" };
  }
  return { kind: "pass" };
}
