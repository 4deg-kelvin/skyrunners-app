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
          <span className="flex size-9 items-center justify-center rounded-full bg-cardinal-600 text-white">
            <Plane className="size-4.5" strokeWidth={2.5} />
          </span>
          <span className="text-xl font-bold tracking-tight text-cardinal-600">
            SkyRunners HQ
          </span>
        </div>

        <Card>
          <CardBody className="py-8">
            <SectionLabel>Stanford UAV</SectionLabel>
            <h1 className="mt-2 text-3xl font-bold text-ink">Sign in</h1>
            <p className="mt-3 text-[15px] text-ink-soft">
              Use your Stanford Google account. Only{" "}
              <span className="font-semibold text-ink">
                @{ALLOWED_EMAIL_DOMAIN}
              </span>{" "}
              addresses can access the app.
            </p>

            {error ? (
              <div className="mt-5 rounded-tile bg-risk-bg px-4 py-3">
                <p className="text-sm font-medium text-risk-fg">
                  {error === "domain"
                    ? `That account isn't a @${ALLOWED_EMAIL_DOMAIN} address. Sign in with your Stanford account.`
                    : "Sign-in didn't complete. Try again."}
                </p>
              </div>
            ) : null}

            {demo ? (
              <div className="mt-5 rounded-tile bg-warn-bg px-4 py-3.5">
                <p className="text-sm font-semibold text-warn-fg">
                  Demo mode — no login needed
                </p>
                <p className="mt-1 text-sm text-warn-fg">
                  Supabase isn&apos;t configured, so the app is running on sample
                  data. Everything works; nothing is saved.
                </p>
                <Link
                  href="/my-work"
                  className="mt-3 inline-block text-sm font-bold text-cardinal-600 hover:text-cardinal-700"
                >
                  Continue to the app →
                </Link>
              </div>
            ) : (
              <div className="mt-6">
                <GoogleSignInButton next={next} />
              </div>
            )}

            <p className="mt-6 text-sm text-ink-muted">
              New to the team? A Lead or Co-Lead needs to invite you first. Once
              they have, sign in here with the same Stanford address.
            </p>
          </CardBody>
        </Card>

        <p className="mt-5 text-center text-sm text-ink-muted">
          <Link href="/how-we-lead" className="hover:text-cardinal-600">
            How the team works
          </Link>
        </p>
      </div>
    </div>
  );
}
