import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { SessionUser } from "@pet-tracker/shared";
import { qk } from "@/domain";
import { apiClient } from "@/shared/api";
import { clearSessionEstablished, setStoreOwner } from "@/shared/session";
import { stopBackgroundSync } from "@/sync";
import { getRepo } from "@/data";
import { downloadBackup } from "@/data/backupFile";
import { Button, Card, ScreenHeader } from "@/components/ds";
import { useT } from "@/i18n";

// WA-DESIGN §D5. Reached ONLY from the router guard's blocking branch
// (router.ts, owned by the concurrent builder this wave): a different
// account is signing in on a device that still holds UNSYNCED data
// belonging to the previous account. This page's whole job is to never let
// the new account into the app while that data is still present — every
// path below either leaves the store untouched or destroys it only after a
// deliberate, successful backup.
//
// Top-level route, outside the app shell, so no code here may assume a
// session is established or that `getRepo()`'s data belongs to whoever is
// about to sign in.

type SessionState =
  | { status: "loading" }
  | { status: "ready"; user: SessionUser }
  | { status: "unavailable" };

export function AccountSwitchPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [session, setSession] = useState<SessionState>(() => {
    const cached = queryClient.getQueryData<SessionUser>(qk.session());
    return cached ? { status: "ready", user: cached } : { status: "loading" };
  });

  useEffect(() => {
    if (session.status !== "loading") return;
    let cancelled = false;
    apiClient<SessionUser>("/auth/me")
      .then((user) => {
        if (cancelled) return;
        queryClient.setQueryData(qk.session(), user);
        setSession({ status: "ready", user });
      })
      .catch(() => {
        if (cancelled) return;
        setSession({ status: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
    // Runs once: re-checking `session.status` inside would refire on every
    // state change this effect itself causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [signingOut, setSigningOut] = useState(false);
  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await apiClient("/auth/sign-out", { method: "POST" });
    } catch {
      // Offline or already expired — the local sign-out below must still
      // complete. The local store is untouched either way: this path never
      // exports, never resets.
    }
    clearSessionEstablished();
    stopBackgroundSync();
    queryClient.clear();
    navigate({ to: "/sign-in" });
  };

  const [backupError, setBackupError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const handleBackupThenContinue = async () => {
    if (session.status !== "ready") return;
    setBackupError(null);
    setDownloading(true);
    try {
      const backup = await getRepo().exportHousehold();
      downloadBackup(backup);
    } catch (err) {
      setDownloading(false);
      setBackupError(
        err instanceof Error ? err.message : t("account.switch.backupError"),
      );
      return;
    }
    // Only reachable once the backup is safely downloaded. This ordering —
    // download, THEN reset — is the whole safety property of this screen.
    await getRepo().resetLocalHousehold();
    setStoreOwner(session.user.id);
    queryClient.clear();
    navigate({ to: "/" });
  };

  const secondaryDisabled = session.status !== "ready" || downloading;

  return (
    <div>
      <ScreenHeader title={t("account.switch.title")} />
      <div
        style={{
          padding: "0 22px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <Card
          style={{
            fontSize: 14,
            lineHeight: 1.5,
            color: "var(--ink-2)",
          }}
        >
          {t("account.switch.description")}
        </Card>

        {backupError ? (
          <div role="alert" style={{ fontSize: 13, color: "var(--alert)" }}>
            {backupError}
          </div>
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Button
            type="button"
            variant="primary"
            block
            disabled={signingOut}
            onClick={handleSignOut}
          >
            {t("account.switch.signOut")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            block
            disabled={secondaryDisabled}
            onClick={handleBackupThenContinue}
          >
            {t("account.switch.backupThenContinue")}
          </Button>
          {session.status === "unavailable" ? (
            <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
              {t("account.switch.sessionUnavailable")}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
