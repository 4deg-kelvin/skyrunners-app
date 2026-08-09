import Link from "next/link";
import { Plane } from "lucide-react";

import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";
import { GoogleSignInButton } from "./google-sign-in-button";
import { ALLOWED_EMAIL_DOMAIN, isDemoMode } from "@/lib/env";

export const metadata = {
  title: "Sign in · SkyRunners HQ",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const demo = isDemoMode();

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center">
      <div className="w-full">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="bg-cardinal-600 flex size-9 items-center justify-center rounded-full text-white">
            <Plane className="size-4.5" strokeWidth={2.5} />
          </span>
          <span className="text-cardinal-600 text-xl font-bold tracking-tight">
            SkyRunners HQ
          </span>
        </div>

        <Card>
          <CardBody className="py-8">
            <SectionLabel>Stanford UAV</SectionLabel>
            <h1 className="text-ink mt-2 text-3xl font-bold">Sign in</h1>
            <p className="text-ink-soft mt-3 text-[15px]">
              Use your Stanford Google account. Only{" "}
              <span className="text-ink font-semibold">
                @{ALLOWED_EMAIL_DOMAIN}
              </span>{" "}
              addresses can access the app.
            </p>

            {error ? (
              <div className="rounded-tile bg-risk-bg mt-5 px-4 py-3">
                <p className="text-risk-fg text-sm font-medium">
                  {error === "domain"
                    ? `That account isn't a @${ALLOWED_EMAIL_DOMAIN} address. Sign in with your Stanford account.`
                    : "Sign-in didn't complete. Try again."}
                </p>
              </div>
            ) : null}

            {demo ? (
              <div className="rounded-tile bg-warn-bg mt-5 px-4 py-3.5">
                <p className="text-warn-fg text-sm font-semibold">
                  Demo mode — no login needed
                </p>
                <p className="text-warn-fg mt-1 text-sm">
                  Supabase isn&apos;t configured, so the app is running on
                  sample data. Everything works; nothing is saved.
                </p>
                <Link
                  href="/my-work"
                  className="text-cardinal-600 hover:text-cardinal-700 mt-3 inline-block text-sm font-bold"
                >
                  Continue to the app →
                </Link>
              </div>
            ) : (
              <div className="mt-6">
                <GoogleSignInButton next={next} />
              </div>
            )}

            <p className="text-ink-muted mt-6 text-sm">
              New to the team? A Lead or Co-Lead needs to invite you first. Once
              they have, sign in here with the same Stanford address.
            </p>
          </CardBody>
        </Card>

        <p className="text-ink-muted mt-5 text-center text-sm">
          <Link href="/how-we-lead" className="hover:text-cardinal-600">
            How the team works
          </Link>
        </p>
      </div>
    </div>
  );
}
