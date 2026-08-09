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
