# supabase/

Database schema and seed data.

## Files

| File | Purpose |
|---|---|
| `migrations/0001_core_schema.sql` | People, org tree, project tree, work logs, cycle guards, views |
| `migrations/0002_deliverables_terms_commitment.sql` | Deliverables, academic terms, commitment level |
| `migrations/0003_join_requests.sql` | RE-controlled membership, join requests |
| `migrations/0004_rls_policies.sql` | **Row Level Security. Required before real data.** |
| `migrations/0005_profile_provisioning.sql` | **Links auth users to profiles by email. Required or nobody can sign in.** |
| `seed.sql` | Realistic sample data so the app isn't empty in development |

## The one rule

**Never edit a migration that has already run.** Add a new numbered file instead.
Migrations are a history, not a current-state document — editing an applied one puts
your database and your teammate's permanently out of sync, with no way to tell.

## Running it

With the Supabase CLI:

```bash
supabase db push          # apply migrations
psql "$DATABASE_URL" -f supabase/seed.sql   # load sample data (dev only)
```

Or paste each file into the SQL editor in the Supabase dashboard, migrations first.

## Things in `0001` worth knowing about

**Enum strings must match `lib/types.ts` exactly.** `global_role` is
`co_lead | lead | member` — not `admin`. A mismatch there wouldn't throw; it would just
make `isCoLead()` return false forever, silently disabling every leadership permission.
That's the worst kind of bug, so it's worth double-checking.

**Cycle-guard triggers.** Both trees are walked with recursive CTEs, so a cycle
(A parent of B, B parent of A) would make queries run forever. The triggers reject
cycles at write time on `teams.parent_id`, `projects.parent_id`, and
`profiles.lead_id`.

**`v_project_division` climbs the org tree.** A project's `team_id` may point at a
sub-team, so grouping by it directly would hide that project from the projects page
entirely. The view resolves the true Division instead.

**`v_project_re_authority`** materializes inherited RE authority — an RE of a parent
project has authority over every descendant. Use it rather than reimplementing the walk
in application code.

## Row Level Security — in `0004`, and not optional

**Apply `0004_rls_policies.sql` before the database holds anything real.** The anon key
ships in the browser bundle by design; RLS is the only thing deciding what it can read.
With RLS off, any visitor can read and write every row directly against the PostgREST
endpoint — no login, no Stanford check.

The shape, from `docs/DECISIONS.md`:

- **Reads:** open to any authenticated `@stanford.edu` member for projects, teams,
  membership, artifacts, and events — transparency by default
- **Reads, restricted:** `work_logs`, `update_entries`, and engagement data are visible
  only to the member, their Lead chain (`v_lead_chain`), and REs with authority over a
  project they contribute to (`v_project_re_authority`)
- **Writes:** go through Server Actions calling `lib/permissions.ts`. RLS is the safety
  net, not the primary gate

## Keeping types in sync

Once the schema is live, generate types instead of hand-writing them:

```bash
supabase gen types typescript --project-id <id> > lib/database.types.ts
```

Note that generated types are **snake_case** while `lib/types.ts` is camelCase. Map
between them inside `lib/data/*` — that's exactly the boundary that layer exists to
own. Don't let snake_case field names leak into components.
