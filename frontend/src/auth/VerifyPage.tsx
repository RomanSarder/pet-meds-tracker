import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2, PawPrint, XCircle } from "lucide-react";
import { apiClient, ApiError } from "@/shared/api";
import { useT } from "@/i18n";

type VerifyState = "verifying" | "success" | "error";

// Brand accent (also the <meta name="theme-color"> value in index.html) and its
// foreground. Auth screens sit outside .ds-root (see AppShell.tsx / components/ds
// README), so they cannot reach for DS tokens (--accent, --ink-*, …) and instead
// use the literal values directly, same as the warm-paper body background below.
const ACCENT = "#C25A3C";
const ACCENT_FOREGROUND = "#F6F3EC";

export function VerifyPage() {
  const t = useT();
  const [state, setState] = useState<VerifyState>("verifying");
  const [errorMessage, setErrorMessage] = useState("");
  const navigate = useNavigate();
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const token = new URLSearchParams(window.location.search).get("token");

    if (!token) {
      setState("error");
      setErrorMessage(t("auth.verify.linkExpired"));
      return;
    }

    apiClient(`/auth/token/verify?token=${encodeURIComponent(token)}`, {
      method: "POST",
    })
      .then(() => {
        setState("success");
        setTimeout(() => navigate({ to: "/" }), 600);
      })
      .catch((err) => {
        setState("error");
        if (err instanceof ApiError && err.status === 401) {
          setErrorMessage(t("auth.verify.linkExpired"));
        } else {
          setErrorMessage(t("auth.genericError"));
        }
      });
    // `t` is stable for the lifetime of a locale (see `useT`/`useTranslator`),
    // and this effect is intentionally guarded by `hasRun` to fire once —
    // adding `t` to the deps would not change that, so it is omitted rather
    // than re-running the verification call on a language switch mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <PawPrint className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs font-semibold tracking-wide uppercase">
            {t("auth.brand")}
          </span>
        </div>

        <div className="space-y-5 rounded-xl border bg-card p-6">
          {state === "verifying" && (
            <div className="space-y-1">
              <h1 className="flex items-center gap-2 text-base leading-snug font-medium text-foreground">
                <Loader2
                  className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
                {t("auth.verify.signingIn")}
              </h1>
              <p className="text-sm text-muted-foreground">{t("auth.verify.verifyingLink")}</p>
            </div>
          )}

          {state === "success" && (
            <div className="space-y-1">
              <h1 className="flex items-center gap-2 text-base leading-snug font-medium text-foreground">
                <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: ACCENT }} aria-hidden="true" />
                {t("auth.verify.success")}
              </h1>
              <p className="text-sm text-muted-foreground">{t("auth.verify.redirecting")}</p>
            </div>
          )}

          {state === "error" && (
            <>
              <div className="space-y-1">
                <h1 className="flex items-center gap-2 text-base leading-snug font-medium text-foreground">
                  <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                  {t("auth.verify.linkNotValid")}
                </h1>
                <p role="alert" className="text-sm text-muted-foreground">
                  {errorMessage}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate({ to: "/sign-in" })}
                style={{ backgroundColor: ACCENT, color: ACCENT_FOREGROUND }}
                className="flex h-11 w-full items-center justify-center rounded-lg px-4 text-sm font-medium transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C25A3C] focus-visible:ring-offset-2"
              >
                {t("auth.verify.backToSignIn")}
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
