// slice 8 owns this file — W8 replaces the body; do not open router.ts.
import { ScreenHeader } from "@/components/ds";

export function HouseholdPage() {
  return (
    <div>
      <ScreenHeader title="Household" />
      <div style={{ padding: "0 22px 24px", fontSize: 14, color: "var(--ink-3)" }}>
        Members, invites and leaving land in slice 8.
      </div>
    </div>
  );
}
