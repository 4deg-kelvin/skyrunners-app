-- ---------------------------------------------------------------------------
-- 0023 — a third kind of project notice, and an editable club identity
--
-- 1. `re_paused`
--
-- The standing "No deputy RE" warning is gone (see `projectAttentionFlags`).
-- It fired on every parent project with one RE, which in a club this size is
-- most of them, most of the time — and there is frequently no second person to
-- name, so it was permanent and unactionable. A warning like that teaches
-- people to ignore the flags beside it.
--
-- The risk it pointed at is real though, so it's covered at the three moments
-- it actually bites:
--
--   * the RE goes quiet          -> folded into `re_silent`, severity raised
--   * somebody tries to remove   -> `wouldStrandSubProjects` refuses
--   * the RE takes a pause       -> THIS, a notice to their Lead
--
-- The pause case is the one with no other signal at all: an academic pause is
-- a good thing the app actively encourages, and it silently leaves a subtree
-- with nobody able to unblock it. The member isn't doing anything wrong, so
-- nothing is shown to them — their Lead is simply told, and can name a deputy.
--
-- 2. `club_settings.name` / `.description`
--
-- These were a hard-coded literal in `lib/mock-data.ts` rendering in live mode,
-- so the club's own name was the one thing about it nobody could change.
-- ---------------------------------------------------------------------------

alter table project_notices
  drop constraint if exists project_notices_kind_check;

alter table project_notices
  add constraint project_notices_kind_check
  check (kind in ('completed', 'reopened', 're_paused'));

-- --------------------------------------------------------------------------
-- Club identity, alongside the commitment tiers already in this table.
--
-- Nullable with no default: `lib/mock-data.ts` holds the fallback, so an
-- un-edited club keeps reading exactly as it does today and this migration
-- changes nothing visible.
-- --------------------------------------------------------------------------
alter table club_settings
  add column if not exists club_name text,
  add column if not exists club_description text;

insert into schema_migrations (version)
values ('0023_re_paused_notice')
on conflict (version) do nothing;
