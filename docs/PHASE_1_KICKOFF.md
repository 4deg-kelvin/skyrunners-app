# Phase 1 Kickoff — Auth and real data

For Anish and @4deg-kelvin, working together.

**Goal:** two real people sign in with their Stanford Google accounts and see themselves in
the roster. No new features — this phase swaps mock data for a real database.

---

## Split the work

Phase 1 divides cleanly, so you can work in parallel without stepping on each other.

| Teammate (infrastructure) | Anish (app) |
|---|---|
| Create the Supabase project | Install `@supabase/supabase-js` and `@supabase/ssr` |
| Run migrations `0001` → `0003` | Write `lib/supabase/client.ts` and `server.ts` |
| Configure Google OAuth, `stanford.edu` only | Write `middleware.ts` |
| Load `supabase/seed.sql` (dev only) | Replace `getViewer()` with the real session |
| Write `0004_rls_policies.sql` | Replace the other `lib/data/*` bodies with queries |
| Set up Vercel + env vars | Build the sign-in page and invite-acceptance flow |

Meet in the middle at `.env.local`. **Never commit it** — `.env.example` lists every key
that's needed.

---

## The one thing that will silently break everything

**`middleware.ts` is not optional.** `@supabase/ssr` refreshes the auth session there. Skip
it and you'll get a login that appears to work, then randomly logs people out, with no
useful error. Write it in the first hour, not the last.

```ts
// middleware.ts — at the repo root, NOT in app/
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

Follow the current Supabase Next.js App Router guide for `updateSession` — it's the one
piece worth copying verbatim rather than improvising.

---

## Order of operations

### 1. Infrastructure first (teammate)

```bash
# In the Supabase dashboard: create the project, then
supabase link --project-ref <ref>
supabase db push                      # applies 0001, 0002, 0003
psql "$DATABASE_URL" -f supabase/seed.sql   # dev only
```

Then Authentication → Providers → Google. Restrict the Google consent screen to the
`stanford.edu` domain. **That restriction is the access-control model** — `profiles` also
has a `CHECK` constraint on the email domain as a second line of defence.

### 2. Verify the schema did what it should

```sql
-- Every project must resolve to a division, or it's invisible in the UI
select p.name from projects p
  left join v_project_division d on d.project_id = p.id
  where d.division_id is null;
-- expect: no rows

-- The enum must match lib/types.ts exactly
select unnest(enum_range(null::global_role));
-- expect: member, lead, co_lead   (NOT 'admin')

-- Cycle guards live
update teams set parent_id = id where slug = 'structures';
-- expect: ERROR ... Cycle detected
```

### 3. App wiring (Anish)

```bash
npm i @supabase/supabase-js @supabase/ssr
```

Create in this order:

1. `lib/supabase/client.ts` — browser client
2. `lib/supabase/server.ts` — server client, reads cookies
3. `lib/supabase/middleware.ts` — the `updateSession` helper
4. `middleware.ts` at the root
5. `app/login/page.tsx` — one "Sign in with Stanford Google" button

Then replace `getViewer()` in `lib/data/viewer.ts`. **Do that one first and stop.** If
`/my-work` renders with your real name, the hardest part is done.

### 4. Swap the data layer, one file at a time

Order matters — go by how much depends on each:

`viewer.ts` → `members.ts` → `projects.ts` → `my-work.ts` → `dashboard.ts` → `events.ts`

After each file: `npm run check`, load the page, confirm it still looks right. **Keep the
function signatures and return types identical.** That's the whole reason the boundary
exists — if you find yourself changing a return type, the page will need changing too, and
you've lost the benefit.

### 5. RLS (teammate, once real user IDs exist)

`0004_rls_policies.sql`. The shape, from `docs/DECISIONS.md`:

- **Open to any authenticated member:** `profiles`, `teams`, `projects`, `project_members`,
  `deliverables`, `project_artifacts`, `events`, `terms`, `join_requests`
- **Restricted to self + Lead chain + REs with authority:** `work_logs`,
  `update_entries`, `progress_updates`
- **Writes:** go through Server Actions calling `lib/permissions.ts`. RLS is the safety net,
  not the primary gate

The views `v_lead_chain` and `v_project_re_authority` already exist so policies don't have
to reimplement the tree walks.

---

## Done when

- [ ] Two real people sign in with Stanford Google
- [ ] A non-Stanford Google account is refused
- [ ] `/my-work` shows the signed-in person's real name and projects
- [ ] The roster lists real profiles from Postgres
- [ ] `lib/mock-data.ts` is deleted and `npm run check` still passes
- [ ] Refreshing the page keeps you logged in (this is the middleware test)
- [ ] Deployed to Vercel and reachable at a real URL

---

## Beginner-friendly notes

**Do this on a branch.** `git checkout -b feature/phase-1-auth`. Auth is the easiest thing
to half-break, and a branch means `main` always runs.

**When something fails, read the whole error.** Supabase errors are usually specific —
"JWT expired", "row-level security policy violated", "relation does not exist" each point
somewhere precise. Paste the entire message when asking for help, not a summary.

**Two errors you'll almost certainly hit:**

| Error | Cause |
|---|---|
| Logged out on refresh | `middleware.ts` missing or its matcher is wrong |
| `new row violates row-level security policy` | RLS is on with no policy for that table yet. Expected before `0004` — add the policy, don't disable RLS |

**Don't rush deleting `lib/mock-data.ts`.** Keeping it until every page is switched over
means you always have a working reference for what the shape is supposed to be.

---

## After Phase 1

Straight into **Phase 2** — project artifacts, the ask-to-join flow, and the find-work
view. That's the phase worth showing the club, and everything in Phase 1 exists to make it
possible.

See `docs/PHASE_PLAN.md`.
