/**
 * OAuth callback. Google sends the user back here with a one-time code, which we
 * exchange for a session.
 *
 * This is also the second of three places the Stanford-only rule is enforced —
 * the `hd` parameter on the sign-in button is only a hint, and a database
 * constraint catches anything that gets past both.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/env";

/**
 * The public origin to redirect back to.
 *
 * `request.nextUrl.origin` is the *internal* origin behind a proxy or load
 * balancer, so a successful production sign-in could bounce someone to
 * `http://localhost:3000`. Prefer the configured public URL, then the forwarded
 * headers, and only fall back to nextUrl.
 */
function publicOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");

  const host = request.headers.get("x-forwarded-host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }

  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = publicOrigin(request);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/my-work";

  // Only allow relative redirects. An absolute URL here would be an open
  // redirect — an attacker could send someone a login link that bounces them to
  // a lookalike site after a genuine sign-in.
  const safeNext =
    next.startsWith("/") && !next.startsWith("//") ? next : "/my-work";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=exchange`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAllowedEmail(user?.email)) {
    // Signed in with the wrong Google account. Sign them straight back out —
    // leaving a non-Stanford session alive would be a half-open door.
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=domain`);
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}
