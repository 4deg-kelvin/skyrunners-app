"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { SectionLabel } from "@/components/ui/section-label";

/**
 * Catches render and data-fetch errors inside the app shell.
 *
 * Once Supabase is wired up, a dropped connection or failed query surfaces here
 * rather than as a raw stack trace. `reset()` retries the failed segment, which
 * is often all a transient network blip needs.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Replace with real error reporting when there's somewhere to send it
    console.error("App error:", error);
  }, [error]);

  return (
    <Card>
      <CardBody className="py-12 text-center">
        <SectionLabel>Something Broke</SectionLabel>
        <h1 className="mt-3 text-3xl font-bold text-ink">
          This page didn&apos;t load
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] text-ink-soft">
          Usually a temporary connection problem. Try again — if it keeps
          happening, send the message below to whoever is on call.
        </p>

        {process.env.NODE_ENV === "development" ? (
          <pre className="mx-auto mt-5 max-w-xl overflow-x-auto rounded-tile bg-surface px-4 py-3 text-left text-xs text-ink-soft">
            {error.message}
          </pre>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={reset}>Try again</Button>
          <ButtonLink href="/my-work" variant="secondary">
            Go to My Work
          </ButtonLink>
        </div>
      </CardBody>
    </Card>
  );
}
