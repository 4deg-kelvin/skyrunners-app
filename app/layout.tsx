import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { getThemeChoice } from "@/lib/theme";

/**
 * Root layout — html, body, fonts. Nothing else.
 *
 * Deliberately does NOT resolve the signed-in user. If it did, the login page
 * would render inside a layout that redirects unauthenticated visitors to the
 * login page: an infinite loop.
 *
 * The signed-in shell (nav, demo banner) lives in `app/(app)/layout.tsx`.
 * The `(app)` parentheses make it a route group, which affects layout nesting
 * but not URLs — `/my-work` is still `/my-work`.
 *
 * It DOES read the theme cookie, which is not the same thing: no session, no
 * query, no redirect. It has to happen here rather than in `(app)` because
 * this is the only layout early enough to get the class onto <html> before the
 * first paint — anywhere later and the page flashes light before going dark.
 * See `lib/theme.ts`.
 */

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SkyRunners HQ",
  description:
    "Project and member management for Stanford UAV — track engineering efforts and member contribution.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = await getThemeChoice();

  return (
    <html
      lang="en"
      // Joined rather than interpolated: a template literal here silently
      // produced `__variable_abc123dark` when the leading space went missing,
      // which is one class nothing matches rather than two that do.
      className={[inter.variable, theme === "dark" ? "dark" : null]
        .filter(Boolean)
        .join(" ")}
    >
      <body className="font-sans">{children}</body>
    </html>
  );
}
