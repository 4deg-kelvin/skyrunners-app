/**
 * Absolute links into this deployment.
 *
 * Callers with the same problem and no shared context to solve it from:
 *
 *   - a Discord DM is read on a lock screen with no browser around it, so a
 *     relative path is useless;
 *   - the MCP server URL is copied into a config file on somebody else's
 *     machine, where a relative path is meaningless;
 *   - a **calendar subscription URL** is pasted into Apple Calendar and then
 *     fetched, unattended, for years.
 *
 * Lives here rather than in `lib/actions/index.ts` — where it started — because a
 * Server Component can't import from a `"use server"` module without exporting it
 * as an action.
 *
 * ---------------------------------------------------------------------------
 * `VERCEL_URL` is the wrong variable, and it was being used
 * ---------------------------------------------------------------------------
 *
 * `VERCEL_URL` is the **per-deployment** host — something like
 * `skyrunners-2qhfdv7k0-kelvins-projects.vercel.app`. It is different on every
 * single deploy, and it is not the domain members use.
 *
 * That was tolerable while the only callers were Discord messages read within
 * minutes of being sent. It became a real bug the moment a URL got STORED
 * somewhere outside this app:
 *
 *   - A **calendar subscription** built from it would work until the next deploy
 *     and then quietly stop, taking every member's club calendar with it. There
 *     is no error surface: a calendar client that starts getting 404s shows a
 *     stale calendar and says nothing.
 *   - An **MCP server URL** copied into somebody's AI config would die the same
 *     way, and present as "the SkyRunners connector is broken".
 *
 * Caught by fetching a real feed on production and reading the `URL:` line in the
 * generated ICS — it pointed at the deployment host, not the club's domain.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` is the fix: Vercel sets it automatically on
 * every deployment to the project's **stable production domain**, which is what
 * every one of these callers actually wants. It is preferred over `VERCEL_URL`
 * and `VERCEL_URL` is kept only as a last resort, so a preview deployment still
 * produces links that resolve to itself.
 *
 * `NEXT_PUBLIC_SITE_URL` still wins over both, so a custom domain — the day the
 * club buys one — needs one env var and no code change.
 */
export function appUrl(path: string): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return `${explicit.replace(/\/$/, "")}${path}`;

  /*
    The stable production domain, when Vercel is telling us one.

    Note this is used even on a PREVIEW deployment, deliberately: a link created
    in a preview is far more likely to be followed later, by a human, than to be
    wanted as a self-reference. Getting a working link to production beats a
    working link to a deployment that will be garbage-collected.
  */
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return `https://${production}${path}`;

  // Last resort: this exact deployment. Right for a preview with no project
  // domain configured, and wrong for anything stored — see above.
  const deployment = process.env.VERCEL_URL?.trim();
  if (deployment) return `https://${deployment}${path}`;

  return `http://localhost:3000${path}`;
}
