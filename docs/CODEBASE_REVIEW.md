# Codebase reliability review

Reviewed September 7, 2026. Scope: repository guidance and architecture, store
persistence, permission inheritance, database write guards, MCP request handling,
dependency advisories, and the principal pages and forms in local demo mode.

## Changes

- Rejected mutations now discard their draft. Previously a validation refusal
  could leave earlier field changes in the shared snapshot and persist them.
  A failed live save also leaves the request's original snapshot intact.
- Database updates send only changed columns. Editing a title no longer sends
  stale unrelated columns back to Postgres.
- Store and permission-graph reads paginate with an exact count and stable key
  ordering, including composite keys. They handle a server cap below 1,000 rows
  and fail rather than returning a partial result after a page error.
- Migration `0051` guards profile identity, global role, and account status at the
  database boundary, while permitting ordinary Lead admission of inactive members
  and preserving trusted auth provisioning.
- Migration `0052` brings database project authority into line with ancestor PL,
  primary PL, and owning team/division authority used by the app. Inactive members
  receive no project authority.
- Migration `0053` limits ordinary members to changing their own RSVP and protects
  event recurrence fields as well as the original event columns.
- Malformed MCP JSON-RPC envelopes return a protocol error instead of crashing
  when methods or bodies have unexpected types.
- Forms prevent duplicate submissions and explain uncertain network failures
  without discarding typed input. Mobile buttons and checklist toggles have
  larger touch targets. Demo and missing-calendar copy reflect current behavior.
- Updated Next.js, its ESLint configuration, Sharp, Nano ID, and Next's PostCSS
  dependency to address the advisories reported by npm audit at review time.

## Verification

- `npm run check`: **970 tests passed**, plus type checking, lint, formatting, and
  the dead-control sweep. Baseline before these changes: 949 tests passed.
- New tests cover rejected writes, failed live persistence, changed-column
  payloads, paginated real Supabase query builders, and malformed MCP envelopes.
- Nine database regression tests execute the new SQL in local PostgreSQL via
  PGlite with authenticated roles. They cover profile escalation/admission,
  inherited project authority, RSVP guards, and repeat application of migrations.
  The fixture models the relevant schema; it is not a production database clone.
- `npm run build:check`: production build passed in the isolated build directory.
- `npm audit`: zero reported vulnerabilities after dependency updates. This is a
  point-in-time dependency check, not a guarantee of vulnerability-free software.
- Seventeen local page routes returned HTTP 200. Browser checks covered My Work,
  Projects, Calendar, and Members at phone size, plus desktop My Work. Work-log
  creation and event-title editing survived reload. The temporary event-title
  change was restored. These checks used local sample data.

## Production rollout

The code review branch does **not** apply database migrations. A database operator
must review and apply `0051_profile_write_guards.sql`,
`0052_inherited_project_authority.sql`, and `0053_rsvp_write_guard.sql` in order,
after any earlier pending migrations, using the project's documented migration
workflow. Check the migration ledger before applying anything. Never load the
sample seed into production. `APPLY_ALL.sql` was regenerated from source migrations
and also incorporates earlier migrations missing from the previous bundle; use
individual pending migrations for an existing database.

Before promoting this branch, verify real sign-in/provisioning, a regular member's
profile edit and RSVP, Lead admission, and Division Lead project edits against a
staging database with the production migration history. No production credentials
or production records were used for this review.

## Remaining limitations

- Snapshot diff persistence is still multiple SQL statements, not one database
  transaction. A later statement can fail after an earlier one has committed.
- Changed-column writes avoid unrelated overwrites, but simultaneous edits to the
  same column (including attendance arrays) remain last-write-wins. Transactional
  RPCs or optimistic concurrency would require a separate persistence redesign.
- Paginated reads are not a single transactional snapshot under concurrent writes.
- Live OAuth, RLS against the complete deployed schema, Discord, uploads, calendar
  subscriptions, and scheduled production jobs were not exercised end to end.
- This review fixed demonstrated issues; it does not establish that every existing
  database policy mirrors every application permission or that all bugs are gone.

## Production migration follow-up — September 7, 2026

Applied migrations 0051–0053 to project `ldijsmcnjrihwvxtypqy` through the authenticated Supabase SQL editor. The preflight ledger contained all 50 earlier migrations. The three policy/trigger migrations committed together in an explicit transaction; a fresh query confirmed all 53 ledger entries, both enabled guard triggers, both authority helpers, the admission policy, and SECURITY INVOKER on the profile and RSVP guard functions.

Before committing, a rollback rehearsal against the deployed schema confirmed an ordinary member's own-profile update, refusal of role/email escalation, and preserved Co-Lead project authority. The first editor attempt was rejected for a syntax error before execution; the corrected complete SQL was copied back from the editor and verified before running. A broader rehearsal involving temporary production attendance and role/status changes was rejected by automatic approval review and did not run. RSVP/admission behavior therefore remains covered by the local SQL regression tests, not an end-to-end production write test.

After migration, the authenticated Vercel app successfully loaded My Work, Projects, Members, Calendar, and Dashboard. This verifies existing-session reads and rendering; fresh OAuth provisioning and all live write paths are not proven by these page checks. No attendance or membership changes were committed as test data. The reviewed application changes remain on the PR branch and have not been merged to main. Vercel, not Framer, hosts this application.

This follow-up supersedes the earlier statement that production migrations were still pending. Remaining concurrency and multi-statement persistence limitations still apply.
