-- ===========================================================================
-- 0035_storage_buckets.sql
--
-- File storage, finally. Two buckets, deliberately different.
--
--   project-docs  PRIVATE. Engineering documents attached to a project.
--   avatars       PUBLIC.  Profile photos.
--
-- Why they differ, since "just make both public" is the tempting shortcut:
--
--   A profile photo is already effectively public — `profiles.photo_url` has
--   held a Google avatar URL since 0012, and those are unauthenticated URLs
--   anyone can fetch. A public avatars bucket changes nothing about who can
--   see a member's face, and it avoids re-minting a signed URL for every face
--   on the roster page on every render.
--
--   An engineering document is NOT already public. `project_artifacts_read_all`
--   requires an authenticated Stanford session today, and a public bucket would
--   quietly downgrade that to "anyone who ever sees the URL, forever". Loosening
--   a boundary later is easy; tightening one is impossible, because every URL
--   already handed out keeps working. So: private, read through short-lived
--   signed URLs minted per request in `lib/data/projects.ts`.
--
-- BOTH are capped at 512 KB server-side. The app checks the same number before
-- uploading, but a client-side limit is a courtesy, not a control — this is
-- the one that holds. Supabase enforces `file_size_limit` and
-- `allowed_mime_types` at the storage API, so a hand-rolled request can't get
-- past them either.
--
-- Ordering: depends on 0001 (profiles), 0007 (project_artifacts) and 0034
-- (auth_is_committed_to). Idempotent — safe to re-run.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. The buckets
-- --------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-docs',
  'project-docs',
  false,
  524288,                                    -- 512 KB
  array[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    -- STEP files have no registered MIME type and browsers send this for any
    -- extension they don't know. Excluding it would reject the exact format
    -- this feature was asked for.
    'application/octet-stream'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  524288,                                    -- 512 KB
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- --------------------------------------------------------------------------
-- 2. Reading the project id out of an object path
--
-- Path convention is `<project_id>/<artifact_id>-<filename>`, so the first
-- folder segment IS the project the policies need to check against.
--
-- Wrapped in an exception handler rather than casting inline, because a
-- straight `(storage.foldername(name))[1]::uuid` raises on any object whose
-- first segment isn't a UUID — and a raising policy fails the whole statement
-- instead of just denying that row.
-- --------------------------------------------------------------------------

create or replace function storage_project_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = public, storage
as $$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception
  when others then return null;
end;
$$;

-- --------------------------------------------------------------------------
-- 3. project-docs policies
--
-- Mirrors `project_artifacts` in 0034, one level down: anyone committed to the
-- project may add, only an RE may remove, and a Co-Lead alone once the project
-- is complete. Deliberately the same shape, because a file the row points at
-- and the row itself becoming separately reachable is how you end up with
-- orphaned documents nobody can see and nobody can delete.
-- --------------------------------------------------------------------------

drop policy if exists project_docs_read on storage.objects;
drop policy if exists project_docs_insert on storage.objects;
drop policy if exists project_docs_delete on storage.objects;

-- Any signed-in member, same as reading the artifact row. Activity is
-- transparent; this is the file behind a row they can already see.
create policy project_docs_read on storage.objects
  for select to authenticated
  using (bucket_id = 'project-docs' and auth_is_member());

create policy project_docs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-docs'
    and storage_project_id(name) is not null
    and (
      auth_is_re_for(storage_project_id(name))
      or auth_is_committed_to(storage_project_id(name))
    )
  );

create policy project_docs_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-docs'
    and storage_project_id(name) is not null
    and (
      auth_is_co_lead()
      or (
        auth_is_re_for(storage_project_id(name))
        and not exists (
          select 1 from projects p
          where p.id = storage_project_id(name) and p.phase = 'complete'
        )
      )
    )
  );

-- --------------------------------------------------------------------------
-- 4. avatars policies
--
-- Path convention is `<member_id>/<filename>`, so the folder IS the owner.
-- Reading is open because the bucket is public; these three cover writes.
--
-- Nobody can write into somebody else's folder — including a Co-Lead. Changing
-- another member's photo isn't an administrative need, it's an impersonation
-- vector, and there is no case for it.
-- --------------------------------------------------------------------------

drop policy if exists avatars_insert on storage.objects;
drop policy if exists avatars_update on storage.objects;
drop policy if exists avatars_delete on storage.objects;

create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- --------------------------------------------------------------------------
-- 5. Where an uploaded document lives
--
-- `file_url` cannot hold this. The bucket is private, so there is no permanent
-- URL to store — only a path we sign on demand. Putting a path in a column
-- called `_url` would mean every reader has to guess which of the two it got,
-- and `ArtifactList` renders `fileUrl` straight into an href.
--
-- The existing constraint requires a link OR a file; an upload is now a third
-- way to satisfy it.
-- --------------------------------------------------------------------------

alter table project_artifacts
  add column if not exists storage_path text;

alter table project_artifacts
  drop constraint if exists project_artifacts_has_target;

alter table project_artifacts
  add constraint project_artifacts_has_target check (
    file_url is not null
    or external_url is not null
    or storage_path is not null
  );

-- ===========================================================================
-- Verify:
--
--   select id, public, file_size_limit from storage.buckets
--   where id in ('project-docs', 'avatars');
--   -- project-docs: public=false, 524288.  avatars: public=true, 524288.
--
--   select policyname, cmd from pg_policies
--   where tablename = 'objects' and schemaname = 'storage'
--     and policyname like any (array['project_docs%', 'avatars%']);
--   -- expect 6: 3 project_docs (select/insert/delete), 3 avatars
--   --           (insert/update/delete).
-- ===========================================================================
