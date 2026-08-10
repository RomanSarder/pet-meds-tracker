import { useRef, useState, type ChangeEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { SessionUser } from "@pet-tracker/shared";
import { displayNameFor, qk } from "@/domain";
import { needsDisplayName, useMembers, useSelf } from "@/features/household/hooks";
import { apiClient, NetworkError } from "@/shared/api";
import { clearSessionEstablished } from "@/shared/session";
import { getRepo } from "@/data";
import { downloadBackup, readBackupFile } from "@/data/backupFile";
import { Button, Card, ScreenHeader, SectionLabel } from "@/components/ds";

// W0 owns this file — relocated from the former pages/HomePage.tsx, now a
// DS screen reachable at /settings. Export/import (SPEC §8) are wired up
// below; everything else on the page belongs to other slices.
export function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // The session query stays: signing out and the auth-gated states below depend
  // on it. What it must NOT do any more is render `user.email` — SPEC §12: "No
  // email address is rendered anywhere in the UI." This card predates that rule.
  // The identity shown here is the display name, resolved through the same
  // `displayNameFor` helper every other attribution surface uses (SPEC §5), so
  // there is exactly one way a person's name reaches the screen.
  const { isPending, isError, error } = useQuery({
    queryKey: qk.session(),
    queryFn: () => apiClient<SessionUser>("/auth/me"),
  });
  // Offline is normal (SPEC §9), not an error state on a screen that must
  // work offline — a NetworkError here is a false alarm and must not alert.
  // Every other error (a real 401/5xx from the server) still does.
  const showSessionError = isError && !(error instanceof NetworkError);

  const selfQuery = useSelf();
  const membersQuery = useMembers();
  const self = selfQuery.data ?? null;
  const signedInName =
    self && !needsDisplayName(self) ? displayNameFor(self.id, membersQuery.data ?? [self]) : null;

  const handleSignOut = async () => {
    // The sign-out POST can fail offline; wrap it so the local sign-out
    // still completes. Sign-out is not "erase this device" — it must not
    // clear `storeOwner` and must not touch local data. Wiping an unsynced
    // household without consent is the exact failure mode this whole change
    // exists to prevent (see AccountSwitchPage for the guarded path that
    // does reset a store).
    try {
      await apiClient("/auth/sign-out", { method: "POST" });
    } catch {
      // Offline or the server is unreachable — sign out locally anyway.
    }
    clearSessionEstablished();
    queryClient.clear();
    navigate({ to: "/sign-in" });
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<Awaited<
    ReturnType<typeof readBackupFile>
  > | null>(null);
  const [importStatus, setImportStatus] = useState<
    { kind: "success"; message: string } | { kind: "error"; message: string } | null
  >(null);

  const handleExport = async () => {
    const backup = await getRepo().exportHousehold();
    downloadBackup(backup);
  };

  const handleFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    setImportStatus(null);
    try {
      const backup = await readBackupFile(file);
      setPendingImport(backup);
    } catch (err) {
      setImportStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not read that file.",
      });
    }
  };

  const handleImport = async (mode: "replace" | "merge") => {
    if (!pendingImport) return;
    const backup = pendingImport;
    setPendingImport(null);
    try {
      await getRepo().importHousehold(backup, mode);
      await queryClient.invalidateQueries();
      setImportStatus({ kind: "success", message: "Import complete." });
    } catch (err) {
      setImportStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Import failed.",
      });
    }
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
            {signedInName ? `Signed in as ${signedInName}` : "Signed in"}
          </div>
          {isPending ? (
            <div style={{ fontSize: 14, color: "var(--ink-3)" }}>
              Loading your session…
            </div>
          ) : showSessionError ? (
            <div role="alert" style={{ fontSize: 14, color: "var(--alert)" }}>
              Could not load your session.
            </div>
          ) : null}
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
              <Button
                type="button"
                variant="secondary"
                style={{ flex: 1 }}
                onClick={handleExport}
              >
                Export JSON
              </Button>
              <Button
                type="button"
                variant="secondary"
                style={{ flex: 1 }}
                onClick={() => fileInputRef.current?.click()}
              >
                Import JSON
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                aria-label="Choose a backup file to import"
                onChange={handleFileChosen}
                style={{ display: "none" }}
              />
            </div>

            {pendingImport ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: "12px",
                  borderRadius: "var(--radius-md)",
                  background: "var(--surface-sunk)",
                }}
              >
                <div style={{ fontSize: 13, color: "var(--ink-2)" }}>
                  Replace your whole household with this file, or merge it in and
                  keep whichever copy of each item was edited most recently?
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    style={{ flex: 1 }}
                    onClick={() => handleImport("replace")}
                  >
                    Replace everything
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    style={{ flex: 1 }}
                    onClick={() => handleImport("merge")}
                  >
                    Merge (keep newest)
                  </Button>
                </div>
              </div>
            ) : null}

            {importStatus?.kind === "error" ? (
              <div role="alert" style={{ fontSize: 13, color: "var(--alert)" }}>
                {importStatus.message}
              </div>
            ) : importStatus?.kind === "success" ? (
              <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
                {importStatus.message}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
                Export your whole household as a single JSON file, or import one
                to restore or merge it back in.
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
