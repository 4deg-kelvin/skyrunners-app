/** Earliest project target first; undated last. Names and IDs break ties.
 * Sort siblings before walking the tree so each project's work stays with it. */
export function compareProjectDueDates(
  a: { id: string; name: string; targetDate?: string },
  b: { id: string; name: string; targetDate?: string }
): number {
  return (
    (a.targetDate || "9999-12-31").localeCompare(
      b.targetDate || "9999-12-31"
    ) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Earliest deliverable or milestone first; undated last. Sort order and IDs
 * break ties.
 *
 * The counterpart to `compareProjectDueDates` above, and it lives beside it
 * because the two have to AGREE: a project page shows its deliverables as a
 * list and again as rows on the timeline, both fed from
 * `projectDeliverables`, and a reader comparing the two reads any difference as
 * a bug rather than as two orderings.
 *
 * `sortOrder` breaks a same-day tie rather than the title, unlike the project
 * comparator's fall back to `name`. Two things due the same day are a real and
 * common case, and `sortOrder` is the order the PL added them in — which is a
 * weak signal but a deliberate one, where alphabetical is neither. `id` is the
 * final tiebreak so the result is STABLE: Postgres does not promise to return
 * rows the same way twice, and an unstable list means finding a name requires
 * reading top to bottom every time.
 */
export function compareDeliverableDueDates(
  a: { id: string; sortOrder: number; dueDate?: string },
  b: { id: string; sortOrder: number; dueDate?: string }
): number {
  return (
    (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31") ||
    a.sortOrder - b.sortOrder ||
    a.id.localeCompare(b.id)
  );
}
