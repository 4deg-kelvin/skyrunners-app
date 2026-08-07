/**
 * ============================================================================
 * SESSION REFRESH — the piece auth silently fails without
 * ============================================================================
 *
 * Supabase access tokens are short-lived. Something has to exchange the refresh
 * token for a new access token and write the updated cookie, and in the Next.js
 * App Router that something must be middleware — Server Components are not
 * allowed to set cookies.
 *
 * Skip this file and you get the worst kind of bug: login appears to work, then
 * people are randomly signed out minutes later, with no error that points here.
 *
 * It also does the route gating, because middleware runs before any page does.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "@/lib/env";

/** Routes reachable without being signed in. */
const PUBLIC_PATHS = ["/login", "/auth"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

/**
 * Redirect while KEEPING the refreshed auth cookies.
 *
 * This is subtle and it bites hard. `getUser()` below may refresh the token,
 * and `setAll` writes the new pair onto `response`. Returning a bare
 * `NextResponse.redirect()` throws those away — the browser keeps a refresh
 * token that Supabase has already consumed, and once the reuse grace window
 * passes the session dies.
 *
 * Result: login works, then people are randomly signed out minutes later. It
 * cannot be reproduced in demo mode, so it would only show up in production.
 */
function redirectKeepingCookies(url: URL, carrying: NextResponse) {
  const redirect = NextResponse.redirect(url);
  carrying.cookies.getAll().forEach((cookie) => {
    redirect.cookies.set(cookie);
  });
  return redirect;
}

export async function updateSession(request: NextRequest) {
  const config = supabaseConfig();

  // DEMO MODE: no Supabase configured, so there's no session to refresh and
  // nothing to gate. The app runs on mock data and every route is open.
  if (!config) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Write to both: the request (so this render sees it) and the response
        // (so the browser stores it).
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: `getUser()`, not `getSession()`. getUser revalidates the token
  // with Supabase; getSession trusts whatever is in the cookie, which is
  // spoofable. Never gate access on getSession.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Remember where they were headed, so they land there after signing in
    // rather than being dumped on the home page.
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return redirectKeepingCookies(url, response);
  }

  // Already signed in and looking at the login page? Send them to their work.
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/my-work";
    url.search = "";
    return redirectKeepingCookies(url, response);
  }

  // Must return `response`, not a fresh NextResponse — it carries the refreshed
  // auth cookies. Returning anything else drops them and breaks the session.
  return response;
}
