# Shipping to the club while still building

**Written:** 2026-08-07. **Owner of everything in §2:** Kelvin.

The goal: 35 people use the app for real, while Anish keeps merging changes daily
and nobody's data gets destroyed by a half-finished feature.

---

## The shape of it

```
main   ──────●────────●────────●─────▶   skyrunners.vercel.app     the club
             ▲        ▲        ▲          production Supabase
             │ merge  │        │
dev    ──●───●──●──●──●──●──●──●─────▶   dev-skyrunners.vercel.app  us
         ▲                                staging Supabase
         │
      feature branches
```

One rule: **`main` is what the club is using right now.** Nothing lands there
that hasn't been used by a human first.

---

## 1. What has to be true before anyone logs in

Not deploy config — these are the things that decide whether it survives contact.

- [ ] **`0006_bootstrap_co_lead.sql` is applied**, or nobody can invite anyone.
      Everything else waits on this.
- [ ] **The "Ask to join" button works.** Right now
      [`find-work/page.tsx:232`](../app/(app)/find-work/page.tsx) renders a
      button with no handler — clicking it does nothing, silently. `/find-work`
      is the point of the whole app; shipping a dead button on it teaches 35
      people the app is broken, and you get one first impression. The RE `mailto:`
      links beside it do work, so this is *degraded*, not useless — but fix it
      first.
- [ ] **Someone has entered real data.** An empty project tree is worse than the
      Google Doc it replaces. `PHASE_PLAN.md` §"Before the club ever logs in"
      estimates 4–8 hours and assigns it to the Co-Leads, not Anish.
- [ ] **RLS (`0004`) is applied and spot-checked.** The anon key ships in the
      browser bundle. Sign in as a plain member and try to read another member's
      hours — if it returns rows, stop and fix it before launch, not after.

---

## 2. Infrastructure — Kelvin

### Two Vercel environments

| Branch | Deploys to | Who uses it |
|---|---|---|
| `main` | Production domain | The club |
| `dev` | Preview URL | Anish and Kelvin |

In Vercel: **Settings → Git → Production Branch = `main`**. Every other branch
gets a preview URL automatically. Nothing else to configure.

### The database question — the one real decision

**Recommendation: two Supabase projects.** `skyrunners-prod` and
`skyrunners-dev`, with the dev one's env vars bound to preview deployments only.

It costs a second free-tier project and ten minutes. Against that: with one
shared database, the first destructive migration Anish tests — a renamed column,
a dropped constraint — happens to the club's live data, on a Tuesday, while
people are using it. There is no undo, and the failure mode is "everyone's hours
vanished".

Keep them in sync by applying the same migration files to both, dev first. The
`supabase/migrations/` directory is the source of truth; never hand-edit a table
in one dashboard and not the other.

If two projects is genuinely not workable, say so and we'll design around it —
but then **no schema change goes to prod without a `pg_dump` taken first.**

### Environment variables

| Variable | Production | Preview |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | prod project | dev project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | prod project | dev project |
| `SUPABASE_SERVICE_ROLE_KEY` | prod project | dev project |
| `NEXT_PUBLIC_APP_URL` | real domain | preview URL |
| `SKYRUNNERS_TEST_ENV` | **never set** | never set |

`SKYRUNNERS_TEST_ENV` is local-only. It is ignored anywhere Supabase keys exist
(see `lib/test-env/README.md`), so setting it on Vercel does nothing — but leave
it unset so nobody has to reason about that.

### Add the preview URL to Google OAuth

Supabase → Authentication → URL Configuration → **Redirect URLs**. Add the
preview domain alongside production, or sign-in on the dev deployment fails with
a redirect mismatch and it looks like an app bug.

---

## 3. Day-to-day — Anish

```bash
git checkout dev && git pull
git checkout -b feature/hours-logging
# ...build...
npm run check
```

Merge to `dev`, look at the preview URL, and only then open a PR into `main`.

**Before every merge to `main`:**

1. `npm run check` passes
2. You have clicked through the change on the dev preview *as a Member*, not just
   as yourself — the test env personas exist for this, and the Co-Lead view hides
   most permission bugs because it can see everything
3. If it includes a migration, it has been applied to dev **and** you have
   confirmed prod's data survives it

### Shipping something half-finished

Merge it, but don't link it in the nav. A page nobody can navigate to is safe;
`components/layout/coming-soon.tsx` already exists for the placeholder. This
beats a long-lived branch, which turns into a painful merge and stops getting
tested.

---

## 4. When it goes wrong

**Bad deploy.** Vercel → Deployments → the last good one → **Promote to
Production**. Seconds, no git needed. Do this first and diagnose afterwards.

**Bad migration.** Not revertable by promoting a deployment — the schema already
changed. This is why prod gets a `pg_dump` before any schema change, and why dev
goes first.

**Someone reports a bug.** Reproduce it on the dev preview as *their* persona
before changing anything. Most "bugs" here will be permission surprises, and
permissions look completely different from a Co-Lead account.

---

## 5. What this deliberately doesn't do

- **No staging branch between `dev` and `main`.** Two people don't need three
  environments; it would just be a queue nobody looks at.
- **No feature flags.** Real ones need a service and a UI. Not linking a page in
  the nav gets 90% of the benefit at zero cost, and can be revisited when a
  change is too big to hide that way.
- **No blue/green or canary.** Vercel's instant rollback covers the same failure
  for a 35-person club.
