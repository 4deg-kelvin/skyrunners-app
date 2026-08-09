import { cookies } from "next/headers";

/**
 * ============================================================================
 * Light or dark, decided before the first pixel
 * ============================================================================
 *
 * ---------------------------------------------------------------------------
 * Why a cookie, and not localStorage or a column
 * ---------------------------------------------------------------------------
 *
 * The preference has to be known **before anything is painted**, or the page
 * flashes white and then goes dark. That flash happens on every navigation and
 * it happens hardest at night, which is exactly when somebody in dark mode is
 * looking — it's worse than shipping no dark mode at all.
 *
 * That rules out `localStorage`, which the server can't read. The usual patch
 * is a blocking inline script in `<head>`; it works, and it means shipping
 * render-blocking JavaScript whose only purpose is papering over the storage
 * choice.
 *
 * A **database column** would follow a member between devices, which is nicer,
 * and it can't be read at the only point early enough to matter: the root
 * layout must not resolve the viewer (CLAUDE.md — doing so puts `/login`
 * inside a layout that redirects unauthenticated visitors to `/login`).
 * Reading it in the `(app)` layout instead leaves the sign-in page un-themed
 * and still flashes on the way in.
 *
 * A cookie is readable in the root layout with no session, no query and no
 * script. The server renders `class="dark"` and the first paint is already
 * correct, on every route. The cost is that it's per-device — for a club whose
 * members have a laptop and a phone, being asked twice beats a flash on every
 * page load.
 *
 * ---------------------------------------------------------------------------
 * Why there's no "match my system" option
 * ---------------------------------------------------------------------------
 *
 * Considered and dropped. The OS preference is not sent with the request, so
 * the server cannot render it — following it means either a blocking script
 * (the thing above) or guessing and correcting, which is the flash again. A
 * `prefers-color-scheme` block in the stylesheet would work, but it means
 * maintaining the entire palette twice, and the second copy is the one that
 * silently drifts.
 *
 * Two states, and light is the default because that's what the app looked like
 * before anybody chose.
 */

const COOKIE = "skyrunners.theme";

export type ThemeChoice = "light" | "dark";

export function isThemeChoice(value: string): value is ThemeChoice {
  return value === "light" || value === "dark";
}

/** Their saved choice, or light when they've never set one. */
export async function getThemeChoice(): Promise<ThemeChoice> {
  const value = (await cookies()).get(COOKIE)?.value;
  return value && isThemeChoice(value) ? value : "light";
}

export const THEME_COOKIE = COOKIE;

/** A year. It's a display preference, not a session. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
