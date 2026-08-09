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
        <h1 className="text-ink mt-3 text-3xl font-bold">
          This page didn&apos;t load
        </h1>
        <p className="text-ink-soft mx-auto mt-3 max-w-md text-[15px]">
          Usually a temporary connection problem. Try again — if it keeps
          happening, send the message below to whoever is on call.
        </p>

        {process.env.NODE_ENV === "development" ? (
          <pre className="rounded-tile bg-surface text-ink-soft mx-auto mt-5 max-w-xl overflow-x-auto px-4 py-3 text-left text-xs">
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
