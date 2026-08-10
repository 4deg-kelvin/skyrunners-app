-- ---------------------------------------------------------------------------
-- 0030 — the club's Discord invite link
--
-- ---------------------------------------------------------------------------
-- Data, not a constant, for the same reason the club's name is
-- ---------------------------------------------------------------------------
--
-- An invite link is not permanent by nature. Discord's default expires after
-- seven days, anybody with Manage Server can revoke one, and a server that
-- gets raided regenerates all of them. Hard-coding it means the day it stops
-- working is a deploy, and in the meantime every new member follows a dead
-- link on the page whose entire job is getting them set up.
--
-- So a Co-Lead pastes the current one into Settings and it appears everywhere
-- at once — the getting-started guide and the "you haven't connected Discord"
-- banner. Same reasoning as `club_name` (0023), the trainings catalogue and
-- the commitment tiers: the club changes faster than anyone ships.
--
-- ---------------------------------------------------------------------------
-- Why the CHECK is not paranoia
-- ---------------------------------------------------------------------------
--
-- This value renders as a link in a banner on every page, for every member,
-- and specifically to the people who are newest and most likely to click
-- whatever they are told to. A typo is harmless; a pasted phishing URL is not.
-- The constraint keeps it to Discord's own two invite hosts, so the worst a
-- mistake can do is point at the wrong server.
-- ---------------------------------------------------------------------------

alter table club_settings
  add column if not exists discord_invite_url text;

alter table club_settings
  drop constraint if exists club_settings_discord_invite_url_check;

alter table club_settings
  add constraint club_settings_discord_invite_url_check check (
    discord_invite_url is null
    or discord_invite_url ~ '^https://(discord\.gg|discord\.com/invite)/[A-Za-z0-9-]+$'
  );

insert into schema_migrations (version)
values ('0030_discord_invite_url')
on conflict (version) do nothing;
