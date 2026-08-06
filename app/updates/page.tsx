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
          "Submit an update with progress, blockers, and next steps",
          "Draft auto-filled from logged hours, so it's confirmation not recall",
          "Member-chosen schedule: three weekdays, paused during breaks",
          "Lead review queue with on-track / needs-support / at-risk flags",
          "Roll-up reports from Leads to Co-Leads",
          "Escalating nudges: in-app on the due date, email the day after",
        ]}
      />
    </div>
  );
}
