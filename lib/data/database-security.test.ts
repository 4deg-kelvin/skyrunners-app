import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const ids = {
  member: "00000000-0000-0000-0000-000000000001",
  lead: "00000000-0000-0000-0000-000000000002",
  co: "00000000-0000-0000-0000-000000000003",
  inactive: "00000000-0000-0000-0000-000000000004",
};
const sql = (file: string) =>
  readFileSync(
    new URL(`../../supabase/migrations/${file}.sql`, import.meta.url),
    "utf8"
  );

before(async () => {
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table profiles (id uuid primary key, email text, full_name text, global_role text, status text);
    create table teams (id uuid primary key, parent_id uuid, lead_id uuid);
    create table projects (id uuid primary key, parent_id uuid, team_id uuid, primary_re_id uuid);
    create table project_members (project_id uuid, member_id uuid, role text, left_at timestamptz);
    create table deliverables (id uuid primary key default gen_random_uuid(), project_id uuid, owner_id uuid not null, title text, status text default 'open');
    grant select, insert, update, delete on deliverables to authenticated;
    alter table deliverables enable row level security;
    create table schema_migrations (version text primary key);
    create table events (id uuid primary key, created_by uuid, title text, attendee_ids uuid[], repeat_until date);
    grant select, update on events to authenticated;
    grant select, insert, update on profiles, projects, teams, project_members to authenticated;
    alter table profiles enable row level security;
    alter table projects enable row level security;
    create policy projects_read on projects for select to authenticated using (true);
  `);
  // Use the actual pre-existing helper/policy definitions, not looser mocks.
  const original = sql("0004_rls_policies");
  for (const name of [
    "auth_is_member",
    "auth_is_co_lead",
    "auth_is_leadership",
  ]) {
    const definition = original.match(
      new RegExp(`create or replace function ${name}\\(\\)[\\s\\S]*?\\$\\$;`)
    );
    assert.ok(definition);
    await db.exec(definition[0]);
  }
  for (const name of [
    "profiles_read_all",
    "profiles_update_own",
    "profiles_manage_leadership",
    "profiles_insert_leadership",
  ]) {
    const definition = original.match(
      new RegExp(`create policy ${name} on profiles[\\s\\S]*?;`)
    );
    assert.ok(definition);
    await db.exec(definition[0]);
  }
  for (const file of [
    "0051_profile_write_guards",
    "0052_inherited_project_authority",
    "0053_rsvp_write_guard",
    "0057_project_milestones",
  ]) {
    await db.exec(sql(file));
    await db.exec(sql(file)); // Deployment retries must be safe.
  }
  for (const name of [
    "deliverables_read",
    "deliverables_manage",
    "deliverables_owner_update",
  ]) {
    const definition = original.match(
      new RegExp(`create policy ${name} on deliverables[\\s\\S]*?;`)
    );
    assert.ok(definition);
    await db.exec(definition[0]);
  }
  await db.exec(
    "create trigger events_rsvp_guard before update on events for each row execute function events_rsvp_only_touches_attendance()"
  );
});
after(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec(
    "reset role; delete from deliverables; delete from profiles; delete from teams; delete from projects; delete from project_members; delete from events;"
  );
  for (const [name, id] of Object.entries(ids)) {
    await db.query("insert into profiles values ($1, $2, $3, $4, $5)", [
      id,
      `${name}@stanford.edu`,
      name,
      name === "co" ? "co_lead" : name === "lead" ? "lead" : "member",
      name === "inactive" ? "inactive" : "active",
    ]);
  }
});
async function as(name: keyof typeof ids) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    ids[name],
  ]);
  await db.exec("set role authenticated");
}

test("RSVP changes only the caller, never other attendees or recurrence", async () => {
  await db.query(
    "insert into events values ($1, $2, 'Meeting', array[$2, $3]::uuid[], '2026-12-01')",
    [ids.co, ids.lead, ids.inactive]
  );
  await as("member");
  await db.query(
    "update events set attendee_ids = array_append(attendee_ids, $1::uuid)",
    [ids.member]
  );
  await assert.rejects(
    db.query("update events set attendee_ids = array[$1]::uuid[]", [
      ids.member,
    ]),
    /only change your own attendance/
  );
  await assert.rejects(
    db.exec("update events set repeat_until = '2027-12-01'"),
    /Only the organiser/
  );
  await db.query(
    "update events set attendee_ids = array_remove(attendee_ids, $1::uuid)",
    [ids.member]
  );
});

test("organisers retain event edits and inactive users cannot RSVP", async () => {
  await db.query(
    "insert into events values ($1, $2, 'Meeting', array[$2]::uuid[], null)",
    [ids.co, ids.member]
  );
  await as("member");
  await db.exec("update events set title = 'Updated meeting'");
  await as("inactive");
  await assert.rejects(
    db.query(
      "update events set attendee_ids = array_append(attendee_ids, $1::uuid)",
      [ids.inactive]
    ),
    /active membership/
  );
});

test("ordinary profile edits work, but self-promotion and email changes fail", async () => {
  await as("member");
  await db.query("update profiles set full_name = 'Edited' where id = $1", [
    ids.member,
  ]);
  await assert.rejects(
    db.query("update profiles set global_role = 'co_lead' where id = $1", [
      ids.member,
    ]),
    /Only a Co-Lead/
  );
  await assert.rejects(
    db.query("update profiles set email = 'other@stanford.edu' where id = $1", [
      ids.member,
    ]),
    /Only a Co-Lead/
  );
});
test("an inactive user cannot activate themselves", async () => {
  await as("inactive");
  const changed = await db.query(
    "update profiles set status = 'active' where id = $1 returning id",
    [ids.inactive]
  );
  assert.equal(changed.rows.length, 0);
});
test("a Lead can admit, but cannot promote or rewrite the new member", async () => {
  await as("lead");
  await assert.rejects(
    db.query(
      "update profiles set status = 'active', full_name = 'Tampered' where id = $1",
      [ids.inactive]
    ),
    /only a Co-Lead/
  );
  const admitted = await db.query(
    "update profiles set status = 'active' where id = $1 returning id",
    [ids.inactive]
  );
  assert.equal(admitted.rows.length, 1);
  await assert.rejects(
    db.query("update profiles set global_role = 'co_lead' where id = $1", [
      ids.lead,
    ]),
    /Only a Co-Lead/
  );
});
test("a Lead may invite members but cannot mint a privileged account", async () => {
  await as("lead");
  await db.exec(
    "insert into profiles values (gen_random_uuid(), 'new@stanford.edu', 'New', 'member', 'active')"
  );
  await assert.rejects(
    db.exec(
      "insert into profiles values (gen_random_uuid(), 'newlead@stanford.edu', 'New', 'co_lead', 'active')"
    ),
    /Only a Co-Lead/
  );
});
test("Co-Lead administration and trusted auth provisioning remain available", async () => {
  await as("co");
  await db.query("update profiles set global_role = 'lead' where id = $1", [
    ids.member,
  ]);
  await db.exec("reset role");
  await db.query("update profiles set id = gen_random_uuid() where id = $1", [
    ids.member,
  ]);
});
test("division authority inherits through both trees, never sideways", async () => {
  await db.query(
    "insert into teams values ($1, null, $2), ($3, $1, null), ($4, null, null)",
    [ids.co, ids.lead, ids.member, ids.inactive]
  );
  await db.query(
    "insert into projects values ($1, null, $2, null), ($3, $1, null, null), ($4, null, $4, null)",
    [ids.co, ids.member, ids.member, ids.inactive]
  );
  await as("lead");
  const result = await db.query<{
    own: boolean;
    child: boolean;
    sideways: boolean;
  }>(
    "select auth_is_re_for($1) as own, auth_is_re_for($2) as child, auth_is_re_for($3) as sideways",
    [ids.co, ids.member, ids.inactive]
  );
  assert.deepEqual(result.rows[0], { own: true, child: true, sideways: false });
  await db.query(
    "insert into projects values (gen_random_uuid(), $1, null, $2)",
    [ids.member, ids.lead]
  );
  await assert.rejects(
    db.query("insert into projects values (gen_random_uuid(), null, $1, $2)", [
      ids.inactive,
      ids.lead,
    ]),
    /row-level security/
  );
});
test("primary PLs qualify without a membership row; inactive PLs do not", async () => {
  await db.query("insert into projects values ($1, null, null, $2)", [
    ids.co,
    ids.member,
  ]);
  await as("member");
  assert.equal(
    (
      await db.query<{ allowed: boolean }>(
        "select auth_is_re_for($1) as allowed",
        [ids.co]
      )
    ).rows[0].allowed,
    true
  );
  await db.exec("reset role");
  await db.query("update profiles set status = 'inactive' where id = $1", [
    ids.member,
  ]);
  await as("member");
  assert.equal(
    (
      await db.query<{ allowed: boolean }>(
        "select auth_is_re_for($1) as allowed",
        [ids.co]
      )
    ).rows[0].allowed,
    false
  );
});

test("milestone migration preserves existing ownership, rejects assignments and applies inherited RLS", async () => {
  await db.query(
    "insert into projects values ($1, null, null, $2), ($3, $1, null, null)",
    [ids.co, ids.lead, ids.member]
  );
  await db.query(
    "insert into deliverables (project_id,owner_id,title) values ($1,$2,'Owned work')",
    [ids.member, ids.member]
  );
  await as("lead");
  const milestone = await db.query<{ id: string }>(
    "insert into deliverables (project_id,kind,title) values ($1,'milestone','Review') returning id",
    [ids.member]
  );
  const id = milestone.rows[0].id;
  await assert.rejects(
    db.query("update deliverables set owner_id=$1 where id=$2", [
      ids.member,
      id,
    ]),
    /deliverables_kind_owner/
  );
  await assert.rejects(
    db.exec(
      "insert into deliverables (kind,title) values ('deliverable','No owner')"
    ),
    /deliverables_kind_owner|row-level security/
  );
  await assert.rejects(
    db.query(
      "update deliverables set kind='deliverable', owner_id=$1 where id=$2",
      [ids.member, id]
    ),
    /cannot change between/
  );
  await as("member");
  assert.equal(
    (
      await db.query(
        "update deliverables set title='Tampered' where id=$1 returning id",
        [id]
      )
    ).rows.length,
    0
  );
  await assert.rejects(
    db.query(
      "insert into deliverables (project_id,kind,title) values ($1,'milestone','Unauthorized')",
      [ids.member]
    ),
    /row-level security/
  );
  await as("lead");
  assert.equal(
    (
      await db.query(
        "update deliverables set status='done' where id=$1 returning id",
        [id]
      )
    ).rows.length,
    1
  );
});
