interface Page<T> {
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
}

interface PageQuery<T> {
  range(from: number, to: number): PromiseLike<Page<T>>;
}

/**
 * Read a complete, RLS-filtered result. The query must request an exact count
 * and order by a unique key (all columns for a composite key).
 *
 * Supabase caps responses, even without a limit in our query. Advance by the
 * number actually returned, not the requested page size: projects can configure
 * a lower cap. Never publish a partial permission graph or store snapshot.
 */
export async function paginate<T>(
  query: () => PageQuery<T>,
  label: string
): Promise<T[]> {
  const rows: T[] = [];
  while (true) {
    const { data, error, count } = await query().range(
      rows.length,
      rows.length + 999
    );
    if (error) throw new Error(`Could not load ${label}: ${error.message}`);
    if (count === null || !data) {
      throw new Error(
        `Could not load ${label}: the database did not confirm a complete result.`
      );
    }
    rows.push(...data);
    if (rows.length >= count) return rows;
    if (data.length === 0) {
      throw new Error(
        `Could not load ${label}: the database returned an incomplete result.`
      );
    }
  }
}
