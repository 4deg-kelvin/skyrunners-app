/**
 * Shown whenever the app is running on mock data.
 *
 * Worth being loud about: without it, someone could demo the app to the club,
 * everyone could enter real information, and nobody would realise nothing was
 * being saved. The banner disappears by itself the moment Supabase env vars are
 * present.
 */
export function DemoBanner() {
  return (
    <div className="border-b border-warn-fg/20 bg-warn-bg">
      <div className="mx-auto max-w-[1400px] px-5 py-2 sm:px-8">
        <p className="text-sm text-warn-fg">
          <span className="font-semibold">Demo mode.</span> Running on sample data
          — no login, and nothing you change is saved. Add Supabase keys to{" "}
          <code className="rounded bg-white/50 px-1 py-0.5 font-mono text-xs">
            .env.local
          </code>{" "}
          to switch to the real database.
        </p>
      </div>
    </div>
  );
}
