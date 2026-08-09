-- ---------------------------------------------------------------------------
-- 0026 — proof that a member's Discord ID actually reaches them
--
-- 0025 added `discord_user_id`. Having one is not the same as being reachable:
-- a typo'd snowflake, a member who never joined the club's Discord server, or
-- anyone with "allow DMs from server members" switched off all produce an ID
-- that looks correct and silently delivers nothing.
--
-- That's the worst state to be in — worse than no ID at all — because the app
-- and the member both believe notifications are working. So an ID only counts
-- once the bot has successfully sent to it, and this column is the receipt.
--
-- Cleared whenever the ID changes (see `updateProfile`), because a new ID is
-- an unproven one.
-- ---------------------------------------------------------------------------

alter table profiles
  add column if not exists discord_verified_at timestamptz;

insert into schema_migrations (version)
values ('0026_discord_verified')
on conflict (version) do nothing;
