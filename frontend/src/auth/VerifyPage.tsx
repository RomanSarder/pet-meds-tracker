import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2, PawPrint, XCircle } from "lucide-react";
import { apiClient, ApiError } from "@/shared/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useT } from "@/i18n";

type VerifyState = "verifying" | "success" | "error";

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
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <PawPrint className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs font-semibold tracking-wide uppercase">
            {t("auth.brand")}
          </span>
        </div>

        <Card>
          {state === "verifying" && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
                  {t("auth.verify.signingIn")}
                </CardTitle>
                <CardDescription>{t("auth.verify.verifyingLink")}</CardDescription>
              </CardHeader>
            </>
          )}

          {state === "success" && (
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                {t("auth.verify.success")}
              </CardTitle>
              <CardDescription>{t("auth.verify.redirecting")}</CardDescription>
            </CardHeader>
          )}

          {state === "error" && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
                  {t("auth.verify.linkNotValid")}
                </CardTitle>
                <CardDescription role="alert">{errorMessage}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" onClick={() => navigate({ to: "/sign-in" })}>
                  {t("auth.verify.backToSignIn")}
                </Button>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
