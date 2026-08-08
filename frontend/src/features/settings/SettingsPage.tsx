import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { SessionUser } from "@pet-tracker/shared";
import { qk } from "@/domain";
import { apiClient } from "@/shared/api";
import { Button, Card, ScreenHeader, SectionLabel } from "@/components/ds";

// W0 owns this file — relocated from the former pages/HomePage.tsx, now a
// DS screen reachable at /settings. Export/import (SPEC §8) are visible
// placeholders here; a later slice wires them up.
export function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    data: user,
    isPending,
    isError,
  } = useQuery({
    queryKey: qk.session(),
    queryFn: () => apiClient<SessionUser>("/auth/me"),
  });

  const handleSignOut = async () => {
    await apiClient("/auth/sign-out", { method: "POST" });
    queryClient.clear();
    navigate({ to: "/sign-in" });
  };

  return (
    <div>
      <ScreenHeader title="Settings" />

      <div
        style={{
          padding: "0 22px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <Card>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--ink-1)",
              marginBottom: 4,
            }}
          >
            Signed in
          </div>
          {isPending ? (
            <div style={{ fontSize: 14, color: "var(--ink-3)" }}>
              Loading your session…
            </div>
          ) : isError ? (
            <div role="alert" style={{ fontSize: 14, color: "var(--alert)" }}>
              Could not load your session.
            </div>
          ) : (
            <div style={{ fontSize: 14, color: "var(--ink-2)" }}>{user?.email}</div>
          )}
          <Button
            type="button"
            variant="secondary"
            block
            onClick={handleSignOut}
            style={{ marginTop: 16 }}
          >
            Sign out
          </Button>
        </Card>

        <div>
          <SectionLabel>Backup</SectionLabel>
          <Card
            style={{
              marginTop: 12,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", gap: 12 }}>
              <Button type="button" variant="secondary" disabled style={{ flex: 1 }}>
                Export JSON
              </Button>
              <Button type="button" variant="secondary" disabled style={{ flex: 1 }}>
                Import JSON
              </Button>
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
              Export and import of the whole household as a single JSON file is
              coming soon.
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
