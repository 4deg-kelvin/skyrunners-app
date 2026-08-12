/**
 * Absolute links into this deployment.
 *
 * Two callers with the same problem and no shared context to solve it from:
 *
 *   - a Discord DM is read on a lock screen with no browser around it, so a
 *     relative path is useless;
 *   - the MCP server URL is copied into a config file on somebody else's
 *     machine, where a relative path is meaningless.
 *
 * `NEXT_PUBLIC_SITE_URL` when set, Vercel's own host otherwise, and localhost
 * in development. Lives here rather than in `lib/actions/index.ts` — where it
 * started — because a Server Component can't import from a `"use server"`
 * module without exporting it as an action.
 */
export function appUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");
  return `${base}${path}`;
}
