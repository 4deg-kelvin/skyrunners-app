-- ---------------------------------------------------------------------------
-- 0021 — give every existing project a start date
--
-- `createProject` never set `start_date`. The column has existed since 0001,
-- the type has always had the field, and the demo seed uses it — but nothing
-- in the app wrote it, so every project made through the UI has none.
--
-- Nothing surfaced that until now, because nothing drew a span. A Gantt bar
-- needs a left edge, and a project without one renders as an open-ended bar
-- that starts wherever the chart happens to start — which reads as a decision
-- somebody made rather than as missing data.
--
-- Backfilling to TODAY is Anish's call, and it's the honest one available: the
-- real start dates were never recorded and inventing plausible ones would put
-- fiction on a chart people plan against. Every existing project reads as
-- starting the day the timeline shipped, which is at least true of the record.
--
-- LEAST(current_date, target_date) because 0001 carries
--
--     check (target_date is null or start_date is null or target_date >= start_date)
--
-- and a project already past its target — of which there are some — would
-- otherwise fail this statement and roll the whole migration back.
-- ---------------------------------------------------------------------------

update projects
set start_date = least(current_date, coalesce(target_date, current_date))
where start_date is null;

insert into schema_migrations (version)
values ('0021_backfill_project_start_dates')
on conflict (version) do nothing;
