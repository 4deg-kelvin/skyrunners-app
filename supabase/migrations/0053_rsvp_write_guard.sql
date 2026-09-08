-- RSVP must only add/remove the caller. The original trigger allowed replacing
-- everyone's attendance and omitted later recurrence columns from its guard.
create or replace function events_rsvp_only_touches_attendance()
returns trigger language plpgsql security invoker set search_path = public
as $$
begin
  -- Preserve trusted service-role operations, including the MCP backend.
  if current_user not in ('anon', 'authenticated') then return new; end if;
  if not auth_is_member() then
    raise exception 'An active membership is required.' using errcode = '42501';
  end if;
  if auth_is_leadership() or old.created_by = auth.uid() then return new; end if;

  -- Comparing the record protects new columns automatically, including the
  -- recurrence fields from 0043. updated_at may be maintained by a trigger.
  if (to_jsonb(new) - 'attendee_ids' - 'updated_at')
     is distinct from (to_jsonb(old) - 'attendee_ids' - 'updated_at') then
    raise exception 'Only the organiser can change this event. You can add or remove yourself from it.'
      using errcode = '42501';
  end if;
  if array(select distinct v from unnest(coalesce(new.attendee_ids, '{}'::uuid[])) v where v <> auth.uid() order by v)
     is distinct from
     array(select distinct v from unnest(coalesce(old.attendee_ids, '{}'::uuid[])) v where v <> auth.uid() order by v) then
    raise exception 'You can only change your own attendance.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Keep the existing trigger binding from 0024.
insert into schema_migrations (version) values ('0053_rsvp_write_guard')
on conflict (version) do nothing;
