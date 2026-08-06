# supabase/

Database schema and seed data.

## Files

| File | Purpose |
|---|---|
| `migrations/0001_core_schema.sql` | Phase 1: people, org tree, project tree, work logs, cycle guards, views |
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

## Row Level Security

Not in `0001`. RLS policies come with auth, in `0002`, once real user IDs exist to write
policies against. The shape to aim for, from `docs/DECISIONS.md`:

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
