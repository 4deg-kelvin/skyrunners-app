import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Where compiled output goes. Overridable, and that matters.
   *
   * `next build` DELETES and rewrites this directory. `next dev` serves live out
   * of it. Run a build while the dev server is up and the dev server's webpack
   * chunks vanish underneath it, producing errors that look like application
   * bugs and point nowhere near the cause:
   *
   *     Cannot find module './405.js'
   *     __webpack_modules__[moduleId] is not a function
   *     ENOENT: .next/server/pages-manifest.json
   *
   * The dev server does not recover — it has to be restarted with `.next`
   * deleted. This cost two debugging sessions before the pattern was spotted.
   *
   * So verification builds go somewhere else: `npm run build:check` sets
   * NEXT_DIST_DIR and leaves the running dev server completely alone. Plain
   * `npm run build` (what Vercel and CI run) is unchanged.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
