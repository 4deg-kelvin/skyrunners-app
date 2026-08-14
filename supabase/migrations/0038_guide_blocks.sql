-- ===========================================================================
-- 0038_guide_blocks.sql
--
-- Club-written material on the two guide pages: /getting-started ("New here?")
-- and /leading ("What can a Lead do").
--
-- ---------------------------------------------------------------------------
-- What is DATA here, and what stays in code
-- ---------------------------------------------------------------------------
--
-- Not everything on those pages becomes editable, and the line matters.
--
--   Code  — how the APP works. "Log hours from My Work", "sign-off is what
--           counts", the permission table on /leading. If a Co-Lead could edit
--           those they would drift from the app the moment a feature changed,
--           and a guide that confidently describes a button that no longer
--           exists is worse than no guide.
--
--   Data  — how the CLUB works. Where the Fusion licence comes from, which
--           Google Doc explains the KiCad setup, what a Lead is expected to
--           chase this quarter. The club changes these faster than anybody
--           ships a deploy, which is the same argument that made the trainings
--           catalogue data rather than an enum (CLAUDE.md §9).
--
-- So this table holds the second kind, and the pages render it in a named slot
-- underneath the hard-coded material.
--
-- Ordering: depends on 0001 (profiles). Additive, idempotent.
-- ===========================================================================

create table if not exists guide_blocks (
  id          uuid primary key default gen_random_uuid(),

  -- Which page it appears on. A text check rather than an enum, deliberately:
  -- adding a third guide page should not need a migration that alters a type.
  page        text not null check (page in ('getting_started', 'leading')),

  /*
    'link' points at something outside the app — a Google Doc, a Drive folder,
    a YouTube walkthrough. 'note' is prose the club wants on the page.

    Two kinds rather than one, because they render differently and a link with
    no URL is a dead row. The check constraint below makes that impossible.
  */
  kind        text not null default 'link' check (kind in ('link', 'note')),

  title       text not null,
  -- Optional for a link (one line of "what is this"), the whole point for a note.
  body        text,
  url         text,

  /*
    A heading the club invents — "Software setup", "Shop safety", "Templates".
    Free text, not an enum, for the same reason as `page`. Blank groups under a
    default heading rather than vanishing.
  */
  category    text,

  sort_order  integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Who last touched it, so "who wrote this" is answerable a year later.
  updated_by  uuid references profiles (id) on delete set null,

  -- A link with no URL renders as a dead row on a page new members are told to
  -- trust. Same shape as `project_artifacts_has_target` in 0007.
  constraint guide_blocks_link_has_url check (kind <> 'link' or url is not null),
  constraint guide_blocks_note_has_body check (kind <> 'note' or body is not null)
);

create index if not exists guide_blocks_page_idx
  on guide_blocks (page, sort_order);

-- --------------------------------------------------------------------------
-- RLS
--
-- Read: every signed-in member. These pages ARE the onboarding — a new member
-- has to be able to read them on day one, before they are on any project.
--
-- Write: Co-Leads only. This is the club's official word to new members about
-- how the club works; it is not a wiki. `auth_is_co_lead()` comes from 0004.
-- --------------------------------------------------------------------------

alter table guide_blocks enable row level security;

drop policy if exists guide_blocks_read on guide_blocks;
drop policy if exists guide_blocks_write on guide_blocks;

create policy guide_blocks_read on guide_blocks
  for select to authenticated using (auth_is_member());

create policy guide_blocks_write on guide_blocks
  for all to authenticated using (auth_is_co_lead())
  with check (auth_is_co_lead());

-- ===========================================================================
-- Verify:
--
--   select policyname, cmd from pg_policies
--   where tablename = 'guide_blocks' order by cmd;
--   -- expect ALL (co-lead) and SELECT (any member).
-- ===========================================================================
