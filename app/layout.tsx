import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { TopNav } from "@/components/layout/top-nav";
import { CURRENT_USER_ID, getMember } from "@/lib/mock-data";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SkyRunners HQ",
  description:
    "Project and member management for Stanford UAV — track engineering efforts and member engagement.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Mock auth for now. Replaced by the Supabase session once auth is wired up.
  const user = getMember(CURRENT_USER_ID);

  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        <TopNav userName={user?.fullName ?? "Member"} />
        <main className="mx-auto max-w-[1400px] px-5 py-6 sm:px-8 sm:py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
