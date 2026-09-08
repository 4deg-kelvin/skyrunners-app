-- RLS grants rows, not columns. The original own-profile UPDATE policy allowed
-- changing global_role or activating an inactive account through PostgREST.
-- Keep normal profile edits and leadership admission, but guard authority and
-- login identity in the database as well as in the Server Actions.

create or replace function profiles_guard_authority()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Auth provisioning runs inside an existing SECURITY DEFINER trigger and
  -- must still relink invited profiles to the Google auth UUID. Service-role
  -- maintenance also remains possible. Never base this bypass on auth.uid()
  -- being null: that would exempt anonymous API callers.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.global_role <> 'member' and not auth_is_co_lead() then
      raise exception 'Only a Co-Lead can invite someone with a leadership or advisor role.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if auth_is_co_lead() then return new; end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.global_role is distinct from old.global_role then
    raise exception 'Only a Co-Lead can change account identity or roles.'
      using errcode = '42501';
  end if;

  if old.id = auth.uid() then
    if old.status <> 'active' or new.status is distinct from old.status then
      raise exception 'Only leadership can activate an account; you cannot change your own status.'
        using errcode = '42501';
    end if;
  elsif not (
    auth_is_leadership() and old.status = 'inactive' and new.status = 'active'
    and (to_jsonb(new) - 'status' - 'updated_at') = (to_jsonb(old) - 'status' - 'updated_at')
  ) then
    raise exception 'You may admit this member, but only a Co-Lead can edit their profile.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_authority_guard on profiles;
create trigger profiles_authority_guard
  before insert or update on profiles
  for each row execute function profiles_guard_authority();

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles
  for update to authenticated
  using (id = auth.uid() and status = 'active')
  with check (id = auth.uid() and status = 'active');

-- The app permits a Lead to admit a new member. Previously only Co-Leads had
-- the database UPDATE policy, so the ordinary Lead's button failed.
drop policy if exists profiles_admit_leadership on profiles;
create policy profiles_admit_leadership on profiles
  for update to authenticated
  using (auth_is_leadership() and status = 'inactive' and id <> auth.uid())
  with check (auth_is_leadership() and status = 'active' and id <> auth.uid());

insert into schema_migrations (version) values ('0051_profile_write_guards')
on conflict (version) do nothing;
