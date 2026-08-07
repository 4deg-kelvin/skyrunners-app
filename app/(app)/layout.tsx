import { TopNav } from "@/components/layout/top-nav";
import { DemoBanner } from "@/components/layout/demo-banner";
import { getViewer } from "@/lib/data/viewer";
import { getMyWork } from "@/lib/data/my-work";

/**
 * The signed-in shell: nav, demo banner, page container.
 *
 * Everything in this route group requires a viewer. `getViewer()` redirects to
 * `/login` when there isn't one — which is why `/login` and `/auth/*` sit
 * OUTSIDE this group.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await getViewer();

  // Real count rather than a hardcoded dot: an alert should mean something.
  const myWork = await getMyWork(viewer.member.id);
  const updateNeedsAttention =
    myWork.currentUpdate.update.status === "pending" ||
    myWork.currentUpdate.update.status === "late";
  const alertCount =
    (updateNeedsAttention ? 1 : 0) + myWork.requestsAwaitingMe.length;

  return (
    <>
      {viewer.isDemo ? <DemoBanner /> : null}
      <TopNav
        memberId={viewer.member.id}
        userName={viewer.member.fullName}
        isLeadership={viewer.member.globalRole !== "member"}
        isDemo={viewer.isDemo}
        alertCount={alertCount}
      />
      <main className="mx-auto max-w-[1400px] px-5 py-6 sm:px-8 sm:py-8">
        {children}
      </main>
    </>
  );
}
