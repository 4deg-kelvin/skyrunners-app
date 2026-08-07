"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { ALLOWED_EMAIL_DOMAIN } from "@/lib/env";

/**
 * Kicks off Google OAuth.
 *
 * `hd` (hosted domain) pre-filters the Google account chooser to Stanford
 * accounts. It's a convenience, not a security boundary — a determined user can
 * strip it, which is why the domain is checked again on callback and enforced by
 * a database constraint.
 */
export function GoogleSignInButton({ next }: { next?: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signIn() {
    setPending(true);
    setFailed(false);

    const supabase = createClient();
    if (!supabase) {
      setFailed(true);
      setPending(false);
      return;
    }

    const callback = new URL("/auth/callback", window.location.origin);
    if (next) callback.searchParams.set("next", next);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
        queryParams: {
          hd: ALLOWED_EMAIL_DOMAIN,
          // Always show the chooser. Students often have a personal Google
          // account signed in, and silently using it would fail the domain check
          // with no explanation.
          prompt: "select_account",
        },
      },
    });

    if (error) {
      setFailed(true);
      setPending(false);
    }
    // On success the browser navigates away, so there's nothing to reset.
  }

  return (
    <div>
      <Button onClick={signIn} disabled={pending} className="w-full">
        {pending ? "Opening Google…" : "Sign in with Stanford Google"}
      </Button>
      {failed ? (
        <p className="mt-3 text-sm font-medium text-risk-fg">
          Couldn&apos;t reach Google. Check your connection and try again.
        </p>
      ) : null}
    </div>
  );
}
