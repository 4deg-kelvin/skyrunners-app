# lib/data — the data-access boundary

**Pages import from here. Pages never import `lib/mock-data.ts` directly.**

That rule is the whole point of this directory, and it buys two things.

## 1. Swapping to Supabase touches only this folder

Every function here is `async`, even though the mock implementation behind it is
synchronous and returns instantly. That's deliberate: when these bodies become real
Postgres queries in Phase 1, the signatures don't change, so no page changes either.

If pages called sync helpers directly, Phase 1 would mean rewriting all six of them.

## 2. One query per page, not one per row

Each function returns a **fully-joined view model** — everything a page needs, already
assembled. A page renders it and nothing else.

The alternative is calling a helper inside a render loop. Against mock data that's a
harmless array scan; against Postgres it's a separate round trip per row (the "N+1
problem"). A roster of 40 members doing two lookups each becomes 81 queries and a page
that takes seconds.

So: **do the joining here, where it can become one SQL query.** Never in a component.

## Layout

| File | Provides |
|---|---|
| `viewer.ts` | Who's signed in, plus the `OrgGraph` the permission module needs |
| `my-work.ts` | The member's own projects, responsibilities, REs, hours, current update |
| `dashboard.ts` | Leadership overview: compliance, review queue, flagged projects |
| `projects.ts` | Division-grouped project tree; single project detail |
| `members.ts` | Roster; single member profile |
| `events.ts` | Upcoming calendar events |

## When you wire up Supabase

1. ~~Add `lib/supabase/server.ts`~~ — done in Phase 1a
2. Replace each function body here with a query — keep the signature and return type
3. **Add the columns you read to `QUERIED_COLUMNS` in `graph.ts`** (see below)
4. Delete `lib/mock-data.ts` once nothing imports it
5. Push the joining into SQL views where it gets hairy (`docs/DATA_MODEL.md` lists the
   views worth creating)

Return types are the contract. If a return type has to change, that's a signal the
page's needs changed — which is fine, just change both together.

`graph.ts` is the worked example — `toMember` / `toProject` show the snake_case →
camelCase mapping, including the one rule that isn't mechanical: Postgres `null` becomes
`undefined` for optional fields, **except** `leadId` and `parentId`, where `null` is
meaningful ("reports to nobody", "top-level project") and both tree walks terminate on it.

## Checking queries without a database

`schema.test.ts` parses `supabase/migrations/*.sql` and asserts every column named in
`QUERIED_COLUMNS` actually exists.

This exists because the rest of the swap has to be written before there's a database to
run it against, and the likeliest mistake by a wide margin is naming — `full_name` typed
as `fullname`, a column renamed in a later migration. PostgREST reports those as a 400 at
runtime, on a page nobody opens until launch day. This turns them into a failed `npm test`
instead.

It checks spelling, not semantics. It cannot tell you a join is wrong or that RLS will hide
the rows — only that the columns are real. That's still the failure it's worth catching
early, and it costs one line per query.

```ts
export const QUERIED_COLUMNS = [
  { table: "profiles", columns: PROFILE_COLUMNS },
  // ...add yours here
];
```
