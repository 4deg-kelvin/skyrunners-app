import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
