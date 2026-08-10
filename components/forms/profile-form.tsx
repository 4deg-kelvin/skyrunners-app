"use client";

import { ActionForm } from "./action-form";
import { DiscordIdField } from "./discord-id-field";
import { Avatar } from "@/components/ui/avatar";
import { updateProfileAction } from "@/lib/actions";
import type { Member } from "@/lib/types";

/**
 * Your own profile.
 *
 * Everything here is optional, and blank clears it — the same form covers
 * filling it in on day one and fixing it a term later, with no separate
 * "onboarding" flow to maintain.
 *
 * Adding a field later is one input here plus one line in `ProfileEdits`. What
 * is NOT here is deliberate: role, status, who you report to and your email
 * are all absent, so this can never become a way to grant yourself authority.
 * Email in particular is the auth identity — changing it would orphan the
 * account from its Google login.
 */
export function ProfileForm({
  member,
  botLive,
  editingSomeoneElse = false,
}: {
  member: Member;
  /**
   * Whether the club has a Discord bot configured.
   *
   * Passed in rather than read here: `discordIsConfigured()` looks at a
   * server-only env var, and this is a Client Component.
   */
  botLive: boolean;
  /** A Co-Lead fixing another person's details. Changes the copy only. */
  editingSomeoneElse?: boolean;
}) {
  return (
    <ActionForm
      action={updateProfileAction}
      submitLabel="Save profile"
      submittingLabel="Saving…"
      className="space-y-4"
    >
      <input type="hidden" name="memberId" value={member.id} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Goes by{" "}
            <span className="text-ink-muted font-normal">(optional)</span>
          </span>
          <input
            type="text"
            name="preferredName"
            defaultValue={member.preferredName ?? ""}
            placeholder={member.fullName.split(" ")[0]}
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
          <span className="text-ink-muted mt-1 block text-xs">
            What the app calls you. Your full name stays on the roster.
          </span>
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Phone
          </span>
          <input
            type="tel"
            name="phone"
            defaultValue={member.phone ?? ""}
            placeholder="(650) 555-0142"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
          <span className="text-ink-muted mt-1 block text-xs">
            Shown instead of your email wherever people need to reach you. A
            text gets answered; an email waits days.
          </span>
        </label>
      </div>

      {/*
        Discord, with its own verify button and badge — see `DiscordIdField`.

        Not a plain input, and not optional in practice: every notification the
        app sends goes through Discord, so an unconnected member is one the
        club cannot reach. It's the only field here that carries proof.
      */}
      <DiscordIdField
        discordUserId={member.discordUserId}
        verifiedAt={member.discordVerifiedAt}
        botLive={botLive}
        editingSomeoneElse={editingSomeoneElse}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Major
          </span>
          <input
            type="text"
            name="major"
            defaultValue={member.major ?? ""}
            placeholder="Aeronautics & Astronautics"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
        </label>

        <label className="block">
          <span className="text-ink mb-1 block text-sm font-semibold">
            Class year
          </span>
          <input
            type="number"
            name="classYear"
            min="2000"
            max="2100"
            defaultValue={member.classYear ?? ""}
            placeholder="2028"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-ink mb-1 block text-sm font-semibold">
          Skills
        </span>
        <input
          type="text"
          name="skills"
          defaultValue={(member.skills ?? []).join(", ")}
          placeholder="CAD, composites, firmware"
          className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
        />
        <span className="text-ink-muted mt-1 block text-xs">
          Comma-separated. Find Work uses these to put the projects you&apos;d
          help most with at the top, so it&apos;s worth filling in.
        </span>
      </label>

      <label className="block">
        <span className="text-ink mb-1 block text-sm font-semibold">
          Photo link{" "}
          <span className="text-ink-muted font-normal">(optional)</span>
        </span>
        <div className="flex items-center gap-3">
          <Avatar
            name={member.fullName}
            photoUrl={member.photoUrl}
            className="size-11 text-sm"
          />
          <input
            type="url"
            name="photoUrl"
            defaultValue={member.photoUrl ?? ""}
            placeholder="https://…"
            className="rounded-tile border-line bg-card text-ink w-full border px-3 py-2 text-[15px]"
          />
        </div>
        <span className="text-ink-muted mt-1 block text-xs">
          Picked up from your Google account when you first sign in. Paste a
          link to change it — uploads would need file storage, which isn&apos;t
          set up.
        </span>
      </label>

      {editingSomeoneElse ? (
        <p className="text-warn-fg text-sm">
          You&apos;re editing {member.fullName}&apos;s profile, not your own.
        </p>
      ) : null}
    </ActionForm>
  );
}
