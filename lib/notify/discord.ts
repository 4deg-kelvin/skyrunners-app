/**
 * ============================================================================
 * Direct messages to one person, from the club's Discord bot
 * ============================================================================
 *
 * ---------------------------------------------------------------------------
 * A DM, not a channel
 * ---------------------------------------------------------------------------
 *
 * `docs/INTEGRATIONS.md` recommends webhooks over a bot for most things, and
 * that stands — for posting to a channel. This is the exception: **a webhook
 * cannot DM anybody.** Only a bot can, and a DM is what these events want.
 *
 * A channel that fires on every club event gets muted inside a week, and a
 * muted channel is worse than no channel: it looks like notification coverage
 * and delivers none. A DM reaches exactly the person who has to act, and
 * nobody else has to filter it.
 *
 * ---------------------------------------------------------------------------
 * Everything here is optional and everything here is silent
 * ---------------------------------------------------------------------------
 *
 * Three things have to be true before a message is sent: the bot token is
 * configured, the recipient has saved their Discord id, and Discord accepts
 * the request. Any of them being false is a no-op, not an error.
 *
 * That's not laziness — it's the only safe shape. These are called from Server
 * Actions **after the write has already committed**. A member who logs hours
 * must not see "couldn't save that" because Discord was rate-limiting, and an
 * RE must not fail to approve a join request because somebody typed their
 * Discord id wrong. The notification is a courtesy on top of the real work,
 * and it is never allowed to become a reason the real work failed.
 *
 * Failures go to the server log, where somebody debugging can find them, and
 * nowhere near the user.
 *
 * ---------------------------------------------------------------------------
 * Setup
 * ---------------------------------------------------------------------------
 *
 * See `docs/INTEGRATIONS.md`. In short: a bot application, its token in
 * `DISCORD_BOT_TOKEN`, and the bot invited to the club's server — Discord
 * refuses a DM to somebody who shares no server with the bot.
 */

const API = "https://discord.com/api/v10";

/** Present only when the club has set the integration up. */
function botToken(): string | null {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  return token ? token : null;
}

/** Whether DMs are configured at all. Used to explain the UI honestly. */
export function discordIsConfigured(): boolean {
  return botToken() !== null;
}

async function call(
  path: string,
  body: unknown,
  token: string
): Promise<Response> {
  return fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    // Never let a slow Discord hold a Server Action open. The write is already
    // committed; the message is not worth waiting on.
    signal: AbortSignal.timeout(5_000),
  });
}

/**
 * DM one member. Resolves to whether it was actually delivered.
 *
 * Two calls, because Discord has no "send to user" endpoint: open (or reuse) a
 * DM channel with them, then post into it.
 */
export async function sendDiscordDM(
  discordUserId: string | undefined,
  content: string
): Promise<boolean> {
  const token = botToken();
  if (!token || !discordUserId) return false;

  try {
    const channel = await call(
      "/users/@me/channels",
      { recipient_id: discordUserId },
      token
    );

    if (!channel.ok) {
      /*
        The commonest cause by far is that the recipient shares no server with
        the bot, or has DMs from server members turned off. Both are the
        member's setting to change, not a bug — so this is logged and dropped
        rather than surfaced or retried.
      */
      console.warn(
        `[discord] couldn't open a DM with ${discordUserId}: ${channel.status}`
      );
      return false;
    }

    const { id } = (await channel.json()) as { id: string };
    const sent = await call(`/channels/${id}/messages`, { content }, token);

    if (!sent.ok) {
      console.warn(`[discord] message rejected: ${sent.status}`);
      return false;
    }
    return true;
  } catch (error) {
    // Timeout, DNS, Discord being down. None of it is the member's problem.
    console.warn(`[discord] send failed: ${(error as Error).message}`);
    return false;
  }
}

/**
 * The messages themselves, in one place.
 *
 * Written as complete sentences with the link on its own line, because a
 * Discord notification is read on a phone lock screen with no context. "Kenji
 * Tanaka added you to Wing Spar Redesign" makes sense there; "You were added"
 * does not.
 *
 * `appUrl` is passed in rather than read here so this file stays free of
 * request state and remains trivially testable.
 */
export const discordMessages = {
  addedToProject: (opts: {
    projectName: string;
    addedBy: string;
    url: string;
  }) =>
    `**${opts.addedBy}** added you to **${opts.projectName}**.\n` +
    `You'll see it on My Work, and any deliverables you own there.\n${opts.url}`,

  joinRequestApproved: (opts: { projectName: string; url: string }) =>
    `Your request to join **${opts.projectName}** was approved — you're on it.\n${opts.url}`,

  joinRequestDeclined: (opts: { projectName: string; note?: string }) =>
    `Your request to join **${opts.projectName}** wasn't taken up this time.` +
    (opts.note ? `\n> ${opts.note}` : "") +
    `\nThere's plenty else going — have a look at Find Work.`,

  checkInSubmitted: (opts: {
    memberName: string;
    projectCount: number;
    url: string;
  }) =>
    `**${opts.memberName}** submitted a check-in` +
    (opts.projectCount > 0
      ? ` covering ${opts.projectCount} project${opts.projectCount === 1 ? "" : "s"}`
      : "") +
    `.\n${opts.url}`,

  blockerRaised: (opts: {
    memberName: string;
    projectName: string;
    note: string;
    url: string;
  }) =>
    `**${opts.memberName}** is blocked on **${opts.projectName}**.\n` +
    `> ${opts.note}\n${opts.url}`,
};

/**
 * Why a DM failed, in words the member can act on.
 *
 * Discord's status codes map onto three completely different fixes, and
 * "couldn't send" leaves somebody guessing which. 50007 in particular is the
 * one everybody hits and nobody diagnoses: it means the recipient's privacy
 * settings blocked it, not that anything is broken.
 */
export type DiscordProblem =
  "not-configured" | "no-id" | "unknown-user" | "cannot-dm" | "unreachable";

export const DISCORD_PROBLEM_MESSAGE: Record<DiscordProblem, string> = {
  "not-configured":
    "Discord isn't set up for the club yet, so there's nothing to connect to. Nothing for you to do.",
  "no-id": "Add your Discord ID first, then come back and connect.",
  "unknown-user":
    "Discord doesn't recognise that ID. Check you copied your own User ID — turn on Settings → Advanced → Developer Mode, right-click your name, Copy User ID. It's a long number, not your username.",
  "cannot-dm":
    "Discord blocked the message. Two usual causes: you haven't joined the club's Discord server yet, or you have “Allow direct messages from server members” switched off for it (Server menu → Privacy Settings). Fix either and try again.",
  unreachable:
    "Couldn't reach Discord just now. Try again in a moment — nothing is wrong with your ID.",
};

/**
 * Send the member a "you're connected" message and report what happened.
 *
 * Separate from `sendDiscordDM`, which is fire-and-forget and swallows
 * everything. This one is the opposite: the member is standing there waiting
 * for an answer, so it distinguishes the failures and hands back which.
 */
export async function verifyDiscordDM(
  discordUserId: string | undefined,
  content: string
): Promise<{ ok: true } | { ok: false; problem: DiscordProblem }> {
  const token = botToken();
  if (!token) return { ok: false, problem: "not-configured" };
  if (!discordUserId) return { ok: false, problem: "no-id" };

  try {
    const channel = await call(
      "/users/@me/channels",
      { recipient_id: discordUserId },
      token
    );

    if (!channel.ok) {
      // 400 with code 50035 is a malformed snowflake; 404 is nobody there.
      // Both mean "that isn't a person", which is a different fix from
      // "that person won't accept messages".
      const problem: DiscordProblem =
        channel.status === 404 || channel.status === 400
          ? "unknown-user"
          : "cannot-dm";
      return { ok: false, problem };
    }

    const { id } = (await channel.json()) as { id: string };
    const sent = await call(`/channels/${id}/messages`, { content }, token);

    // 403 here is Discord's 50007, "cannot send messages to this user" — the
    // recipient shares no server with the bot, or has DMs off.
    if (!sent.ok) return { ok: false, problem: "cannot-dm" };

    return { ok: true };
  } catch {
    return { ok: false, problem: "unreachable" };
  }
}

/** The message that proves the connection works. */
export const DISCORD_TEST_MESSAGE =
  "You're connected. This is the club's HQ bot — you'll get a message here when you're added to a project, when an ask of yours is answered, and (if you're a Lead) when one of your people checks in. Nothing else.";
