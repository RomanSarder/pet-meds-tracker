// slice 8 owns this file — W8 replaces the body; do not open router.ts.
import { ScreenHeader } from "@/components/ds";

export function FirstRunPage() {
  return (
    <div>
      <ScreenHeader title="Welcome" />
      <div style={{ padding: "0 22px 24px", fontSize: 14, color: "var(--ink-3)" }}>
        Set the name shown against every dose you log. Lands in slice 8.
      </div>
    </div>
  );
}
