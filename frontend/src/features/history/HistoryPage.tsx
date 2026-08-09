// slice 7 owns this file — W6 replaces the body; do not open router.ts.
import { ScreenHeader } from "@/components/ds";

export function HistoryPage() {
  return (
    <div>
      <ScreenHeader title="History" />
      <div style={{ padding: "0 22px 24px", fontSize: 14, color: "var(--ink-3)" }}>
        The full event log for this pet lands in slice 7.
      </div>
    </div>
  );
}
