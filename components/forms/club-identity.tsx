"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

import { ActionForm } from "./action-form";
import { updateClubIdentityAction } from "@/lib/actions";

/**
 * Rename the club.
 *
 * Small, but it was the one fact about the club nobody could change: the name
 * and description were a hard-coded literal in `lib/mock-data.ts` that rendered
 * on the dashboard in live mode. Fine while the only club was the one the code
 * was written for; wrong the moment anybody forks it, and wrong now that every
 * other piece of club configuration — divisions, terms, the trainings
 * catalogue, the commitment tiers — is editable from the UI.
 *
 * Deliberately NOT folded into the tier editor next to it. Renaming is
 * cosmetic and reversible; moving the tier floors changes how every member is
 * described. One form for both would invite doing the second while meaning the
 * first.
 */
export function ClubIdentityForm({
  name,
  description,
  discordInviteUrl,
}: {
  name: string;
  description: string;
  /** The club's Discord invite. Empty until a Co-Lead pastes one in. */
  discordInviteUrl?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-tile border-line text-ink hover:bg-surface inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm font-semibold"
      >
        <Pencil className="size-3.5" strokeWidth={2.5} />
        Edit
      </button>
    );
  }

  return (
    <ActionForm
      action={updateClubIdentityAction}
      submitLabel="Save"
      submittingLabel="Saving…"
      onSuccess={() => setOpen(false)}
      className="rounded-tile border-line bg-surface mt-3 w-full border p-3.5 text-left"
    >
      <label className="block">
        <span className="text-ink mb-1 block text-sm font-semibold">Name</span>
        <input
          type="text"
          name="clubName"
          required
          maxLength={80}
          defaultValue={name}
          className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-ink mb-1 block text-sm font-semibold">
          What the club does{" "}
          <span className="text-ink-muted font-normal">(optional)</span>
        </span>
        <input
          type="text"
          name="clubDescription"
          defaultValue={description}
          placeholder="Drone delivery, GPS-denied autonomy, and aircraft design."
          className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-ink mb-1 block text-sm font-semibold">
          Discord invite link{" "}
          <span className="text-ink-muted font-normal">(optional)</span>
        </span>
        <input
          type="url"
          name="discordInviteUrl"
          defaultValue={discordInviteUrl ?? ""}
          placeholder="https://discord.gg/xxxxxxx"
          className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-sm"
        />
        <span className="text-ink-muted mt-1 block text-xs">
          Turns &ldquo;ask a Co-Lead for the link&rdquo; into a button, on the
          new-member guide and on the connect-Discord banner. Make it a{" "}
          <span className="text-ink font-semibold">permanent</span> one:
          right-click the channel →{" "}
          <span className="text-ink font-semibold">Invite People</span> →{" "}
          <span className="text-ink font-semibold">Edit invite link</span> →
          expire <span className="text-ink font-semibold">Never</span>, uses{" "}
          <span className="text-ink font-semibold">No limit</span>. Discord
          defaults to seven days, which is how a dead link ends up on the page
          new members are told to follow.
        </span>
      </label>

      <p className="text-ink-muted mt-3 mb-2.5 text-xs">
        The name is used everywhere the club is named — the header, every
        browser tab, and the dashboard. The sign-in page keeps the built-in
        name, since it renders before anybody is signed in to read settings for.
      </p>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-muted hover:text-ink ml-5 text-sm font-semibold"
      >
        Cancel
      </button>
    </ActionForm>
  );
}
