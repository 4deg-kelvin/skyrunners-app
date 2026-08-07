import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { SignOutButton } from "@/components/layout/sign-out-button";

/**
 * Signed in with a valid Stanford account, but there's no profile row.
 *
 * Means they were never invited, or an invite was sent to a different address.
 * A dead-end error page here would be a terrible first impression for a new
 * member, so this explains exactly what to do next.
 */
export default function NoProfilePage() {
  return (
    <div className="mx-auto max-w-lg py-10">
      <Card>
        <CardBody className="py-8">
          <SectionLabel>Almost There</SectionLabel>
          <h1 className="mt-2 text-3xl font-bold text-ink">
            You&apos;re not on the roster yet
          </h1>
          <p className="mt-3 text-[15px] text-ink-soft">
            Your Stanford sign-in worked, but there&apos;s no SkyRunners profile
            attached to it yet. A Team Lead or Co-Lead needs to add you.
          </p>
          <p className="mt-3 text-[15px] text-ink-soft">
            If someone already invited you, they may have used a different email
            address — worth checking which one, then signing in with that.
          </p>
          <div className="mt-6">
            <SignOutButton label="Sign in with a different account" />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
