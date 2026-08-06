import { PageHeader } from "@/components/layout/page-header";
import { ComingSoon } from "@/components/layout/coming-soon";

export default function UpdatesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        label="Progress"
        title="Updates"
        description="Three check-ins a week, on the days each member picks."
      />
      <ComingSoon
        phase="Phase 4"
        items={[
          "One section per project, so it's always clear which work a note refers to",
          "Sections auto-seeded from logged hours — confirm rather than recall",
          "Blockers route to that project's REs automatically",
          "Member-chosen schedule: three weekdays, pausable during breaks",
          "Lead review queue with on-track / needs-support / at-risk flags",
          "Roll-up reports from Leads to Co-Leads",
          "Escalating nudges: in-app on the due date, email the day after",
        ]}
      />

      <p className="px-1 text-[15px] text-ink-soft">
        Your current draft, with its per-project sections, is on{" "}
        <a
          href="/my-work"
          className="font-semibold text-cardinal-600 hover:text-cardinal-700"
        >
          My Work
        </a>
        .
      </p>
    </div>
  );
}
