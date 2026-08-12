/**
 * Runs before every matching request.
 *
 * This file must live at the REPO ROOT — not in `app/`. Next only looks here.
 *
 * All it does is delegate to `updateSession`, which refreshes the Supabase auth
 * cookie and gates protected routes. See lib/supabase/middleware.ts for why that
 * has to happen in middleware and nowhere else.
 */

import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  /**
   * Everything except static assets, images, and the cron endpoints.
   *
   * Matching static files would run an auth check for every icon and font, which
   * is wasted work on every page load.
   *
   * -------------------------------------------------------------------------
   * `api/cron` is excluded, and leaving it out breaks the job silently
   * -------------------------------------------------------------------------
   *
   * A Vercel Cron request carries `Authorization: Bearer $CRON_SECRET` and no
   * session cookie, so `updateSession` sees no user and 307s it to `/login`.
   * The route never runs, nothing errors, and the only symptom is that the
   * reminders quietly never arrive — which reads as a Discord problem and is
   * not one. Verified against production: `/api/cron/checkin-reminders`
   * answered `307 → /login?next=…` before this exclusion existed.
   *
   * This does NOT make the endpoint public. It authenticates itself, harder
   * than a session would: no `CRON_SECRET` configured is a 503, and a wrong or
   * missing bearer token is a 401. See the header of that route.
   *
   * -------------------------------------------------------------------------
   * `api/mcp` is excluded for exactly the same reason
   * -------------------------------------------------------------------------
   *
   * An MCP client sends `Authorization: Bearer skr_…` and no cookie, so
   * `updateSession` found no user and 307'd it to `/login`. The AI client got
   * an HTML redirect where it expected JSON-RPC and reported the server as
   * simply broken, with nothing in any log to say why.
   *
   * Caught by hitting production directly after the first deploy — it cannot
   * reproduce locally in demo mode, and no test covers the matcher. If you add
   * another self-authenticating endpoint, it belongs in this list too, and the
   * symptom to recognise is a JSON caller receiving "Redirecting...".
   *
   * Also not public: `/api/mcp` resolves its own token, and every unknown,
   * expired or revoked one is refused with a sentence. See
   * `lib/mcp/viewer.ts`.
   */
  matcher: [
    "/((?!_next/static|_next/image|api/cron|api/mcp|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
