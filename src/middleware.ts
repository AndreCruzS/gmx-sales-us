import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { gate } from "@/lib/supabase/gate";

// Session refresh + auth gate. The offline SYNC path never passes through
// here (D3) — this guards page navigation only. Who may pass is decided in
// lib/supabase/gate, including the Google return (see there).
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const code = request.nextUrl.searchParams.get("code");
  const decision = gate({
    pathname: request.nextUrl.pathname,
    signedIn: user !== null,
    code,
  });

  if (decision.kind === "exchange") {
    // Google's return: mint the session from the code (the PKCE verifier is a
    // cookie the browser client set before leaving), then send the person on
    // without the code. The session cookies were written onto `response` by
    // setAll above, so they have to ride on the redirect as well.
    const { error } = await supabase.auth.exchangeCodeForSession(code!);
    const url = request.nextUrl.clone();
    url.searchParams.delete("code");
    if (error || url.pathname.startsWith("/login")) url.pathname = error ? "/login" : "/";
    const redirect = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  if (decision.kind === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = decision.pathname;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // F4: the sync cron routes (hubspot/email/calendar) authenticate themselves
  // via `authorization: Bearer ${CRON_SECRET}` (or a rep's own session for
  // email/calendar's caller mode) — they have no browser session and must
  // never hit this middleware's session check, or Vercel Cron's sessionless
  // GET/POST gets redirected to /login before CRON_SECRET is ever read.
  // api/hubspot/admin is included too: it's the manual setup/backfill
  // endpoint, also Bearer-CRON_SECRET-only with no session cookie — without
  // this exclusion every documented curl (setup, backfill) 307s to /login
  // before the handler ever sees the request.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|sw.js|manifest|api/hubspot/sync|api/hubspot/admin|api/email/sync|api/calendar/team/sync).*)",
  ],
};
