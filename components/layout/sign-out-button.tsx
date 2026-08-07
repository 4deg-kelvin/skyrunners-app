"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton({
  label = "Sign out",
  variant = "secondary",
}: {
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    const supabase = createClient();
    await supabase?.auth.signOut();
    // `refresh()` as well as `push()` — without it, cached Server Component
    // output can still show the signed-out user's name.
    router.push("/login");
    router.refresh();
  }

  return (
    <Button variant={variant} onClick={signOut} disabled={pending}>
      {pending ? "Signing out…" : label}
    </Button>
  );
}
