import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { TopNav } from "@/components/layout/top-nav";
import { getViewer } from "@/lib/data/viewer";
import { getMyWork } from "@/lib/data/my-work";

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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await getViewer();

  // Real count rather than a hardcoded dot: an alert should mean something.
  const myWork = await getMyWork(viewer.member.id);
  const alertCount =
    myWork.currentUpdate.update.status === "pending" ||
    myWork.currentUpdate.update.status === "late"
      ? 1
      : 0;

  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        <TopNav
          userName={viewer.member.fullName}
          isLeadership={viewer.member.globalRole !== "member"}
          alertCount={alertCount}
        />
        <main className="mx-auto max-w-[1400px] px-5 py-6 sm:px-8 sm:py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
