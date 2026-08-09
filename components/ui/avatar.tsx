"use client";

import { useState } from "react";

import { initials } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * A member's photo, with initials behind it.
 *
 * ---------------------------------------------------------------------------
 * Why this is a component and not three copies of an `<img>`
 * ---------------------------------------------------------------------------
 *
 * It was three copies, and all three were broken in the same two ways.
 *
 * **1. Google avatars 403 on hotlink.** Nearly every photo in this app comes
 * from `lh3.googleusercontent.com`, captured at first sign-in by migration
 * 0012. Google refuses those requests when the browser sends a `Referer`
 * header from another origin — so the URL is perfectly valid, the profile
 * shows a broken-image icon, and nothing in the app is wrong.
 * `referrerPolicy="no-referrer"` is the fix and it has to be on the tag.
 *
 * **2. There was no fallback.** A URL that 404s, an avatar deleted from a
 * Google account, or a pasted link that rots all rendered the browser's broken
 * icon on top of the initials that were supposed to be the fallback. Initials
 * are only a fallback if failure actually reaches them, and `onError` needs a
 * client component — which is why this one exists.
 *
 * Server components can render it directly; it takes no handlers as props.
 */
export function Avatar({
  name,
  photoUrl,
  className,
  imageClassName,
}: {
  name: string;
  photoUrl?: string;
  /** Sizing and text size for the initials circle. */
  className?: string;
  imageClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-cardinal-50 font-bold text-cardinal-600",
        className
      )}
    >
      {photoUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt=""
          // Not decorative vanity: without this, Google returns 403 and the
          // photo silently breaks for most of the club.
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className={cn("size-full rounded-full object-cover", imageClassName)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
