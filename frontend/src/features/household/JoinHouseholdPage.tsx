// slice 8 owns this file — W8 replaces the body; do not open router.ts.
import { ScreenHeader } from "@/components/ds";

export function JoinHouseholdPage() {
  return (
    <div>
      <ScreenHeader title="Join a household" />
      <div style={{ padding: "0 22px 24px", fontSize: 14, color: "var(--ink-3)" }}>
        Enter a join code to join a household. Lands in slice 8.
      </div>
    </div>
  );
}
