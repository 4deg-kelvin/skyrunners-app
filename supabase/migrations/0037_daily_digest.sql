-- ===========================================================================
-- 0037_daily_digest.sql
--
-- Bookkeeping for the daily Discord digest that REs and Leads receive.
--
-- Two columns on `profiles`, both about the SAME failure: a bot that says too
-- much gets muted, and a muted bot is worse than no bot, because everything
-- else the club sends goes with it.
--
--   daily_digest_opt_out   somebody decided they don't want it.
--   daily_digest_sent_on   the last day one actually went out.
--
-- Ordering: depends on 0001 (profiles). Additive, idempotent.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- The off switch
--
-- Opt-OUT rather than opt-in, deliberately. The digest is for people holding
-- responsibility — an RE whose project has gone quiet, a Lead whose report is
-- blocked — and those are exactly the people who won't go and enable a feature
-- they've never seen. Default on, one checkbox in Settings to stop it.
--
-- A plain member who is neither an RE nor a Lead never receives one at all, so
-- this column is irrelevant to most of the club.
-- --------------------------------------------------------------------------

alter table profiles
  add column if not exists daily_digest_opt_out boolean not null default false;

-- --------------------------------------------------------------------------
-- Send-once memory
--
-- A DATE, not a timestamp: the question is "has today's gone out", and a
-- timestamp invites arithmetic that gets timezones wrong. The club runs on
-- Pacific and the database is UTC, so the value written is the club-time day
-- from `todayInClubTime()`, never `now()::date`.
--
-- Written BEFORE the DM, same as `reminder_sent_at` in 0027: a crash between
-- the two costs one missed digest, where the other order costs a duplicate on
-- every retry. Missing one is much cheaper than a bot that repeats itself.
-- --------------------------------------------------------------------------

alter table profiles
  add column if not exists daily_digest_sent_on date;

-- Anyone who hasn't had today's yet, cheaply.
create index if not exists profiles_digest_idx
  on profiles (daily_digest_sent_on)
  where daily_digest_opt_out = false;

-- ===========================================================================
-- Verify:
--
--   select column_name, data_type, column_default
--   from information_schema.columns
--   where table_name = 'profiles'
--     and column_name like 'daily_digest%';
--   -- expect two: boolean default false, and date.
-- ===========================================================================
