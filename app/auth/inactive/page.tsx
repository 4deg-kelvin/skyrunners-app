import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { SignOutButton } from "@/components/layout/sign-out-button";

/**
 * Profile exists but `status` isn't `active`.
 *
 * Two very different people land here and the copy has to serve both:
 *
 *   - **Somebody brand new.** They followed a link, signed in with Stanford
 *     Google, and the trigger in migration 0005 created them an inactive
 *     profile. This is the front door, not an error — they are one click from
 *     being in, and the click belongs to any Lead. Saying "your account isn't
 *     active" to somebody on their first visit reads as a rejection, so the
 *     heading names what's actually happening: they're in the queue.
 *   - **An alum or a deactivated member.** Nothing is deleted, and coming back
 *     to look something up shouldn't be met with a wall.
 *
 * Deliberately doesn't distinguish them in the UI. The app can tell (by
 * `lastActiveAt`) but this page renders before a viewer is resolved, and
 * guessing wrong at somebody would be worse than one warm message that covers
 * both.
 */
export default function InactivePage() {
  return (
    <div className="mx-auto max-w-lg py-10">
      <Card>
        <CardBody className="py-8">
          <SectionLabel>Almost In</SectionLabel>
          <h1 className="text-ink mt-2 text-3xl font-bold">
            You&apos;re signed in — waiting to be let in
          </h1>
          <p className="text-ink-soft mt-3 text-[15px]">
            Your Stanford account worked. Somebody from the club has to admit
            you before the app opens up, and it takes them one click — any Lead
            or Co-Lead can do it, so message whoever sent you the link.
          </p>
          <p className="text-ink-soft mt-3 text-[15px]">
            Been here before? If you were deactivated or you&apos;ve graduated,
            nothing was deleted — your work log, check-ins and delivered work
            are all still attached to their projects, and everything comes back
            exactly as it was.
          </p>
          <div className="mt-6">
            <SignOutButton />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
