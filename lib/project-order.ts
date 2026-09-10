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
