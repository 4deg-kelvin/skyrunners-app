-- Project milestones share the deliverable date, history and dependency model.
-- Existing deliverables retain their owner and their sign-off workflow.
alter table deliverables add column if not exists kind text not null default 'deliverable';
alter table deliverables alter column owner_id drop not null;
alter table deliverables drop constraint if exists deliverables_kind_owner;
alter table deliverables add constraint deliverables_kind_owner check (
  (kind = 'deliverable' and owner_id is not null)
  or (kind = 'milestone' and owner_id is null)
);

-- Changing the kind could erase personal credit or turn a checkpoint into an
-- assignment. Creation chooses the kind; ordinary edits never change it.
create or replace function deliverables_keep_kind()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'An item cannot change between a deliverable and a milestone';
  end if;
  return new;
end;
$$;
drop trigger if exists deliverables_keep_kind on deliverables;
create trigger deliverables_keep_kind before update on deliverables
for each row execute function deliverables_keep_kind();

comment on column deliverables.kind is
  'deliverable: one owner; milestone: project checkpoint with no owner. Both participate in project progress and declared dependencies. Milestones never count toward personal delivered work.';

insert into schema_migrations (version) values ('0057_project_milestones')
on conflict (version) do nothing;
