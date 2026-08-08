# Where the build actually is

**Updated 2026-08-07.** One page. If you read nothing else, read this.

For the forward-looking roadmap see [`PHASE_PLAN.md`](PHASE_PLAN.md); for the *why* behind
the product decisions see [`DECISIONS.md`](DECISIONS.md).

---

## The one-sentence version

Everything works end to end on local data. **The only thing standing between this and
real use is the Supabase URL and anon key.**

---

## What the club can do today

Every one of these is wired, persists across restarts, and enforces permissions.

| A member can | An RE can | A Lead can |
|---|---|---|
| Find work ranked by where they'd help most | Add a deliverable and assign an owner | See a queue of only *their* reports' check-ins |
| **Ask to join** — a real, tracked request | Answer join requests, with a reason | See which of their Leads are leaving people unheard |
| Follow projects without joining | Sign off finished work, or send it back | See compliance and hours for their subtree only |
| Log hours (7-day backdating) | Remove a member — their open work is flagged, not lost | |
| Mark work done, or flag a blocker | | |

Persistence is a JSON file at `.data/store.json` (see
[`lib/store/disk.ts`](../lib/store/disk.ts)). Deliberately temporary, deliberately
local-only — **it cannot run on Vercel**, and it exists so feature work didn't have to wait
on infrastructure.

---

## What is blocked, and on exactly what

**Nothing is blocked on credentials any more. It's blocked on one SQL run.**

The Supabase project exists and the publishable key works — verified 2026-08-08. But
**no migrations have been applied**: every table returns `PGRST205 "Could not find the
table"`. Check for yourself at any time:

```bash
npm run db:check
```

### Fixing it — about two minutes

1. Generate the combined script (already committed, but regenerate if migrations change):

   ```bash
   npm run db:bundle
   ```

2. Open `supabase/APPLY_ALL.sql`, copy all of it.
3. Supabase Dashboard → **SQL Editor** → **New query** → paste → **Run**.
4. Confirm with `npm run db:check`. It should report all 15 tables present.
5. Uncomment the two Supabase lines in `.env.local` and restart `npm run dev`.

The keys sit in `.env.local` **commented out on purpose**. Uncommenting them before the
migrations exist would swap a working demo app for a completely broken live one — every
page failing, because there is nothing to read.

Then, and only then, the Phase 1d data-layer swap becomes verifiable work.

Once they land, the swap is mechanical and already de-risked:

1. Replace the twelve `lib/data/*` function bodies with queries. Signatures don't change,
   so no page changes. [`lib/data/graph.ts`](../lib/data/graph.ts) is the worked example.
2. Replace the bodies in [`lib/store/operations.ts`](../lib/store/operations.ts) with
   inserts and updates. The rules and validation are already settled and tested.
3. Delete `lib/mock-data.ts` and `lib/store/`.

[`lib/data/schema.test.ts`](../lib/data/schema.test.ts) parses the migration SQL and
asserts every column name and all eight enums match `lib/types.ts` — so the most likely
mistake in step 1 fails `npm test` rather than becoming a 400 on launch day.

---

## Migrations

`0001`–`0005` were written earlier. Two were added on 2026-08-07:

- **`0006_bootstrap_co_lead.sql`** — makes anish25@stanford.edu a Co-Lead. Idempotent and
  safe to run at any time. Supersedes the commented-out block at the end of `0005`, which
  must NOT be uncommented now.
- **`0007_updates_artifacts_events.sql`** — creates `progress_updates`, `update_entries`,
  `project_artifacts` and `events`. **These four were rendered by the app but existed in no
  migration**, which is why `my-work`, `dashboard`, `events` and `find-work` could not be
  ported. It ends with a *STILL TO DO*: RLS is enabled but only the "members see their own"
  policies are written, so a Lead cannot yet read the reports they're meant to review.

---

## Why pushing doesn't update the website

Pushing to a feature branch does not deploy. Vercel only publishes the **production
branch**, which is `main`; every other branch gets its own throwaway preview URL. So work
on `claude/*` will never appear on the club's site, by design — that's what makes it safe
to keep building while people are using it.

To get a change live:

```bash
git checkout main && git merge claude/test-env-concurrent-dev-696b41 && git push
```

Vercel picks that up and redeploys within a minute or two.

**You also need access to the Vercel project itself** — for environment variables,
rollbacks and deploy logs, none of which live in this repo. Ask Kelvin to invite you:
Vercel → the project → Settings → Members. Until then you can push code but cannot see
whether it deployed, which is the worst of both.

Two environment variables must be set in Vercel or live mode will not work there, no
matter what is in your local `.env.local`:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ldijsmcnjrihwvxtypqy.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the `sb_publishable_…` key |

Do **not** set `SKYRUNNERS_TEST_ENV` there. It's ignored in live mode anyway, but leaving
it unset means nobody has to reason about that.

## Known gaps

Honest list, in rough priority order.

1. **Lead-chain and RE read policies in RLS.** Without them live mode denies too much.
   Denying too much is recoverable; granting too much is not, which is why it's this way.
2. **Writing a check-in.** Reading, reviewing and escalating all work; composing the
   twice-weekly update itself is still Phase 7, and deliberately paper-prototyped first.
3. **Bulk week entry for hours.** Single entry works; catching up a whole week is one
   entry at a time.
4. **`.data/store.json` does not survive a deploy.** Local only, by design.

---

## Before the club logs in

None of this is code, and all of it matters more than any feature. Full version in
[`PHASE_PLAN.md`](PHASE_PLAN.md).

1. **Apply `0006`** or nobody can invite anyone.
2. **Enter real data** — 5 divisions, ~20 projects, 35 members. 4–8 hours, and it belongs
   to the Co-Leads, not to Anish. An empty project tree is worse than the Google Doc it
   replaces.
3. **Spot-check RLS.** Sign in as a plain member and try to read someone else's hours. If
   rows come back, stop.
4. **Kill one incumbent completely.** If the project list still lives in Notion, this app
   is a second place to look, and it dies.
