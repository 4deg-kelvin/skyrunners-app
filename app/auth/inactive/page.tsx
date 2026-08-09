import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { SignOutButton } from "@/components/layout/sign-out-button";

/**
 * Profile exists but `status` isn't `active` — inactive or alumni.
 *
 * We never hard-delete people, so accounts persist after someone leaves or
 * graduates. This is the door they hit, and it's deliberately warm: an alum
 * coming back to look something up shouldn't be met with an error.
 */
export default function InactivePage() {
  return (
    <div className="mx-auto max-w-lg py-10">
      <Card>
        <CardBody className="py-8">
          <SectionLabel>Account Inactive</SectionLabel>
          <h1 className="text-ink mt-2 text-3xl font-bold">
            Your account isn&apos;t active
          </h1>
          <p className="text-ink-soft mt-3 text-[15px]">
            Your profile is marked inactive or alumni, so the app is read-locked
            for now. Your contribution history is all still there — nothing gets
            deleted.
          </p>
          <p className="text-ink-soft mt-3 text-[15px]">
            Rejoining? Ask a Co-Lead to reactivate you and everything comes back
            as it was.
          </p>
          <div className="mt-6">
            <SignOutButton />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
