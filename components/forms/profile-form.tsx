"use client";

import { ActionForm } from "./action-form";
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
  editingSomeoneElse = false,
}: {
  member: Member;
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
          <span className="mb-1 block text-sm font-semibold text-ink">
            Goes by{" "}
            <span className="font-normal text-ink-muted">(optional)</span>
          </span>
          <input
            type="text"
            name="preferredName"
            defaultValue={member.preferredName ?? ""}
            placeholder={member.fullName.split(" ")[0]}
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          />
          <span className="mt-1 block text-xs text-ink-muted">
            What the app calls you. Your full name stays on the roster.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Phone
          </span>
          <input
            type="tel"
            name="phone"
            defaultValue={member.phone ?? ""}
            placeholder="(650) 555-0142"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          />
          <span className="mt-1 block text-xs text-ink-muted">
            Shown instead of your email wherever people need to reach you. A
            text gets answered; an email waits days.
          </span>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Major
          </span>
          <input
            type="text"
            name="major"
            defaultValue={member.major ?? ""}
            placeholder="Aeronautics & Astronautics"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">
            Class year
          </span>
          <input
            type="number"
            name="classYear"
            min="2000"
            max="2100"
            defaultValue={member.classYear ?? ""}
            placeholder="2028"
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink">
          Skills
        </span>
        <input
          type="text"
          name="skills"
          defaultValue={(member.skills ?? []).join(", ")}
          placeholder="CAD, composites, firmware"
          className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
        />
        <span className="mt-1 block text-xs text-ink-muted">
          Comma-separated. Find Work uses these to put the projects you&apos;d
          help most with at the top, so it&apos;s worth filling in.
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-ink">
          Photo link{" "}
          <span className="font-normal text-ink-muted">(optional)</span>
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
            className="w-full rounded-tile border border-line bg-card px-3 py-2 text-[15px] text-ink"
          />
        </div>
        <span className="mt-1 block text-xs text-ink-muted">
          Picked up from your Google account when you first sign in. Paste a
          link to change it — uploads would need file storage, which isn&apos;t
          set up.
        </span>
      </label>

      {editingSomeoneElse ? (
        <p className="text-sm text-warn-fg">
          You&apos;re editing {member.fullName}&apos;s profile, not your own.
        </p>
      ) : null}
    </ActionForm>
  );
}
