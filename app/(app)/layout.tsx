import { TopNav } from "@/components/layout/top-nav";
import { DemoBanner } from "@/components/layout/demo-banner";
import { getViewer } from "@/lib/data/viewer";
import { getMyWork } from "@/lib/data/my-work";
import { getLeadershipRoles } from "@/lib/data/members";

/**
 * The signed-in shell: nav, demo banner, page container.
 *
 * Everything in this route group requires a viewer. `getViewer()` redirects to
 * `/login` when there isn't one — which is why `/login` and `/auth/*` sit
 * OUTSIDE this group.
 */
/**
 * Rendered per request, never prerendered.
 *
 * Every page in this group resolves a signed-in viewer and reads their club's
 * live data. Prerendering any of it at build time would bake in whatever
 * `readStore()` returned with no session — and would serve one person's page to
 * everybody. There is nothing here that is the same for two users.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await getViewer();

  /**
   * Real count rather than a hardcoded dot: an alert should mean something.
   *
   * Wrapped in try/catch on purpose. This layout wraps every authenticated page,
   * and `error.tsx` in this segment cannot catch errors thrown by its own
   * layout — so an exception here becomes a bare, unstyled 500 on every single
   * route. A nav badge must never be able to take down the app.
   */
  /*
    Whether to offer the leadership guide.

    Wrapped for the same reason as `alertCount` below: this layout wraps every
    authenticated page and `error.tsx` cannot catch what its own layout throws,
    so a failure here is a bare 500 on every route. A menu item is never worth
    that.
  */
  let leadershipRoles = { isRE: false, divisionsLed: [] as string[] };
  try {
    leadershipRoles = await getLeadershipRoles(viewer.member.id);
  } catch {
    leadershipRoles = { isRE: false, divisionsLed: [] };
  }

  let alertCount = 0;
  try {
    const myWork = await getMyWork(viewer.member.id);
    const updateNeedsAttention =
      myWork.currentUpdate.update.status === "pending" ||
      myWork.currentUpdate.update.status === "late";
    alertCount =
      (updateNeedsAttention ? 1 : 0) + myWork.requestsAwaitingMe.length;
  } catch {
    // Expected in live mode until lib/data/* is switched over to Postgres: the
    // mock lookups key on ids like "m-anish" and won't find a real UUID.
    alertCount = 0;
  }

  return (
    <>
      {viewer.isDemo ? <DemoBanner /> : null}
      <TopNav
        memberId={viewer.member.id}
        userName={viewer.member.fullName}
        isLeadership={viewer.member.globalRole !== "member"}
        showLeadingGuide={
          viewer.member.globalRole !== "member" || leadershipRoles.isRE
        }
        isDemo={viewer.isDemo}
        alertCount={alertCount}
      />
      <main className="mx-auto max-w-[1400px] px-5 py-6 sm:px-8 sm:py-8">
        {children}
      </main>
    </>
  );
}
