# INFRA.md — Server, database and deployment

**Audience:** Kelvin, and any AI agent working on his behalf.

Everything in this document is the infrastructure side. **You should not need to change
application code.** If you think you do, that's a signal worth raising with Anish rather
than editing around — the app is deliberately built to work without any of this in place.

---

## Read this first: the app already runs without you

`lib/env.ts` checks whether Supabase environment variables exist:

| Mode | Trigger | Behaviour |
|---|---|---|
| **Demo** | No env vars | Runs on `lib/mock-data.ts`. No login. Yellow banner. Every page works |
| **Live** | Env vars present | Stanford Google sign-in, real Postgres |

So nothing is broken right now, and nothing is waiting on you in a way that blocks Anish.
Your job is to make live mode work. `lib/data/viewer.ts` is the only file that branches on
the mode; leave it that way.

---

## The two things that will bite immediately

Both are already written as migrations. Both are mandatory. Neither can be tested from
demo mode, which is why they're called out here rather than left to be discovered.

### 1. `0004_rls_policies.sql` — apply before the database holds anything real

The anon key ships inside the browser JavaScript bundle. That's by design and it's safe,
**but only because Row Level Security decides what that key can see.** With RLS off,
anyone who loads the page can read and write every row in every table directly against the
PostgREST endpoint — no login, no Stanford check, no audit trail.

The `CHECK` constraint on `profiles.email` restricts what can be *inserted*, not who can
*select*. It is not a substitute.

### 2. `0005_profile_provisioning.sql` — apply or nobody can sign in

`profiles.id` references `auth.users(id)`. A fresh Google sign-in mints a random auth user
id, and without this migration nothing creates or links a matching profile row. The first
person to sign in would authenticate successfully, find no profile, and land on
`/auth/no-profile`, whose only control is "sign in with a different account" — a total dead
end, for every account, forever.

`0005` links an auth user to their pre-created profile **by email**, which is also what
gives the invite flow its shape: a Lead creates the profile row with someone's Stanford
address, and the halves meet on first sign-in.

**It also contains a commented-out bootstrap block.** Anish needs to exist as an active
Co-Lead before he can invite anyone, and after `0005` every new account is created
inactive. Uncomment that block, put in his real address, run it **before** he first signs
in.

---

## Setup, in order

### 1. Create the Supabase project

Region: US West, closest to Stanford. Note the project ref.

### 2. Apply migrations, in order

```bash
supabase link --project-ref <ref>
supabase db push
```

| Migration | What it does |
|---|---|
| `0001_core_schema.sql` | People, org tree, project tree, work logs, cycle-guard triggers, views |
| `0002_deliverables_terms_commitment.sql` | Deliverables, academic terms, commitment level |
| `0003_join_requests.sql` | RE-controlled membership, join requests |
| `0004_rls_policies.sql` | **Row Level Security** |
| `0005_profile_provisioning.sql` | **Auth-user → profile linking, bootstrap Co-Lead** |

**Never edit a migration that has already run.** Add a new numbered file. An edited
migration puts your database and Anish's permanently out of sync with no way to detect it.

### 3. Verify the schema

```sql
-- Enums must match lib/types.ts exactly. 'co_lead', NOT 'admin' —
-- a mismatch wouldn't throw, it would just make isCoLead() return false
-- forever and silently disable every leadership permission.
select unnest(enum_range(null::global_role));   -- member, lead, co_lead

-- RLS on every table
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;   -- all true

-- Every table has at least one policy
select tablename, count(*) from pg_policies
where schemaname = 'public' group by tablename order by tablename;

-- Cycle guards live (both trees are walked with recursive CTEs, so a cycle
-- would make queries run forever)
update teams set parent_id = id where slug = 'structures';
-- expect: ERROR ... Cycle detected

-- Every project resolves to a division, or it's invisible in the UI
select p.name from projects p
  left join v_project_division d on d.project_id = p.id
  where d.division_id is null;   -- expect no rows
```

### 4. Google OAuth

Authentication → Providers → Google.

- Restrict the Google consent screen to the `stanford.edu` domain
- Redirect URL: `https://<your-domain>/auth/callback`
- Add `http://localhost:3000/auth/callback` too, so Anish can test locally

The domain restriction is enforced in **three** places, deliberately: the consent screen,
`app/auth/callback/route.ts`, and a `CHECK` constraint in `0005`. Don't remove any of them
on the grounds that another exists.

### 5. Seed (development only)

```bash
psql "$DATABASE_URL" -f supabase/seed.sql
```

**Never against production.** It begins with `delete from` on every table.

The seed hardcodes UUIDs derived from strings like `"m-anish"`, so those rows will not
match real auth users. That's fine for a dev database and it's why `0005` links by email
rather than id. Regenerate with `npm run seed:generate` after any schema change.

### 6. Environment variables

`.env.example` lists every key with notes. For Vercel, set them in Project Settings →
Environment Variables.

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public. Protected by RLS — see above |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only.** Bypasses all RLS. Never prefix with `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_APP_URL` | Your production URL. **Set this** — see the proxy note below |
| `RESEND_API_KEY` | Later phase |
| `CRON_SECRET` | Later phase |

> **`NEXT_PUBLIC_APP_URL` matters more than it looks.** The OAuth callback prefers it when
> building the post-sign-in redirect. Behind a proxy or load balancer,
> `request.nextUrl.origin` is the *internal* origin, so without this a successful
> production sign-in can bounce someone to `http://localhost:3000`.

> **These are read at build time in the browser bundle and at runtime on the server.** If
> they're present at runtime but absent at build, the server runs live mode while the
> browser client returns null, and sign-in reports "not configured on this deployment".
> Not an issue on Vercel; worth knowing for container builds.

### 7. Deploy

Vercel is the path of least resistance for Next.js: free tier, per-branch preview URLs,
built-in cron. Anything running Node works.

**Per-branch previews are worth turning on.** Anish is learning and will want to show the
club work in progress without touching production.

---

## The one post-deploy test that matters

Sign in, then **refresh the page.**

If you're still signed in, the session layer works. If you're logged out, the middleware
matcher in `middleware.ts` is wrong — and it will be the only cause.

`middleware.ts` at the repo root refreshes the Supabase access token on every request.
Server Components can't set cookies, so this must happen in middleware. Skip it or break
its matcher and you get a login that appears to work, then randomly signs people out
minutes later, with no error pointing anywhere near the cause.

---

## Things not to do

| Don't | Why |
|---|---|
| **Introduce Prisma** | It connects with elevated privileges and silently bypasses the RLS policies protecting reads. Use the Supabase client, or Drizzle |
| **Disable RLS to fix a "policy violated" error** | That error means a policy is missing, not that RLS is wrong. Add the policy |
| **Use `getSession()` for access decisions** | It trusts the cookie, which is spoofable. Always `getUser()`, which revalidates. The codebase uses `getUser()` everywhere — keep it that way |
| **Move to Firebase/Firestore** | This model is deeply relational: two arbitrarily-nested trees resolved with recursive CTEs, plus members ↔ projects ↔ deliverables ↔ attendance joins. NoSQL would make the core queries painful |
| **Edit `docs/DATA_MODEL.md` to match a schema change you made alone** | The app is built against that document. Raise the change instead |
| **Run `seed.sql` against production** | It deletes everything first |

---

## Later phases you'll own

| Phase | What |
|---|---|
| 7 | Transactional email via Resend: missed check-in nudges, invites |
| 7 | Vercel Cron for scheduled jobs — **only fire when `in_session()` is true**, or students get "you missed your update" emails during finals |

### Vercel Cron on the Hobby plan: once a day, or nothing deploys

`vercel.json` declares one cron, `/api/cron/checkin-reminders` at `30 19 * * *`.
It ran `0 * * * *` for four commits and **every deployment failed** — Hobby
allows at most one run per day, and Vercel rejects the whole deploy rather than
just the cron. The symptom is "my change isn't live", which points nowhere near
`vercel.json`; the giveaway is a red *Vercel* commit status on GitHub saying
"Deployment failed" while CI is green.

Daily is genuinely enough: every check-in is due at 23:59 UTC, so one run at
19:30 with a five-hour window covers the whole club. If a future job really
needs to be more frequent, that's a Pro-plan conversation, not a schedule edit.

The route needs `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` set in Vercel, and
refuses to run without them — see the header of `app/api/cron/checkin-reminders/route.ts`.
| 9 | Supabase Storage buckets for certificates and engineering artifacts, with per-object access control |

---

## Typed queries, when you want them

Once the schema is live:

```bash
supabase gen types typescript --project-id <ref> > lib/database.types.ts
```

Generated types are **snake_case**; `lib/types.ts` is camelCase. Map between them inside
`lib/data/*` — that's the boundary that exists to own it. Don't let snake_case field names
leak into components.

Right now `lib/data/viewer.ts` queries `profiles` untyped, which means a column rename
would compile cleanly and fail only at runtime in live mode. Generating types closes that
gap, and it's the single most useful thing you can hand back to Anish.

---

## Where else to look

| Doc | For |
|---|---|
| `supabase/README.md` | Migration mechanics, views, the one rule |
| `docs/DECISIONS.md` §3 | Why Supabase, and the requirements it has to satisfy |
| `docs/DATA_MODEL.md` | Every table and column, with reasoning |
| `docs/PHASE_PLAN.md` | Build order, marked App vs Infra |
| `CLAUDE.md` | Repo-wide context for AI agents |
