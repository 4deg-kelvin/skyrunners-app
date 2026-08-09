import { Mail, Phone } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Member } from "@/lib/types";

/**
 * How to reach someone. Phone first, email only as a fallback.
 *
 * ---------------------------------------------------------------------------
 * Why phone over email
 * ---------------------------------------------------------------------------
 *
 * `/find-work` is the point of the app, and it only works if a member actually
 * makes contact with an RE. A student emailing another student about joining a
 * project waits days for a reply, if it comes at all — a text gets answered.
 * The whole page is wasted if the last step is the one that stalls.
 *
 * Email is still on the record: it's the auth identity, and it's the fallback
 * here. It just isn't the thing we put in front of people.
 *
 * ---------------------------------------------------------------------------
 * Why this is a component and not a string helper
 * ---------------------------------------------------------------------------
 *
 * Phone is optional, so every call site needs the same fallback decision, the
 * same icon swap, and the same `tel:` vs `mailto:` scheme. Four sites doing that
 * by hand is four chances to render `tel:undefined` — which looks like a working
 * link and silently dials nothing.
 */
export function ContactLink({
  member,
  /** Only used for the email fallback; `tel:` links can't carry a subject. */
  subject,
  showLabel = true,
  className,
}: {
  member: Pick<Member, "fullName" | "email" | "phone">;
  subject?: string;
  /**
   * False drops the NAME, never the number.
   *
   * It used to drop the number instead, leaving a bare name that happened to
   * be a link — so on Find Work and the help board you had to click a person's
   * name to discover it was a phone number at all, and you couldn't read it off
   * the screen to type into a phone. Since the whole reason this component
   * leads with phone is that a text gets answered and an email doesn't, hiding
   * the digits removed the point of it. Call sites that already show the name
   * above pass false and get just the number.
   */
  showLabel?: boolean;
  className?: string;
}) {
  const style = cn(
    "inline-flex items-center gap-1.5 text-sm font-semibold text-cardinal-600 hover:text-cardinal-700",
    className
  );

  if (member.phone) {
    return (
      <a
        // Strip formatting: `tel:` wants digits, and a dialler handed
        // "(650) 555-0107" may either fail or dial the wrong thing.
        href={`tel:${member.phone.replace(/[^\d+]/g, "")}`}
        className={style}
      >
        <Phone className="size-3.5 shrink-0" />
        {showLabel ? `${member.fullName} · ${member.phone}` : member.phone}
      </a>
    );
  }

  return (
    <a
      href={
        subject
          ? `mailto:${member.email}?subject=${encodeURIComponent(subject)}`
          : `mailto:${member.email}`
      }
      className={style}
    >
      <Mail className="size-3.5 shrink-0" />
      {showLabel ? `${member.fullName} · ${member.email}` : member.email}
    </a>
  );
}
