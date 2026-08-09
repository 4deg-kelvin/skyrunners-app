-- ---------------------------------------------------------------------------
-- 0025 — a member's Discord id, so the app can DM them
--
-- Notifications are in-app only, which means somebody added to a project finds
-- out the next time they happen to open the site. For the events that matter —
-- you've been put on something, your ask was answered, one of your people just
-- checked in — that's too late to be useful.
--
-- A DM rather than a channel post, deliberately. A channel that fires on every
-- club event gets muted inside a week, and a muted channel is worse than no
-- channel: it looks like notification coverage and delivers none. A DM arrives
-- for exactly the person who needs to act, and nobody else sees it.
--
-- Nullable and opt-in. A member who never fills it in simply gets nothing
-- extra, and every path checks for it — see `lib/notify/discord.ts`.
--
-- Stored as text, not a number: Discord snowflakes are 64-bit and JavaScript
-- rounds those past 2^53. `"1234567890123456789"` survives; 1234567890123456789
-- silently becomes a different id.
-- ---------------------------------------------------------------------------

alter table profiles
  add column if not exists discord_user_id text;

-- Digits only, 17-20 of them. Catches the commonest paste errors — a username
-- like "anish#0001", or the whole "<@1234...>" mention wrapper.
alter table profiles
  drop constraint if exists profiles_discord_user_id_check;
alter table profiles
  add constraint profiles_discord_user_id_check
  check (discord_user_id is null or discord_user_id ~ '^[0-9]{17,20}$');

insert into schema_migrations (version)
values ('0025_discord_user_id')
on conflict (version) do nothing;
