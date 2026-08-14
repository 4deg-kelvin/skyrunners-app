-- ===========================================================================
-- 0041_calendar_feeds.sql
--
-- One subscribable calendar per member, so club events land in Apple Calendar,
-- Google Calendar or Outlook automatically instead of being retyped.
--
-- ---------------------------------------------------------------------------
-- Why a subscription feed and not an API integration
-- ---------------------------------------------------------------------------
--
-- Because it is the only mechanism that works on all three, and Apple is not
-- optional for a Stanford club.
--
--   * **Apple has no public calendar API.** A server can only write to iCloud
--     over CalDAV using an app-specific password — i.e. by asking members to
--     mint an Apple credential granting full access to their personal calendar
--     and paste it into a student club website. This app will not ask for that.
--   * Google and Microsoft do have real APIs, and they are worth adding for
--     INSTANT push and for reading events back. Both need OAuth apps registered
--     and secrets on the deployment, so neither can be what makes the calendar
--     usable today. See `docs/CALENDAR_INBOUND_SPEC.md`.
--
-- An ICS feed needs no credentials at either end and works identically
-- everywhere. Its honest cost is that refresh cadence belongs to the client:
-- Apple polls in minutes, Outlook in hours, Google slowest of all. The member
-- docs say so rather than implying it is instant.
--
-- ---------------------------------------------------------------------------
-- ONE feed per member, and that is a deliberate constraint
-- ---------------------------------------------------------------------------
--
-- A member who subscribes on their iPhone and in Google Calendar uses the SAME
-- url in both. That is what makes `unique (member_id)` right, and it has a
-- consequence worth stating in the UI: rotating the token disconnects every
-- device at once. The alternative — a token per device — would mean a member
-- revoking a lost phone has to work out which of four opaque strings it held.
-- One url, one revoke, no bookkeeping.
-- ===========================================================================

create table if not exists calendar_feeds (
  id           uuid primary key default gen_random_uuid(),

  -- One per member. See above.
  member_id    uuid not null unique references profiles (id) on delete cascade,

  -- SHA-256 of the token, never the token. Same rule as `mcp_tokens` in 0036: a
  -- leaked database backup must not hand somebody every member's calendar.
  --
  -- Unique because it is what a presented token is looked up BY, and a duplicate
  -- would make that lookup ambiguous.
  token_hash   text not null unique,

  created_at   timestamptz not null default now(),

  -- Set instead of deleting the row, so a member who rotates keeps one feed
  -- record rather than accumulating orphans. A revoked feed answers 404.
  revoked_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- The OBSERVED state goes on `profiles`, not here. This split is deliberate.
-- ---------------------------------------------------------------------------
--
-- The first version of this migration kept `seen_clients` and `last_fetched_at`
-- on `calendar_feeds`, and it could not have worked. The policy below scopes this
-- table to `auth.uid()` — correctly, because the row holds a credential — so a
-- badge reading from here would have been invisible to everybody except its own
-- owner, which is the one person who does not need it.
--
-- The precedent was already in the schema: `profiles.discord_verified_at` is a
-- publicly readable fact, written only after a real delivery, and it powers a
-- public badge. Whether the club can reach somebody is other people's business —
-- that is the whole argument in `components/ui/discord-status.tsx`.
--
-- So the two kinds of data are separated by who needs them:
--
--   calendar_feeds  — the CREDENTIAL. Owner-only, forever.
--   profiles        — the OBSERVATION. Public, like the Discord badge.
--
-- Nothing about the observation is sensitive: it says an Apple device collected
-- a calendar, not what is in it.

alter table profiles
  -- Which calendar apps have actually fetched, e.g. {apple,google}.
  --
  -- A text[] rather than a join table on the same test the schema already applies
  -- to `events.attendee_ids`: written whole, read whole, never queried by
  -- element.
  --
  -- NOT constrained to an enum, deliberately. These strings are parsed from a
  -- User-Agent — someone else's implementation detail — so `other` is a valid
  -- answer and a constraint here would turn "Thunderbird subscribed" into a
  -- failed write on a request the member never sees.
  add column if not exists calendar_clients text[] not null default '{}',

  -- When a calendar app last collected it.
  --
  -- The difference between "subscribed and working" and "pasted somewhere that
  -- never loaded", which is the first thing to ask when a member says their
  -- calendar is empty. Null means nothing has ever fetched.
  add column if not exists calendar_synced_at timestamptz;

comment on column profiles.calendar_clients is
  'Calendar apps observed fetching this member ICS feed. Written by the feed route via the service role; read publicly by the calendar badge. Added 0041.';

-- The only access path that isn't by member: a presented token.
create index if not exists calendar_feeds_token_idx
  on calendar_feeds (token_hash);

alter table calendar_feeds enable row level security;

-- ---------------------------------------------------------------------------
-- RLS: a member sees and manages only their own feed
-- ---------------------------------------------------------------------------
--
-- Narrower than most tables here, and deliberately so. Nothing about somebody
-- else's feed is any of your business, and unlike a project or a check-in there
-- is no transparency argument for it: the token IS the credential, so a readable
-- row is a readable calendar.
--
-- `for all` rather than separate select/insert/update policies, for the reason
-- documented four times in docs/HANDOFF.md section 9: `persistDiff` splits
-- inserts from updates, an upsert never reaches a `for update` policy, and a
-- cascade needs a DELETE policy or it silently matches nothing.
drop policy if exists calendar_feeds_own on calendar_feeds;
create policy calendar_feeds_own on calendar_feeds
  for all to authenticated
  using (member_id = auth.uid())
  with check (member_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Note on how the feed route reads this
-- ---------------------------------------------------------------------------
--
-- The feed is fetched by Apple Calendar, not by a signed-in browser: there is no
-- session and `auth.uid()` is null, so the policy above deliberately does not
-- match. The route therefore reads through the SERVICE ROLE, exactly like the
-- MCP server does for `mcp_tokens` (see the header of `lib/mcp/viewer.ts`), and
-- the token is the whole authentication.
--
-- That is safe here because of what the feed can do, which is nothing: it is
-- read-only, scoped to one member's own events, and exposes no personal record,
-- no reliability and no contact details. It must stay that way. If the feed ever
-- needs to show something private, this decision needs revisiting first.

comment on table calendar_feeds is
  'One ICS subscription per member. Holds only the credential (SHA-256 of the token) and is owner-only. The observable state the badge reports lives on profiles.calendar_clients, because it is public. Added 0041 (2026-08-14).';
