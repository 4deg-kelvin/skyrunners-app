/**
 * Supabase client for the SERVER (Server Components, Server Actions, route
 * handlers).
 *
 * Reads and writes auth cookies via Next's `cookies()`, which is how the session
 * survives a page navigation.
 *
 * Returns null in demo mode.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseConfig } from "@/lib/env";

/**
 * See the identical note in `lib/supabase/middleware.ts` — `createServerClient`
 * declares the deprecated cookie-method overload first, so this parameter has to
 * be annotated or `strict` rejects it as an implicit `any`.
 */
type CookiesToSet = { name: string; value: string; options: CookieOptions }[];

export async function createClient() {
  const config = supabaseConfig();
  if (!config) return null;

  const cookieStore = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Server Components can't set cookies. That's fine and expected —
          // `middleware.ts` refreshes the session on every request, so the
          // cookie is always current by the time a page renders. This catch is
          // why the middleware is mandatory rather than merely recommended.
        }
      },
    },
  });
}
