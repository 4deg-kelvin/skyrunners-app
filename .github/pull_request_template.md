## What this changes

<!-- One or two sentences. What does this do for a member or a lead? -->

## Phase

<!-- Which build phase from docs/PROJECT_PLAN.md does this belong to? -->

## Checklist

- [ ] `npm run check` passes locally (typecheck + lint + tests)
- [ ] Pages import from `lib/data/*`, not `lib/mock-data.ts` directly
- [ ] Any new permission rule lives in `lib/permissions.ts` and has a test
- [ ] No hardcoded colors — used tokens from `app/globals.css`
- [ ] New empty states offer a next action
- [ ] Docs updated if this changed the schema, a decision, or a role name

## Anything to flag

<!-- Tradeoffs, things you're unsure about, follow-ups you deliberately skipped -->
