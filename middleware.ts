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
   * Everything except static assets and images.
   *
   * Matching static files would run an auth check for every icon and font, which
   * is wasted work on every page load.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
