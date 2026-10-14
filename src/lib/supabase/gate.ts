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

export type GateDecision =
  | { kind: "pass" }
  | { kind: "redirect"; pathname: "/" | "/login" }
  | { kind: "exchange" };

export function gate(req: {
  pathname: string;
  signedIn: boolean;
  code: string | null;
}): GateDecision {
  const isLogin = req.pathname.startsWith("/login");
  if (!req.signedIn && req.code) return { kind: "exchange" };
  if (!req.signedIn && !isLogin) return { kind: "redirect", pathname: "/login" };
  if (req.signedIn && isLogin) return { kind: "redirect", pathname: "/" };
  return { kind: "pass" };
}
