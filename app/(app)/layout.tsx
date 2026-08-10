import { TopNav } from "@/components/layout/top-nav";
import { DemoBanner } from "@/components/layout/demo-banner";
import { getViewer } from "@/lib/data/viewer";
import { getMyWork } from "@/lib/data/my-work";
import { getLeadershipRoles } from "@/lib/data/members";
import { getClubIdentity } from "@/lib/data/settings";
import { DiscordBanner } from "@/components/ui/discord-banner";
import { discordIsConfigured } from "@/lib/notify/discord";
import type { Metadata } from "next";

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

  /*
    The club's own name, for the header and every tab title.

    Read HERE rather than in the root layout, which is html/body/fonts only and
    must not resolve the viewer — see CLAUDE.md. Metadata from a nested layout
    applies to everything beneath it, so this is the right seam anyway.
  */
  let identity = { name: "SkyRunners HQ", description: "" };
  try {
    identity = await getClubIdentity();
  } catch {
    // Same reasoning as the guards below: this layout wraps every
    // authenticated page and cannot be allowed to fail one.
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
      {/*
        Two different nags, and only one of them waits for the bot.

        NO ID AT ALL is always worth chasing, whether or not the club has wired
        the bot up yet. Everybody needs to have pasted their ID before
        notifications can start, and collecting thirty of them is slower than
        flipping an env var — so the asking should already be underway by the
        time the token lands. Every member sees it, leadership included:
        nothing here has ever been role-dependent, and a Lead who can't be
        reached is the worse case, since check-ins escalate to them.

        AN UNCONFIRMED ID is different. Confirming means sending a real test
        message, so with no bot there is nothing to confirm against — showing
        "we haven't reached you yet" when the club has no way to reach anybody
        would be blaming the member for our missing config.
      */}
      {!viewer.member.discordUserId ? (
        <DiscordBanner hasId={false} />
      ) : discordIsConfigured() && !viewer.member.discordVerifiedAt ? (
        <DiscordBanner hasId />
      ) : null}
      <TopNav
        memberId={viewer.member.id}
        userName={viewer.member.fullName}
        isLeadership={viewer.member.globalRole !== "member"}
        showLeadingGuide={
          viewer.member.globalRole !== "member" || leadershipRoles.isRE
        }
        clubName={identity.name}
        photoUrl={viewer.member.photoUrl}
        isDemo={viewer.isDemo}
        alertCount={alertCount}
      />
      <main className="mx-auto max-w-[1400px] px-5 py-6 sm:px-8 sm:py-8">
        {children}
      </main>
    </>
  );
}

/**
 * Tab titles follow the club's name.
 *
 * A `template` rather than each page spelling it out: pages now export just
 * "Calendar" or "Find work", and this appends whatever the club is called. The
 * alternative was fifteen files each hard-coding a name that a Co-Lead can
 * change from Settings, which is how "Stanford UAV" ends up with "SkyRunners
 * HQ" in every browser tab.
 *
 * On the `(app)` layout rather than the root one, which is html/body/fonts
 * only and must not resolve the viewer.
 */
export async function generateMetadata(): Promise<Metadata> {
  try {
    const { name } = await getClubIdentity();
    return { title: { default: name, template: `%s · ${name}` } };
  } catch {
    return {
      title: { default: "SkyRunners HQ", template: "%s · SkyRunners HQ" },
    };
  }
}
