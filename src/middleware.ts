import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Session refresh + auth gate. The offline SYNC path never passes through
// here (D3) — this guards page navigation only.
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

  const isLogin = request.nextUrl.pathname.startsWith("/login");
  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
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
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|sw.js|manifest|api/hubspot/sync|api/hubspot/admin|api/email/sync|api/calendar/sync).*)",
  ],
};
