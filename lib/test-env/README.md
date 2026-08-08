# The test environment

Lets you browse the whole app as a Member, a Team Lead or a Co-Lead without
creating accounts or touching a database.

**It is off unless you switch it on, and it cannot run against real data.**

---

## Turn it on

Add one line to `.env.local` (create the file if it isn't there), then restart
`npm run dev`:

```
SKYRUNNERS_TEST_ENV=1
```

A dark **Test env** pill appears bottom-left. Click it, pick a persona, and the
whole app re-renders as that person.

To turn it off, delete the line and restart. That's the whole switch.

> **If the pill doesn't appear**, your `.env.local` almost certainly also has
> `NEXT_PUBLIC_SUPABASE_URL` in it. That's the interlock below doing its job —
> comment the Supabase keys out to go back to mock data.

---

## Why it can't leak into production

`isTestEnvEnabled()` in `lib/env.ts` requires **two** conditions:

```ts
if (process.env.SKYRUNNERS_TEST_ENV !== "1") return false;
return isDemoMode();   // ← the interlock
```

Production always has Supabase keys, which means `isDemoMode()` is false there,
which means the switcher is off **even if someone sets the flag by mistake**.
Identity-spoofing and real data are mutually exclusive by construction, not by
remembering to unset a variable.

Three consequences worth knowing:

- The server action re-checks the flag itself. Server Actions are reachable by
  POST the moment they exist, so "the bar wasn't rendered" is not access control.
- The cookie is `httpOnly` and checked against an allowlist, so hand-editing it
  to some other id does nothing.
- The flag is read **before** `cookies()` is called. That ordering is
  load-bearing: reading cookies opts a route out of static rendering, so
  checking the flag first keeps the shipping build byte-identical to a repo with
  none of this in it. Verified — with the flag off `/my-work` builds as
  `○ Static`, with it on as `ƒ Dynamic`.

  **Don't reorder those two lines.**

---

## The personas, and why these six

Not "one of each role". Each sits at a different point in the crossing described
in `CLAUDE.md`, where RE authority inherits **down** the project tree and Lead
authority inherits **up** the reporting chain.

| Persona | Role | What it's for |
|---|---|---|
| **Anish Bayya** | Co-Lead | Answers yes to everything. If something is hidden from this persona, it's a bug |
| **Priya Raghavan** | Lead | Leads Dev, who leads two members — oversight two levels down, plus an RE role |
| **Dev Patel** | Lead | Leads people but is RE of nothing. Proves Lead and RE are separate axes |
| **Tyler Brooks** | **Member** | A plain member who *is* an RE. Catches any inline `globalRole` check |
| **Sofia Marquez** | Member | Four levels deep, no Dashboard. What a new member actually sees |
| **Grace Lin** | Member | No `primaryTeamId`. Catches anything grouping by team id instead of division |

Tyler is the one that earns its place. A permission bug where someone wrote
`if (globalRole === "lead")` instead of calling `lib/permissions.ts` is invisible
from every other persona.

`personas.test.ts` asserts each id exists, that its role still matches
`lib/mock-data.ts`, and that the property each was *chosen* for still holds — so
if the mock data drifts, the suite fails instead of quietly showing you the wrong
person.

### A gap worth knowing

Every mock member is an RE of something or has reports. There is **no
zero-authority member** — the single most common real case. Until one exists in
`lib/mock-data.ts`, "what a brand-new member with no responsibilities sees" can't
be checked here. Sofia is the closest approximation.

---

## Removing it

```bash
npm run remove:test-env
```

Deletes this directory, strips every `TEST-ENV:START` / `TEST-ENV:END` block from
the app, removes its own npm script, and deletes itself. Then run `npm run check`
— it passing is the proof nothing dangled.

Blocks that sit mid-function carry the line that should survive them:

```ts
// TEST-ENV:START
const viewerId = (await readTestPersonaId()) ?? CURRENT_USER_ID;
// TEST-ENV:REPLACE-WITH const viewerId = CURRENT_USER_ID;
// TEST-ENV:END
```

leaves exactly `const viewerId = CURRENT_USER_ID;`.

Markdown is deliberately **not** scanned — a tool that strips marker comments
would mangle documentation explaining them. The script lists the prose files to
prune by hand.

**You do not have to remove this before shipping.** The interlock means it's
inert in production. Run it when the personas stop being useful.

---

## Files

| File | Role |
|---|---|
| `personas.ts` | The six personas + the id allowlist. No dependencies, so tests can import it |
| `index.ts` | Reads the cookie. Returns `null` unless the flag is on |
| `actions.ts` | The one server action. `"use server"` — async exports only |
| `test-env-bar.tsx` | The UI. Server Component, zero client JS |
| `personas.test.ts` | Guards against mock-data drift |

Integration is three places, all marked: `lib/env.ts`, `lib/data/viewer.ts`,
`app/(app)/layout.tsx`.

### Two constraints that will bite you

- **`actions.ts` may only export async functions.** It's a `"use server"`
  module. A plain `const` in there fails the build with an error pointing at the
  constant and no mention of the rule — which is why `RESET_VALUE` lives in
  `personas.ts`.
- **`test-env-bar.tsx` must stay a Server Component.** Collapse is a native
  `<details>` and switching uses each button's own `name`/`value`, so no
  `onClick` is needed. Adding one forces `"use client"` and lands you in the
  trap described in `CLAUDE.md` §8.
