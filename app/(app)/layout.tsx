import { TopNav } from "@/components/layout/top-nav";
import { DemoBanner } from "@/components/layout/demo-banner";
import { getViewer } from "@/lib/data/viewer";
import { getMyWork } from "@/lib/data/my-work";
import { getLeadershipRoles } from "@/lib/data/members";
import { getClubIdentity } from "@/lib/data/settings";
import { DiscordBanner } from "@/components/ui/discord-banner";
import { LogWorkBanner } from "@/components/ui/log-work-banner";
import { daysBetweenDays, todayInClubTime } from "@/lib/dates";
import { discordIsConfigured } from "@/lib/notify/discord";
import type { Metadata } from "next";
import { isAdvisor, isLeadership } from "@/lib/permissions";

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
    // Fail closed: a link that isn't there is a smaller problem than a 500.
    leadershipRoles = { isRE: false, divisionsLed: [] };
  }

  /*
    The club's own name, for the header and every tab title.

    Read HERE rather than in the root layout, which is html/body/fonts only and
    must not resolve the viewer — see CLAUDE.md. Metadata from a nested layout
    applies to everything beneath it, so this is the right seam anyway.
  */
  let identity: Awaited<ReturnType<typeof getClubIdentity>> = {
    name: "SkyRunners HQ",
    description: "",
  };
  try {
    identity = await getClubIdentity();
  } catch {
    // Same reasoning as the guards below: this layout wraps every
    // authenticated page and cannot be allowed to fail one.
  }

  let alertCount = 0;
  /*
    Never logged an hour, and past their first day.

    Read off the same `getMyWork` call as the alert count rather than a second
    query — it's already here, and the layout wraps every page in the app.

    The day's grace is a date comparison, not a scheduled job: a new member's
    first visit already asks them to connect Discord, and there is nothing
    honest to nag about before they've done any work. Expressing the delay as
    `joinedAt` versus today means it starts applying on its own, with no cron.
  */
  let nudgeToLogWork = false;
  /*
    Still skipped for advisors. An advisor answers no join requests and is not
    asked to log work, so both readings would be zero for a nav item they cannot
    see — not asking is cheaper than asking and discarding the answer.
  */
  if (!isAdvisor(viewer.actor)) {
    try {
      const myWork = await getMyWork(viewer.member.id);
      alertCount = myWork.requestsAwaitingMe.length;
      nudgeToLogWork =
        !myWork.hasEverLoggedWork &&
        daysBetweenDays(viewer.member.joinedAt, todayInClubTime()) >= 1;
    } catch {
      // Fail quiet on both counts. A nav badge and a nudge are never worth a
      // 500 on every authenticated route, and a banner that appears because a
      // lookup threw would tell somebody they've logged nothing on no evidence.
      alertCount = 0;
      nudgeToLogWork = false;
    }
  }

  return (
    <>
      {viewer.isDemo ? <DemoBanner /> : null}
      {/*
        Clears on VERIFICATION, and on nothing else.

        A saved ID is not a working one — a typo, somebody who never joined the
        club server, or DMs switched off all look identical to a correct entry
        and deliver nothing. Letting the banner go on "they typed something"
        would mean the app declaring everyone reachable while a third of them
        silently aren't, which is the exact false confidence the whole
        verification step exists to prevent.

        So it stays up until a real message has arrived. Three states, because
        the reader's next action differs: nothing entered, entered but
        unproven, and entered-with-no-bot-to-prove-it-against. That last one is
        the club's outstanding work rather than the member's, and the copy says
        so — but it stays visible, because it IS still unfinished.

        Every member sees it, leadership included. Nothing here is
        role-dependent and shouldn't be: a Lead who can't be reached is the
        worse case, since check-ins escalate to them.
      */}
      {/*
        Both banners are about doing the work, so neither applies to an advisor.

        Discord is optional for them — the club has no obligation to be able to
        DM a professor, and every notification the bot sends is about a project
        they don't own, a check-in they don't file, or a blocker that isn't
        theirs to clear. Nagging them daily for a channel they were never asked
        to join is how a required banner teaches everybody to ignore banners.
        They can still connect it from Settings if they want the traffic.
      */}
      {!viewer.member.discordVerifiedAt && !isAdvisor(viewer.actor) ? (
        <DiscordBanner
          hasId={Boolean(viewer.member.discordUserId)}
          botLive={discordIsConfigured()}
        />
      ) : null}
      {nudgeToLogWork && !isAdvisor(viewer.actor) ? <LogWorkBanner /> : null}
      <TopNav
        memberId={viewer.member.id}
        userName={viewer.member.fullName}
        /*
          Drives the Dashboard link, and it has to be the same question
          `/dashboard` redirects on — "are you a PL of anything", not "is your
          role string leadership". A Lead who is PL of nothing would otherwise
          see a link that bounces them back, and a plain member named PL of one
          project would see none for a page they're entitled to.

          Was "do you oversee anybody" until 2026-08-24. Same shape of question,
          asked of the tree that still exists.
        */
        isLeadership={
          viewer.member.globalRole === "co_lead" || leadershipRoles.isRE
        }
        isAdvisor={isAdvisor(viewer.actor)}
        showLeadingGuide={isLeadership(viewer.actor) || leadershipRoles.isRE}
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
