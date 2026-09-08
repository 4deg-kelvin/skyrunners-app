-- Match lib/permissions.ts: project authority includes every ancestor PL and
-- the leads of owning teams/divisions. The original SQL helper knew only PL
-- memberships, so a Division Lead's app-permitted edits failed in PostgREST.

create or replace function auth_leads_team_at_or_above(target_team uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  with recursive ancestors as (
    select id, parent_id, lead_id from teams where id = target_team
    union
    select t.id, t.parent_id, t.lead_id from teams t
    join ancestors a on t.id = a.parent_id
  )
  select auth_is_member() and exists (
    select 1 from ancestors where lead_id = auth.uid()
  );
$$;

create or replace function auth_is_re_for(target_project uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  with recursive ancestors as (
    select id, parent_id, team_id, primary_re_id from projects where id = target_project
    union
    select p.id, p.parent_id, p.team_id, p.primary_re_id from projects p
    join ancestors a on p.id = a.parent_id
  )
  select auth_is_member() and (
    auth_is_co_lead()
    or exists (select 1 from ancestors where primary_re_id = auth.uid())
    or exists (
      select 1 from project_members m join ancestors a on a.id = m.project_id
      where m.member_id = auth.uid() and m.role = 're' and m.left_at is null
    )
    or exists (select 1 from ancestors where auth_leads_team_at_or_above(team_id))
  );
$$;

drop policy if exists projects_insert on projects;
create policy projects_insert on projects
  for insert to authenticated with check (
    auth_is_member() and (
      auth_is_co_lead()
      or case when parent_id is not null then auth_is_re_for(parent_id)
              else auth_leads_team_at_or_above(team_id) end
    )
  );

insert into schema_migrations (version) values ('0052_inherited_project_authority')
on conflict (version) do nothing;
