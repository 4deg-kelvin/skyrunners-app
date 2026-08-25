# Handoff — read this first

**Written 2026-08-08, last revised 2026-08-24.** Everything a fresh session
needs. Written for someone with no memory of how any of this came to be.

**The largest change since it was written is the reporting removal (2026-08-24)**
— nobody reports to anybody and check-ins are gone. Item 1 below is the summary;
`docs/REPORTING_REMOVAL_PLAN.md` is the full reasoning. Anything in this document
that mentions a Lead reading somebody's report is history, and says so where it
matters.

**"Outstanding, in order" near the bottom** is what is actually left to do.

---
## Picking up right now? Read this box first

1. ~~**Remove the reporting chain.**~~ **Done 2026-08-24.** The biggest change
   this app has had: about 6,000 lines. Nobody reports to anybody, check-ins are
   gone, and members report to their PLs through the work they log on a project.
   Read the section in CLAUDE.md, then `docs/REPORTING_REMOVAL_PLAN.md` for why
   each decision went the way it did.

   **Three things to know before touching any of it:**

   - **`profiles.lead_id` still exists and nothing reads it.** So do
     `progress_updates.lead_id_at_submission` and the whole `update_schedules`
     table. Deliberate — the club could revisit this and a dropped column can't
     be un-dropped. `teams.lead_id` is different: it is LIVE and load-bearing,
     because leading a division makes you a top PL inside it.
   - **`lib/quiet.ts` is the mitigation, not a nice-to-have.** The chain's real
     function was that somebody was *named* as responsible for noticing silence.
     Per-project "gone quiet" is what replaced that, and if it gets weakened the
     removal loses the thing that made it safe.
   - **Migrations `0044`–`0049` were applied on 2026-08-25.** The
     trainings-verifier feature is live. They were written to ship WITHOUT the
     migration and switch on when it landed, which is why the deploy order was
     never load-bearing — keep that pattern for anything touching a table the
     snapshot reads with an explicit column list.

2. ~~**Remove the hour-tracking system.**~~ **Done 2026-08-14**, migration
   `0039`. The work log is a diary: `WorkLog` has no `hours` and its
   `description` is required. The Core / Committed / Contributing tiers are
   deleted. `docs/HOURS_REMOVAL_PLAN.md` records what shipped.

   The check-in auto-draft that made this removal *add* something has itself been
   removed with check-ins. What replaced it is smaller and better: the log line
   IS the report now, so there is nothing to draft.

3. ~~**Build out the Discord notifications.**~~ **Done 2026-08-24.** Seven new
   DMs and five new digest sections; `docs/INTEGRATIONS.md` has the full table
   and the rules each one obeys. Three things worth knowing:

   - **Only 5 of 12 members have a Discord id**, so none of it reaches the
     other seven. That number is now the ceiling on every notification in the
     app, and raising it is worth more than any further feature here.
   - **The weekly sections are a weekday check inside the one cron**, not a
     second cron. Vercel Hobby allows two slots at one run per day each and
     rejects the whole *deployment* when a schedule breaks that.
   - **Section order is load-bearing.** The clamp trims from the bottom, so the
     roll call goes last. Found by rendering the real fixture, not by reading
     the code: the only overflowing digest was the Co-Lead's, and what it lost
     was the Monday-only quiet section.

4. **Rewrite the two guide pages in detail** — /getting-started and /leading.
   The editable container for club material shipped (migration 0038,
   /settings/guides); the built-in content still needs expanding. Both were
   rewritten again for the reporting removal, so they're accurate but still thin.

Everything below is the older, still-accurate orientation.

---

## Where things actually are

The app is **live on Supabase** at `skyrunners-app.vercel.app` — note the
`-app`; `skyrunners.vercel.app` is somebody else's site and probing it to check
a deploy gives a confident wrong answer. Real Google sign-in, real Postgres,
migrations `0001`–`0049` applied. **Phases 0–8 are built** — my work, find work, projects,
members, deliverables and sign-off, terms, trainings and
facility access, and the calendar. There is no phase 9+ scoped yet beyond the
one item under "What's next".

The club is **deliberately empty** — three Co-Leads (Anish, Jonathan, Kelvin),
no projects, no divisions. It gets populated through the app, not a seed script.
That was Anish's explicit decision: a clean sheet, organised from scratch.

```bash
npm run db:check        # is the database really there?
PW=<db-password> npm run verify:live   # does every page work on real data?
```

**Somebody should still add a term, but it stopped being urgent.** With no
terms, `inSession` is false for every date, so the app cannot say what period the
club is in. Until 2026-08-24 this was much worse — it silently generated no
check-ins for anybody, which was the one setup step with no visible symptom, and
is why the dashboard says so in a banner. Settings → Academic Calendar.

`verify:live` is the one that matters. It loads the whole database and calls the
`lib/data/*` function behind every route, plus the two pages that call several
in parallel. As of now: **all 21 pass**.

Before every push, in this order:

```bash
npm run check       # typecheck + lint + dead-control sweep + 389 tests
npm run build:check # NEVER `npm run build` while dev is up — see Traps
```

Then commit, merge into `main`, push, and confirm
`git rev-list --left-right --count main...origin/main` reads `0 0`. Vercel
deploys on push, so pushing IS deploying. Twenty-one commits once sat unpushed
while Vercel rebuilt old code; three debugging rounds went into code that
wasn't running.

---

## The incident worth reading first — 2026-08-15

A member connected Claude to the MCP server with a write token and it created
**994 empty projects**. Nothing was bypassed: he leads that division,
`can.createProject` allowed it correctly, and every call was a legitimate action
by an entitled member. The app had no concept of SCALE — every control asked "may
this person do this once?" and none asked "should this happen a thousand times?"

What exists now, and where:

- `MAX_EMPTY_PROJECTS_PER_DAY` in `lib/store/operations.ts` — 25 per person per
  day, counting only projects still carrying no deliverables. In the store layer
  because that is the one write choke point.
- `lib/mcp/rate-limit.ts` — 30 writes/minute, 200/hour per token, across all
  sixteen write tools. In-memory and therefore per-instance: read the header for
  what that is and is not worth.
- Settings → Cleanup, from `emptyProjectsCreatedBy` — a Co-Lead can delete one
  person's shells in batches. It will only ever offer projects with no
  deliverables, documents, log entries, sessions, join requests, notices, deadline
  history, advisors, help requests, update entries or sub-projects, and no
  membership row added by anybody else.
- `projects.created_by` is finally written. It existed from `0001` and was mapped
  nowhere, so attribution had to be reconstructed from `project_members.added_by`.

Full threat model, findings and what is still outstanding:
**`docs/MCP_SECURITY_REVIEW.md`**. Read it before adding an MCP tool or any new
write path.

---

## The fifteen bugs that cost the most time

Read these before debugging anything. Each was invisible in the obvious place.

### 1. Code that was never pushed

Twenty-one commits sat unpushed while Vercel dutifully rebuilt the old code.
Three rounds of "the deployed site is wrong" were spent debugging code that
wasn't running.

**Always check `git rev-list --left-right --count main...origin/main` before
diagnosing anything about the deployed site.**

### 2. Silent fallback to mock data

`readStore()` ended in `liveResolver?.() ?? load()`. When the live snapshot
wasn't loaded it quietly returned the sample club — so the app ran live, sign-in
worked, the demo banner was correctly absent, and every page showed fake people
as real. Nothing looked broken.

Both `readStore()` and `mutate()` now **throw** in live mode rather than fall
back. If you ever feel tempted to reinstate a fallback: a page that lies is
worse than a page that errors.

### 3. Writes resolving outside the request scope

`mutate()` defers onto a module-level promise chain. The live snapshot lives in
React's request-scoped `cache()`. Resolving the backend *inside* the deferred
callback ran a tick later — outside the request — so writes silently went to a
local JSON file while reads came from Postgres. Edits "saved" and vanished.

The backend is now captured **synchronously before** the queue.
`lib/store/live-backend.test.ts` pins it; it fails if you move the resolution
back inside.

### 4. Build-time prerendering baking in fake data

`generateStaticParams` runs at build time with no request and no session, so it
hit the fallback above and prerendered member pages for people who don't exist.
Removed, and `app/(app)` is `force-dynamic`. Static pages went 63 → 8.

### 5. Migrations that could never have run

Applying `0001`–`0007` to a real database surfaced four defects no amount of
reading would have caught: a policy on a table created two migrations later, a
policy on a table that was never created, `drop index` on an index owned by a
constraint, and — the big one — `profiles.id` having a foreign key to
`auth.users`, which made the entire invite flow impossible.

**`npm run db:migrate` is idempotent now** (a `schema_migrations` ledger), so
re-running is a verified no-op.

### 6. The snapshot loading later than the first read

Every page except `/my-work` and `/dashboard` died with "Something broke", and
saving a profile edit failed the same way.

The preload used to be the caller's job, and `getViewer()` was the only caller.
Those two pages happen to `await getViewer()` first. Everything else does

```ts
Promise.all([getRoster(), getRosterOptions(), getViewer()])
```

which starts the reads *before* the preload — so `readStore()` found no snapshot
and threw. Writes broke identically: `updateProfile()` reached `mutate()` with
nothing loaded.

**Anything that reads the store must load it itself.** All 16 functions in
`lib/data/*` now open with `await preloadLiveStore()`. It's idempotent, so call
order stopped being something you can get wrong. If you add a data function, add
that line — `npm run verify:live` is what catches you if you forget.

The general shape of this one: *it worked on the pages I happened to click.*
Two of eleven pages sequenced their calls differently, and that was enough to
make the bug look like a data problem rather than an ordering one.

### 7. `cache()` is render-scoped, so every write failed

Reads worked everywhere. Writes failed everywhere. That split IS the diagnosis.

The per-request snapshot lived in React's `cache()`. React memoizes a cached
function for the duration of a **render**, and a Server Action doesn't run
inside one — so in an action `cache()` returned a fresh object every call.
`getViewer()` loaded the database into one throwaway holder; the write a moment
later asked a second, empty one.

It surfaced as two unrelated-looking failures. Operations that write directly
(role change, reassign lead, deactivate) threw from `mutate()` and showed the
message inline. `createProject` reads the store first to check the slug, so it
threw the *read* error from outside `guarded()` and took the whole page down.

The holder is now anchored to the async execution context (`AsyncLocalStorage`
+ `enterWith`), which renders and actions both have. `enterWith` is the part
worth remembering: it lets a callee establish a scope the caller keeps seeing,
so the ~25 actions didn't each need wrapping.

**If you touch `lib/store/request.ts`, run `lib/store/request-scope.test.ts`.**
Its first test fails against the old holder — that's how this was confirmed
rather than guessed.

**Rule of thumb:** anything that must survive from `getViewer()` to a write
cannot rely on `cache()`. Test it outside a render or you won't see it.

### 8. Controls that existed and were never rendered

Not one bug — a *class* of them, and the most productive thing to go looking
for. An action would be written, tested, exported, and then either wired to
nothing or mounted only on a page nobody reaches it from. It never throws, never
logs, and looks finished in the diff.

A sweep on 2026-08-08 checked **every export of `lib/actions/` against a UI that
actually calls it**, then every exported component against a page that mounts
it. Seven findings, all fixed:

| What | How it failed |
|---|---|
| The PL's join-request queue on a project page | Two plain `Button`s wired to nothing. Pressing either did nothing at all. The working control existed and was mounted only on `/my-work` |
| `FollowToggle` | Built in Phase 2, imported nowhere. The project page even read `isFollowing` to show a badge for a state nothing could produce |
| `withdrawJoinRequest` | An operation with no action and no button. A request sent by mistake was permanent: it sat in the PL's queue, escalated at 5 days, and showed the sender a badge they couldn't clear |
| `deleteHoursAction` | Wired, but no screen listed a single work-log entry, so there was nothing to hang it on. A mistyped `80` for `8.0` was forever |
| Division Lead | Shown on `/projects`, settable nowhere. Neither team form had the field |
| …and worse: `updateTeam` did `team.leadId = input.leadId` | So every **rename** posted an empty value and silently cleared the lead. Pure data loss, invisible at the call site |
| `can.manageDivisions` | A duplicate of `can.manageTeams`, referenced only by its own tests |

**How to run the sweep again** — it's cheap and it keeps finding things:

```bash
for a in $(grep -o 'export async function [a-zA-Z]*' lib/actions/index.ts \
           | sed 's/export async function //'); do
  echo "$a :: $(grep -rl "\b$a\b" app components | tr '\n' ' ')"
done
```

A name with nothing after it is dead. But note the two hardest cases above
passed that grep: the join-request buttons were *rendered but inert*, and
`deleteHoursAction` was *imported by a component with nothing to act on*. So
after the grep, read the render path — "is it imported" and "can a person reach
it" are different questions.

**That sweep is now `npm run sweep`** (`scripts/dead-controls.mjs`), and it runs
inside `npm run check` and in CI. It checks three things with three different
rules: actions must be referenced from `app/` or `components/`, components from
any file including their own, data functions from some *other* file. Keeping
something deliberately unreferenced needs a `// dead-controls: allow <why>`
comment on the line above, so it's a written decision rather than an oversight.

It caught three more on 2026-08-09, all now fixed: `updateEventAction` (no edit
form existed, so moving a session by an hour meant cancelling it — which deletes
the attendee list), `ReopenButton` (written, never imported, so "Mark sorted" was
a one-way door), and four `lib/data` functions nothing called.

### 9. Every `for update` RLS policy was unreachable

The one that reached a real user. A Lead pressing **Mark as read** on somebody's
check-in got:

```
new row violates row-level security policy for table "progress_updates"
```

`progress_updates_review` is an UPDATE policy that permits exactly that action.
The problem was the verb. `persistDiff` upserted every row the diff touched, and
an upsert is `INSERT ... ON CONFLICT DO UPDATE` — so Postgres evaluates the
table's **INSERT** policy `WITH CHECK` even when the row exists and only an
update happens. The only INSERT policy says you may insert a check-in with your
own `member_id`, which is correct and must not be loosened: it's what stops a
Lead filing a report in somebody's name.

So the fix is in the app, not the schema. `persistDiff` now splits the diff:
rows that already exist go out as `UPDATE`, only genuinely new rows insert.
`update_entries_respond_re` had the identical latent bug and would have failed
the first time a PL answered somebody's section.

**The general lesson:** if you add a `for update` policy, an upsert will never
reach it.

**And its bigger sibling, which has now happened four times:** a policy that was
CORRECT when written and got left behind when the feature grew a new audience.
`events_write` said `auth_is_leadership()` from 0007, when the calendar was a
leadership noticeboard — and stayed that way through 0018 turning it into
something members create sessions on and RSVP to. Three app-permitted actions
were refused by Postgres and only one had ever been clicked, so only one was
reported. **Widening who can act in `lib/permissions.ts` does not widen it in
the database.** When a feature grows an audience, re-read its policies.

`lib/data/rls.test.ts` now checks both halves: every cascade has a delete
policy, and the member-facing writes (RSVP, own hours, own join request, own
check-in, own event) aren't leadership-gated.

One follow-up left deliberately undone: **attendance should be an
`event_attendees` join table.** It's a `uuid[]` on the event row, so RSVP is an
UPDATE of the whole row — RLS is per-row, so any policy permitting RSVP also
permits renaming the event, and a BEFORE UPDATE trigger (`events_rsvp_guard`,
migration 0024) is what closes that. The trigger is correct and tested, but the
join table would make the whole problem disappear. `ClubEvent.attendeeIds`
justifies the array as "write-once, read-whole, never queried by attendee" —
which stopped being true the moment attendees started writing to it. `lib/store/persist-diff.test.ts` pins the verb rather than the data,
because asserting on the resulting rows passes either way.

Both this and the `profiles` delete bug (#8's cousin, migration `0019`) have the
same shape — **RLS does not raise when a policy is missing.** The statement
simply matches nothing and PostgREST returns success. Every write path in
`lib/store/supabase.ts` therefore calls `.select()` and treats zero affected rows
as an error naming the likely policy.

### 10. The disk store went stale between the action and the render

Demo mode only, but it wasted a debugging round. `next dev` compiles Server
Actions and the RSC render into **separate module instances**, each with its own
copy of the `cache` in `lib/store/disk.ts`. A save updated the action's copy and
the file; the render kept serving the copy it first loaded, forever. Save,
reload, unchanged — indistinguishable from the write failing.

`load()` now compares the file's `mtime` and re-reads when another instance has
written. Live mode never hit this, because `readStore()` returns the
per-request Postgres snapshot.

### 11. A one-time secret rendered inside the form that closed on success

`ActionForm` renders an action's success message **inside itself**, and
`McpTokens` passed `onSuccess={() => setOpen(false)}`. The MCP token arrives as
the first line of that message, so the form unmounted in the same tick the token
appeared — it rendered and was destroyed before paint. Only the hash is stored,
so **every token minted before the fix was dead on arrival**, and the report was
"I can never see the token when it is made."

`components/forms/calendar-feed.tsx` had it right (capture `result.message` via
`onResult` into state that OUTLIVES the form) and `mcp-tokens.tsx` had it wrong,
in the same codebase, the same week. Only two actions return irreplaceable data
in `message` — `createMcpTokenAction` and `createCalendarFeedAction` — and both
now use `onResult`. If a third ever appears, this is the trap it will fall into.

### 12. Google refuses an ICS feed with zero events, and refuses `webcal://`

Both report *"Validation failed, please edit the URL and try again"*, which names
neither cause. Two separate bugs behind one message:

- **An eventless calendar.** Legal per RFC 5545, refused by Google. It is exactly
  the new-member case, since the feed carries only events you're on. `buildIcs`
  now always emits at least one VEVENT — an all-day, `TRANSP:TRANSPARENT`
  placeholder dated from the feed row's `created_at`, **not** from the stamp,
  which would make the note walk forward a day every time a client polled.
- **The copy button gave out `webcal://`** while the instructions beside it said
  Google needs `https://`. Apple and Outlook take either. Both forms now have
  their own labelled button.

Apple accepts an eventless feed silently, so testing on a Mac proves nothing here.

### 13. Two silent timezone bugs in repeating events

Both found by parsing the real output with `node-ical` rather than by reading it,
which is the lesson: for ICS, **measure the document.** Every failure mode is
silent — a client that dislikes something shows an empty calendar, not an error.

- **`UNTIL` was `<date>T235959Z`** — 23:59:59 *UTC* on the last day. Occurrences
  are club time, so a 5pm Pacific meeting on the final day is 01:00 UTC the day
  after, past the cutoff. Clients dropped the last meeting of every series while
  the website listed it. It bites any event from 5pm onward, which is when a
  student club meets. `rruleFor` now takes the converter injected, exactly as
  `exdatesFor` already did.
- **`DTSTART` was an absolute UTC instant**, so clients expanding the RRULE held
  the UTC time fixed and the *local* time slid an hour at the DST change: a 5pm
  meeting became 4pm from November. Repeating events now emit
  `DTSTART;TZID=America/Los_Angeles` with a `VTIMEZONE`, plus `EXDATE` in the
  same zone — an EXDATE whose value type differs from DTSTART matches nothing and
  cancels nothing. One-offs deliberately keep the absolute form: only a rule can
  drift.

The test that should have caught the first one compared *dates* and passed on a
*time* bug, using a fixture whose comment said "6pm Pacific" while its value was
6pm UTC — late morning Pacific, which never crosses a date boundary. A fake
`toUtc` in the tests agreed with any timezone mistake the real one made.

### 14. Ten views bypassed RLS, and dropping one broke `work_logs`

Two bugs on 2026-08-25, and the second was caused by fixing the first.

**The leak.** Supabase's advisor flagged all ten `v_*` views as CRITICAL
"Security Definer View", and it was right. A view created without
`security_invoker` reads its base tables as the OWNER, so RLS does not apply —
and every view in `public` is exposed over PostgREST. Verified against production
with nothing but the publishable key, the one that ships in the browser bundle:

    GET /rest/v1/projects?select=slug   ->  []       (RLS working)
    GET /rest/v1/v_project_tree         ->  [{...}]  (RLS bypassed)

Eight of ten returned rows to an anonymous caller: project structure, the
reporting chain, PL authority, per-member weekly HOURS, and a contribution record
including `hours_total`. Keyed by UUID, so no names or prose — but hours and the
contribution record are the two things the club spent two removals deciding not
to show even to members.

Fixed in `0048`: `security_invoker = on` on the seven that stay, `revoke select
from anon` on top, and the three the removals had killed (`v_lead_chain`,
`v_member_hours_weekly`, `v_member_contribution`) dropped outright.

**The break.** I checked that no application code read `v_lead_chain` before
dropping it. Wrong thing to check: `auth_can_view_effort()`, a `security definer`
function from `0004`, selects from it, and two RLS policies call that function.
So `select` on `work_logs` and `update_schedules` started failing with
`relation "v_lead_chain" does not exist` — and `work_logs` is in the per-request
snapshot, so that is every page.

**Postgres did not stop me, and that is the transferable part.** It records
dependencies for views on views and for policies on views, so `drop view` normally
errors with "other objects depend on it". A FUNCTION BODY is an opaque string:
nothing is recorded, the drop succeeds, and the failure surfaces at query time.
**Before dropping any view, grep the migrations for its name — `pg_depend` will
not save you.**

It was also intermittent, which is worse than broken. `work_logs` has two SELECT
policies, Postgres OR's them, and SQL guarantees no evaluation order — so it
worked for callers who satisfied the other policy and errored for everyone else.

`0049` repaired it by replacing the policies rather than restoring the view, since
the view implemented a model the club had removed. That surfaced a third thing:
`work_logs_read` was still the *pre-2026-08-16* restriction, so the database and
the app had disagreed about work-log visibility for over a week. Nobody noticed
because the redundant `work_logs_read_project_re` policy covered most reads.

---

### 15. Free text in a DM could silently lose the DM

Two templates quote text straight out of a form — a withdrawal reason and a
reply to a work log:

```ts
`> ${opts.response}\n${opts.url}`   // whatever they typed, verbatim
```

Discord rejects a message over **2000 characters outright**. It does not
truncate for you, and `sendDiscordDM` deliberately only logs a refusal so a DM
can never fail somebody's save. Put those two together and a pasted stack trace
in a reply means the notification vanishes with nobody the wiser — the write
succeeded, the page said "Reply sent", and the person it was for never heard.

Fixed with `quoted()` in `lib/notify/discord.ts`: a 600-character budget per
quote, and newlines collapsed as well, because `> ` quotes only the FIRST line
in Discord's markdown — a multi-line paste renders as one quoted line followed
by unattributed text that reads like the bot talking.

**How it was found is the point.** Not by seeing it happen and not by reading
the template, but by a test that asserted the length with a 5000-character
input. Three tests fail if `quoted()` is removed. Any new template that
interpolates member-supplied text needs the same treatment and the same test —
the failure is invisible from the sending side, which is the whole reason it
survived.

---

## Architecture, in the order it matters

### `lib/store/` — one choke point, two backends

Everything reads through `readStore()` and writes through `mutate()`.

- `disk.ts` — a JSON file under `.data/`. Demo mode. **Cannot work on Vercel.**
- `supabase.ts` — loads a snapshot per request, diffs before/after on write.
- `request.ts` — holds that snapshot in React's `cache()`, per request.
- `mapping.ts` — every table, column and snake↔camel translation, once.

**The bet:** because `mutate()` is a single choke point, the Postgres backend
diffs two snapshots and derives the inserts/updates/deletes itself. None of the
~25 operations in `operations.ts` know Postgres exists, and every test pinning
their rules still covers the real logic.

**Known trade:** two simultaneous writers each diff against their own snapshot,
so the later can revert a field. Blast radius is one field on one row, and the
high-frequency operations append rather than overwrite. Fine for 35 people. The
fix when it isn't is to push operations down into SQL — which is why
`mapping.ts` describes tables rather than hiding them.

### `lib/permissions.ts` — the only place authority is decided

Three questions: Co-Lead? PL of this project or above? Your own data?

There was a fourth — "Lead of this person, or above?" — and it went with the
reporting chain on **2026-08-24** along with `isLeadOfOrAbove` and `leadChain`.
Do not rebuild it; `lib/permissions.test.ts` asserts the five deleted rule names
stay absent.

**Two inheritances, and both run down** — PL authority flows *down* the project
tree, and team-lead authority flows *down* the org tree and then down the project
tree. The one that flowed *up* — over people — is the one that went. That
asymmetry is where the bugs used to be, which is why there are 50+ tests on it.

**A Division Lead is a top PL.** `leadsTeamAbove` folds into `isREofOrAbove`, so
leading a division gives PL powers on every project inside it at any depth,
including sub-projects carrying no `teamId` of their own.

#### Doing the work is not the same right as approving it

Added 2026-08-09, and the one distinction most likely to be flattened by
accident. `isREaboveProject` is `isREofOrAbove` **minus the project's own PL**:
an ancestor project's PL qualifies, so does the Division Lead (who sits above
the project by org position — that's what covers a top-level project with no
parent), and being the project's own PL disqualifies you *even if you would
qualify another way*.

Exactly two rules use it, and both are "review somebody else's work":

| Rule | Who |
|---|---|
| `can.completeProject` | The PL above, or the Division Lead. **Not** the project's own PL |
| `can.withdrawSignOff` | Same. Overturning a sign-off, as opposed to granting one |

Everything else about a project still runs on `isREofOrAbove`, because the
assigned PL has to be able to do their job. Two deliberate asymmetries:

- **Reopening a project runs on `manageProject`, not `completeProject`.** Saying
  something isn't finished always makes the record more conservative, so it
  needs no permission from above.
- **Signing a deliverable off stays with the PL at the project's own level.**
  That's their job. Only *overturning* one escalates.

**Co-Leads are the escape hatch.** Without it, a Co-Lead who is the PL of a
top-level project could never complete it — nobody is above them — and it would
be stuck forever. That fallback is what lets the rule be strict everywhere else.

Role changes are **Co-Lead only**: it's the one permission that can reshape the
permission system. A Co-Lead cannot change their own role, and the last Co-Lead
cannot be demoted or deactivated — both are lock-out guards.

### The privacy model — one line, as of 2026-08-24

**Everything about a member is public**, except archived check-in envelopes,
which are the member's and a Co-Lead's (`can.readArchivedCheckIns`).

| Thing | Who sees it |
|---|---|
| Every log line, project, deliverable, and both delivered counters | **Everyone** |
| Archived check-in envelopes, including `generalNote` | The member and **Co-Leads** |

This table had three rows and a long argument in it. Each row collapsed for a
different reason, and the order matters if you are wondering whether to reopen
any of it:

1. **Hours on one project** went public on 2026-08-16, because the hours
   themselves went on 2026-08-14. The reason for hiding it was that a NUMBER
   invites comparison between volunteers with different course loads. A sentence
   about a project does not, and the project is public.
2. **The personal report and reliability** were deleted outright on 2026-08-24
   rather than rehomed. Reliability measured check-ins filed on time and there
   are no check-ins. Two public counters replaced it.
3. **The one exception got NARROWER, not wider.** A `generalNote` was written
   under a promise that only the member and their Lead chain would read it. Their
   old Lead can no longer read it; a Co-Lead can. Publishing what people already
   typed is the one privacy change that changing it back cannot undo.

---

## Decisions that are settled — don't re-litigate

- **Deliverables are the whole task model.** One flat list, one owner, one date,
  one status. No dependencies, no sub-tasks, no Gantt.
- **No engagement score, no leaderboard, no ranking.** Two plain counts, in the
  side column of a profile. It was three independent signals until 2026-08-24
  and four before that; each shrink deleted something that measured presence
  rather than finished work.
- **Nobody reports to anybody.** Members report to their PLs, through the work
  they log on a project. `docs/REPORTING_REMOVAL_PLAN.md`.
- **Two-step sign-off**: the owner marks `submitted`, a PL confirms `done`.
  Only `done` counts as delivered. Unconfirmed work ages visibly on the PL's
  dashboard, so a quiet PL is visible rather than silently freezing records.
- **Completing a project is a review step, done from above.** The assigned PL
  finishes it; the PL above them or the Division Lead agrees it's done. A
  signed-off deliverable can be rejected from above too, with a mandatory
  reason — and that reopens the project if it was complete, because "the
  engineering doesn't meet requirements" and "the project is done" can't both
  be true.
- **Work inside a project can't be due after the project.** Checked both
  directions and only when a date actually moves, so one legacy violation can't
  freeze every other edit. An undated parent constrains nothing.
- **Work logs backdate 7 days**, and can be deleted within that window.
- **Phone over email** everywhere a human is contacted. Email stays the auth
  identity and the fallback.
- **Everything queue-shaped is on age, not count.** "Waiting 6 days" beats "12
  items". Applies to sign-offs, join requests, help requests, and per-project
  "gone quiet" — the one rule that outlived every specific queue it was written
  for.
- **Never hard-delete people or projects.** Deactivate.

Full reasoning in `docs/DECISIONS.md` and `docs/PRODUCT_REVIEW.md`.

---

## What's next

`docs/OPEN_QUESTIONS.md` has 23 questions with recommended defaults; Anish
answered them all in chat on 2026-08-08, and everything in those answers is now
built. Phases 5–8 shipped on 2026-08-08/09.

### Mini Gantt charts — built 2026-08-09

Two charts, and the distinction between them is the design:

| Where | What's on it |
|---|---|
| Inside each division's deadlines strip on `/projects` | Every project in that division, nested two levels deep |
| The sidebar of a project page | That project, its sub-projects, **and its deliverables as diamonds** |

Deliverables are on the project chart and nowhere else — on the division chart
they'd bury five projects under a hundred markers.

**This is not the critical-path Gantt in the list below.** No dependencies, no
slack, nothing new for a PL to maintain: it draws dates that already exist. The
moment it needs its own upkeep it has become the thing that was rejected. The
header of `lib/gantt.ts` says this at length; read it before adding a field.

Things that are easy to break:

- **The geometry is a pure module** (`lib/gantt.ts`, 15 tests) rather than
  inline in the component, because an off-by-one-day bar looks *slightly* wrong
  and nobody can tell whether the chart or the schedule is lying.
- **Everything parses as UTC.** A bare date is UTC midnight, a datetime is
  LOCAL; mix them and a bar shifts a day, and west of Greenwich a UTC midnight
  formats as the day before.
- **A deliverable is a date, a project is a span.** Deliverables collapse to a
  marker. Giving one a width would invent a duration the model deliberately
  doesn't have.
- **The depth cap reports what it dropped.** The project tree is unbounded; a
  chart that looks complete and isn't is worse than one that admits its limit.

`createProject` now sets `startDate` (clamped to the target, since 0001 checks
`target_date >= start_date`), and migration 0021 backfilled every project that
predated it.

### Explicitly not planned — read the reasoning before reopening

Critical-path Gantt with dependencies, a composite engagement score, a
leaderboard or any ranking function, self-enrollment, a project commitment cap,
purchasing/procurement, and the **quarterly re-enrollment sweep** (dropped
2026-08-08: a 35-person club where everyone has a named Lead doesn't need
memberships auto-closing, and silently dropping somebody is worse than a Lead
glancing at their roster). Email nudges are deferred — notifications are
in-app only for now.

Reasoning lives in `docs/DECISIONS.md` and `docs/PRODUCT_REVIEW.md`.

---

## Traps specific to this environment

- **Never `npm run build` while `npm run dev` is running.** It deletes the
  directory the dev server serves from. Use `npm run build:check`.
- The repo is **CRLF**. In JavaScript `.` does not match `\r`, so a regex ending
  `.*\n` silently never matches on Windows.
- Bash `node -e "…"` **executes backticks** in your string. Markdown is full of
  them. Use the Edit tool for prose.
- The direct `db.<ref>.supabase.co` host is **IPv6-only**. Use the pooler:
  `aws-0-ca-central-1.pooler.supabase.com:5432`, user `postgres.<ref>`.
- A git worktree lives inside the repo, so ESLint/tsconfig ignore patterns need
  `**/` prefixes or they miss it.

---

## Loose ends

- **Rotate the database password.** It was shared in chat. Nothing in the repo
  depends on it.
- `salvage/local-test-harness` holds an uncommitted parallel persona-switcher
  found in the main checkout, preserved rather than overwritten. Its `0006`
  claims to fix two bugs in `0005`; worth comparing before deleting the branch.
- `lib/mock-data.ts` is ~2,000 lines and only seeds demo mode now.
  `lib/store/operations.test.ts` pins rules against specific mock records, so
  gutting it means rewriting those tests.

---

# Session log — 2026-08-10

Written at the end of the session, for the next one. **The three outstanding
items are at the bottom of this section.** Everything above them shipped, is
merged to `main`, deployed, and covered by tests (539 passing).

## The two hours spent on nothing, and how not to repeat them

Both were "my change isn't live", and neither was a code problem. `git rev-list
--left-right --count main...origin/main` reading `0 0` is **necessary but not
sufficient** — pushed code sat undeployed twice, for two different reasons.
Check both of these before saying anything about the live site. No Vercel access
required; the repo is public:

```bash
curl -s "https://api.github.com/repos/4deg-kelvin/skyrunners-app/actions/runs?per_page=3"
curl -s "https://api.github.com/repos/4deg-kelvin/skyrunners-app/deployments?per_page=3"
curl -s "https://api.github.com/repos/4deg-kelvin/skyrunners-app/commits/SHA/status"
```

The last one is the useful one: it carries a `Vercel` context whose state is
`success`, `pending` or `failure`. **A red Vercel status next to a green CI check
is the signature of both bugs below.**

### 1. CI was red on Prettier, which `npm run check` did not run

CI runs `format:check`; `npm run check` didn't. So the pre-push gate said green
while the gate that actually blocks a deploy said red. **Fixed by putting
Prettier into `npm run check`** — remembering to also run a second command is not
a fix. If `npm run check` ever passes and CI fails again, the bug is that `check`
is missing a step. Fix it there.

### 2. An hourly cron made every deployment fail

`vercel.json` declared `0 * * * *`. **Vercel's Hobby plan allows cron jobs that
run at most once a day, and it rejects the whole deployment over it — not just
the cron.** A schedule string in a file nobody was looking at silently stopped
the site updating for four commits, and the symptom pointed nowhere near it.

Now `0 2 * * *` — 7pm Pacific in summer, 6pm in winter — for the one cron left.
The check-in reminder cron went with check-ins on 2026-08-24, which freed the
second Hobby slot. If a future job needs to run more than once a day, that's a
Pro-plan conversation, not a schedule edit. Written up in `docs/INFRA.md`, and
`lib/notify/cron-schedule.test.ts` asserts no cron's schedule can fire more than
once a day.

### 3. An env-var edit dropped the site into demo mode

Adding the Discord variables removed or unscoped a `NEXT_PUBLIC_SUPABASE_*` one,
and the app **silently fell back to sample data with no login** — by design, so a
fresh clone runs, which is exactly why nothing errored. Rolling back fixed it.

Diagnosing this without Vercel access: `/my-work` returns `307 -> /login` in live
mode and `200` in demo mode, because `updateSession` no-ops when
`supabaseConfig()` is null. That one request tells you which mode production is
in.

## What shipped

### Deliverable checklists (migration 0028)

A collapsible checklist under every deliverable, on the project page and My Work.
**Not sub-tasks** — a todo has no owner, no date, no credit, and appears in no
count. It exists because errands were being entered as deliverables, and a
deliverable feeds the Delivered signal, so ten of them made somebody outrank the
person who shipped the airframe.

The gate: **neither the owner's "Mark done" nor the PL's "Sign off" goes through
while an item is open.** Gating only sign-off would put the wall in front of the
PL, who didn't write the list. Deleting an item is a legitimate way to clear it —
a todo counts towards nothing, so "it turned out not to be needed" must not force
a false tick.

`can.manageDeliverableTodos` is the one rule in `permissions.ts` where owning a
row grants a right PL-only neighbours don't have. Deliberate: the person doing
the work discovers what it involves, and making them ask a PL to write down
"book the CNC" guarantees the list stays empty.

### Pacific time (`lib/dates.ts`)

**This was a live bug.** `today()` was `new Date().toISOString().slice(0, 10)` —
the UTC date — and Vercel runs UTC, so **from 5pm Pacific the app believed it was
tomorrow.** Every evening this club is in the lab. Invisible locally, because a
laptop in California agrees with UTC until 5pm.

The second half was rendering: `new Date("2026-08-09")` parses as UTC midnight
and formats as *Aug 8* in California. Nine files did that. It also rendered
differently on the server and in the browser, so React was logging a hydration
mismatch nobody had connected to it.

Everything now goes through `lib/dates.ts`. The rule is in CLAUDE.md; the short
version is that **calendar dates and instants are different things**, dates are
compared as strings, and day arithmetic happens in UTC because a Pacific day is
23 or 25 hours twice a year.

### Discord, end to end

The bot works — Kelvin verified. What exists:

| Trigger | Recipient |
|---|---|
| Added to a project | the person added |
| Join request approved / declined | whoever asked |
| Deliverable or project marked **blocked** | see `blockerAudience` below |
| A request addressed to you is answered | whoever asked |
| Daily digest, 7pm Pacific | every PL with something to say |
| "Send a test message" from Settings | themselves |

Three check-in triggers were here — submitted, due-in-4-hours, and still-open —
and all three went on 2026-08-24. Worth noting what that did to the volume: the
club's notification load is now driven entirely by things somebody DID, not by
things somebody was supposed to do. That is the direction to keep it in; a bot
that only ever nags is a bot people mute, and muting it takes the blocker alerts
with it.

`blockerAudience(projectId, raiserId)` is the interesting one: the project's PLs
minus the raiser, climbing **one level** if that empties the list. Deliberately
not the whole chain like `completionAudience` — a blocker is a request for one
named person to act, and telling five produces the bystander effect. The
escalation is the point: a PL stuck on their own deliverable would otherwise be
DMed about their own blocker, so the case that most needs escalating would be the
only one nobody heard about.

Verification lives on the ID field itself (badge plus "Verify now"), and the badge
records *which* ID was proven, so it can't survive the number changing. A public
`DiscordStatus` badge is on the member profile — **profile only, not the
roster**, per Anish after seeing both.

The invite link is a Co-Lead setting (migration 0030), validated to Discord's own
hosts in the operation and by a CHECK constraint. It appears in **exactly two
places**: the new-member guide and beside the Discord ID field in Settings. Not
the club-wide banner — that would publish the server link permanently to thirty
people already in the server.

### Admitting members

The flow already existed (link, Stanford sign-in, a trigger creates an inactive
profile, **Admit** on the roster) but was **broken for Leads**: a person who signs
in without an invite has no Lead, so `isLeadOfOrAbove` was false for everybody and
only Co-Leads could admit. The panel showed the button to all five Leads and
refused every press.

`can.admitMember` is now any Lead or Co-Lead. Admitting also **assigns a Lead**,
defaulting to whoever clicked — a member with no Lead is invisible to the half of
the app that runs on the reporting chain, and a separate "now assign a Lead" step
would get skipped with silent consequences for weeks.

### Smaller

- **Alphabetical divisions and projects**, at every depth, from one comparator in
  `mock-data.ts`. The order was whatever Postgres returned, which is not just
  arbitrary but *unstable* between loads.
- **The Dashboard nav link** now asks the same question `/dashboard` redirects on.
  It keyed off `globalRole`, so a Lead with no reports saw a link that bounced
  them back, and a member who had been given reports saw none.
- **The cron route was behind the auth middleware** and answered `307 -> /login`.
  Vercel Cron sends a bearer token and no cookie, so the job would never have run
  — and the only symptom would have been reminders quietly never arriving.
  `api/cron` is excluded from the matcher; the route still authenticates itself.
- **Division Gantt clips the past** to today, unless something has slipped, with a
  "Show history" control that re-lays-out client-side. Project charts are
  unchanged, deliberately.
- **A "you haven't logged any hours" banner**, from their second day until their
  first log. No cron — it's a `joinedAt` versus today comparison, so the delay
  starts applying on its own.

## Outstanding — start here

1. **Rotate the Supabase database password.** It has been in plaintext in a chat
   transcript all session, along with the pooler connection string. Anish deferred
   this to "once everything else is done". It is now.
2. **Five of seven people have no verified Discord.** Julia, Kevin, Khush, Michael
   and Jonathan get no notifications at all, including check-in reminders — and
   check-in alerts if they lead anyone. Nothing to build; each of them presses
   Verify now in Settings.
3. **Nobody has logged hours yet.** 2 work logs, 1 check-in, 7 deliverables across
   4 projects. Every downstream number — the four contribution signals, tier
   placement, the review queue, reliability — reads empty until people start.
   Don't judge whether any of it works before one real week of use.

Two things offered but not done:

- **Fold the behavioural design rules into `docs/DESIGN_SYSTEM.md`.** The dates
  rule, the no-dead-controls rule, and "replace a dead button with a sentence
  saying why" are enforced in review and written nowhere.
- **Warn when the academic calendar is about to run out.** There are 9 terms and a
  `calendarRunsOut` value already computed in the settings view, surfaced nowhere.
  When the calendar ends, check-ins silently stop generating with no symptom — the
  same shape as the bug that banner already exists to prevent.

---

# Session log — 2026-08-10 (second half)

Continues the log above. Migrations `0031`–`0033`, all applied to live, all
merged and deployed. 573 tests.

## The advisor role (0031, 0032)

A faculty or project advisor: sees everything, comments on anything, builds
nothing. No projects, no deliverables, no hours, no check-ins, nobody above or
below them.

**The dangerous part was not adding the role.** `globalRole !== "member"` was
shorthand for "is leadership" in **twenty places** — inviting, admitting,
club-wide events, attendance, roll-ups. An advisor is not a member, so a fourth
enum value would have granted a professor every one of them. They all go
through `isLeadership()` now. **If you add a fifth role, that predicate is the
first thing to read.**

The type checker found the rest: every `Record<GlobalRole, …>` failed to compile
until it had an advisor entry. That is why this is an enum value and not a
boolean beside one.

Things that did NOT fall out for free, and are now explicit:

- **Nobody reports to an advisor, either direction.** `setGlobalRole` clears the
  line both ways. Without it a Lead converted to an advisor keeps a review queue
  they can no longer reach, and the escalation — which runs on age — points at
  somebody the app has stopped asking anything of.
- **No My Work.** Structurally empty for them, and it is the landing page. Nav
  hides it, `/my-work` redirects to `/projects`, and the layout does not even
  call `getMyWork` — it synthesises a pending check-in for anybody with no
  history, which would have pinned an unclearable red dot to a nav item they
  cannot see.
- **Neither banner.** Discord is optional for an advisor.
- **Find Work stays.** The "I'm stuck" board is the most useful thing they can
  act on.

`project_advisors` is a separate table, NOT a fourth `project_role`.
`project_members` drives staffing counts and /find-work's unstaffed-first
ordering; a professor is not staff, and a table nothing counts cannot leak.

## Member requests (0033)

"Can I have access to…" — free-form, addressed to ONE named Lead, from a button
on that Lead's profile.

**The rule, and it is in the new-member guide in these words: needs training ->
Trainings; needs somebody to say yes -> ask a person.** Rooms and machines stay
in the trainings catalogue, which already worked end to end and already
appeared on the dashboard. This is for the Fusion drive, Onshape, the GitHub
org, a key to the cabinet.

The button is on a PERSON so the app never has to know who owns what. A central
request page would need a list of grantable things mapped to owners — a second
catalogue to keep current. The cost is that the member has to know who, which is
a sentence in the guide rather than a table in a database.

Lands on that person's dashboard above the trainings queue (somebody is blocked
now; a training verification confirms something that already happened). Red past
five days. Granting is one press; **declining requires a reason**, same
asymmetry as rejecting a deliverable. A Co-Lead sees every outstanding request,
badged "Asked someone else". Not public — RLS scopes reads to the two people
plus Co-Leads.

One open request per person per recipient, which is why withdraw exists.

## Commitment expectations changed

**16+ is Core, 10–12 is Committed.** `committed` is the LOW end of the published
range, so somebody at exactly 10 has met the stated bar. The live
`club_settings` row was updated too — the constants are only the seed, and
editing them alone changes nothing anybody is measured against.

## Smaller

- **Division Gantt** clips to today unless something has slipped, with a "Show
  history" date picker that re-lays-out client-side. A bug shipped and was fixed
  the same session: `projectTone` returns `"done"` for complete and `"ok"` for
  on-track, and the overdue filter excluded `"ok"` — so finished work dragged the
  window back to the beginning, the exact behaviour clipping was added to
  prevent. The tests passed because the fixture used an invented tone.
- **Check-in composer** was one undifferentiated wall: each project panel was
  transparent on `bg-card` with the same border colour as the inputs inside it.
  Recessed `bg-surface` panels now, project name as a cardinal section label,
  and an intro saying "one box per project" so the repetition reads as intended
  rather than as a rendering bug.
- **Alphabetical** divisions and projects at every depth.
- **Pacific dates** everywhere via `lib/dates.ts` — see the rule in CLAUDE.md.
- **Any Lead can admit a new member**, and admitting assigns their Lead.

## Mobile

Measured at 375px, not guessed. The layout already reflowed — no page
overflowed. Two real problems:

1. **The roster scrolled sideways.** Member cards were 302px in a 286px column;
   grid items default to `min-width: auto` and refuse to shrink below their
   content. `min-w-0` fixed it, verified before/after. Page-level scrollWidth
   was 0 the whole time, which is why a desktop check missed it.
2. **Every form field zoomed the page on iOS.** Safari zooms on focus under
   16px and does not zoom back. One media query in `globals.css` forces 16px on
   phones; desktop typography untouched.

Nav links went 32px -> 44px.

**Still open:** 22 of 27 tap targets on My Work are under 40px, mostly `py-1.5`
secondary buttons. A blanket `min-height` would stretch the inline icon buttons
in list rows, so it wants a real pass rather than one rule.

## Outstanding, in order

1. **The "public per-project half" of a check-in has never actually been public
   in live mode.** Found 2026-08-25 while auditing the RLS layer for the
   reporting chain. This is the highest-value thing left, and it needs a decision
   rather than a patch.

   The chain of reasoning, because each step is checkable:

   - `update_entries_read_all` is `using (true)` — the per-project half is public,
     exactly as designed and as CLAUDE.md claims.
   - **But the app never reads `update_entries` directly.**
     `projectUpdateFeed()` reads `live().progressUpdates` and iterates
     `u.entries`, and `lib/store/supabase.ts` attaches entries by looping over
     the ENVELOPE rows that came back.
   - So an entry whose envelope RLS filtered out is unreachable, whatever the
     entries policy says.
   - `progress_updates_read_chain` (migration `0008`) is
     `member_id = auth.uid() or auth_is_lead_of(member_id)`.

   **Net effect: a member's project feed shows their own check-in entries plus
   whoever their `lead_id` chain reaches. A Co-Lead sees everyone's.**
   Pre-existing — `0008` predates all of this.

   ### Corrected 2026-08-24, by querying instead of reasoning

   Two things this write-up got wrong, both found by asking the database:

   - **`profiles.lead_id` is NOT null everywhere — 8 of 12 rows still have
     one.** So `auth_is_lead_of` does not collapse to `auth_is_co_lead()`. It
     still resolves, against a chain the application no longer reads and nobody
     maintains. That is worse than collapsing, not better: visibility now
     follows a reporting structure that officially does not exist.
   - **The stakes are six rows.** Everything ever written:

     | Day | Author | Entries | Private note |
     |---|---|---|---|
     | 2026-08-09 | Kevin Hao (Co-Lead) | 0 | **yes** |
     | 2026-08-11 | Jonathan Ananta Lie (Co-Lead) | 2 | no |
     | 2026-08-13 | Anish Bayya (Co-Lead) | 3 | no |
     | 2026-08-13 | Julia Jiang (Lead) | 1 | no |

     Four envelopes, six entries, all between 9 and 13 August, all before
     check-ins were removed on 2026-08-24. **Nothing will ever be written
     again** — the feature is gone. And the single envelope carrying a private
     `general_note` has **zero** entries, so there is no row where a private
     note and public content coexist.

   That reframes the fix. The bug is real and the principle is unchanged, but
   this is six archived rows, not a live leak, and the cost of each option
   should be read against that.

   ### The options, cheapest first

   - **(a) `progress_updates` → `using (true)`.** One line. Publishes
     `general_note` to the whole club — the one thing
     `can.readArchivedCheckIns` protects, written under a promise. Still no,
     even for one row, and "it's only one" is exactly the argument that makes
     privacy promises worthless.
   - **(b) Revoke the column, then open the row.** Three steps and no
     application refactor:
     1. drop `general_note` from the snapshot's column list in
        `lib/store/mapping.ts:497`
     2. `revoke select (general_note) on progress_updates from authenticated` —
        so it cannot be re-added by accident, which a comment cannot promise
     3. `progress_updates_read_chain` → `using (true)`

     `general_note` is rendered in exactly one place
     (`app/(app)/members/[id]/page.tsx:412`, gated on
     `can.readArchivedCheckIns`), so that page needs a small gated query of its
     own — the `lib/advisors/store.ts` pattern. **This is the recommendation.**
     Column-level privilege makes the database enforce the app's rule rather
     than restate it.
   - **(c) Leave it.** Defensible: six archived rows, no new writes, and the
     people most affected are the three Co-Leads who wrote five of the six
     entries and can already read everything. The cost is that the project page
     claims to show "everything anyone has done here" and does not, and the
     claim rots quietly.

   Whatever is chosen, `auth_is_lead_of` and `progress_updates_review` should go
   with it: the first is the SQL mirror of the deleted `isLeadOfOrAbove` and now
   resolves against a chain nothing maintains, and the second lets a "Lead" mark
   a report read when nothing marks anything read.

2. **The database password does not work, and this is a Supabase-side problem.**
   Not needed any more — see `npm run db:push` — but worth recording so nobody
   re-runs the diagnosis. Host, port, database and user all verified against the
   dashboard's own connection string. The tenant resolves at `ca-central-1` and
   nowhere else (all 32 shared endpoints swept). Four separately-reset passwords
   all returned `28P01`. No network bans, no network restrictions.
   `db.<ref>.supabase.co` exists but AAAA-only, and this machine has no IPv6
   egress.

   **The route that works is `npm run db:push`** — the Management API, over plain
   HTTPS, authenticated with a personal access token. No pooler, no IPv6, no
   database password. `npm run db:pending` generates a paste-able bundle for when
   there is no token to hand.

3. **Never paste `APPLY_ALL.sql` into a live database.** It is the whole history
   and not re-runnable: `0001` has `create type global_role as enum (...)`, which
   takes no `if not exists`, so it aborts on the first statement with
   `42710: type "global_role" already exists` and nothing after it runs. Use
   `npm run db:pending`, which refuses to write a bundle that is not re-runnable.

4. **Fold `catalogue_verifiers` into `catalogue_items`.** Two columns on the item
   is the right schema; the side table exists because that table's snapshot
   column list made a pre-migration deploy fatal, and there was no database access
   at the time. There is now. See the header of
   `supabase/migrations/0046_catalogue_verifiers.sql`.

5. **Five of seven people have unverified Discord** — Julia, Kevin, Khush,
   Michael, Jonathan. They receive nothing at all until they press Verify now.

5. **Nobody has logged any work yet.** Both delivered counters correctly read
   zero, which looks identical to broken, and `lib/quiet.ts` will flag every
   project until somebody logs something. Get one real week in before judging
   any of it.

6. ~~**`npm test` opens a real Discord connection.**~~ **It does not** — this
   entry was wrong when written, on 2026-08-25. Every test in
   `lib/notify/discord.test.ts` replaces `globalThis.fetch` before calling, so
   the `[discord] ... 403` and `[discord] send failed: ECONNRESET` lines in the
   output are the module logging two failures the tests deliberately SIMULATE.
   Nothing reaches the network and nothing can DM anybody.

   Left here as a correction rather than deleted, because "the suite prints
   something alarming" will come up again: those two lines are the evidence that
   the failure paths are covered, not a warning.

7. Tap-target pass (above).

8. Offered and not built: fold the behavioural design rules into
   `docs/DESIGN_SYSTEM.md`; warn when the academic calendar is about to run out
   (`calendarRunsOut` is computed and surfaced nowhere).
