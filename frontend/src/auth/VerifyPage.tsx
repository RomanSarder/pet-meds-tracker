import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2, PawPrint, XCircle } from "lucide-react";
import { apiClient, ApiError } from "@/shared/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type VerifyState = "verifying" | "success" | "error";

export function VerifyPage() {
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
      setErrorMessage("This link has expired or has already been used.");
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
          setErrorMessage("This link has expired or has already been used.");
        } else {
          setErrorMessage("Something went wrong. Please try again.");
        }
      });
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <PawPrint className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs font-semibold tracking-wide uppercase">
            Pet Tracker
          </span>
        </div>

        <Card>
          {state === "verifying" && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
                  Signing you in…
                </CardTitle>
                <CardDescription>Verifying your link.</CardDescription>
              </CardHeader>
            </>
          )}

          {state === "success" && (
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                You&apos;re signed in
              </CardTitle>
              <CardDescription>Redirecting you now…</CardDescription>
            </CardHeader>
          )}

          {state === "error" && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
                  Link not valid
                </CardTitle>
                <CardDescription role="alert">{errorMessage}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" onClick={() => navigate({ to: "/sign-in" })}>
                  Back to sign in
                </Button>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
