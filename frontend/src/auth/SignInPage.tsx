import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, MailCheck, PawPrint, RefreshCw } from "lucide-react";
import { apiClient, ApiError } from "@/shared/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type FlowState = "idle" | "loading" | "sent" | "error";

const COOLDOWN_SECONDS = 60;

export function SignInPage() {
  const [email, setEmail] = useState("");
  const [flowState, setFlowState] = useState<FlowState>("idle");
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    []
  );

  const startCooldown = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setCooldown(COOLDOWN_SECONDS);
    timerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const requestLink = async (target: string) => {
    setFlowState("loading");
    setError("");
    try {
      await apiClient("/auth/sign-in", {
        method: "POST",
        body: JSON.stringify({ email: target }),
      });
      setSentTo(target);
      setFlowState("sent");
      startCooldown();
    } catch (err) {
      setFlowState("error");
      setError(
        err instanceof ApiError && err.message
          ? err.message
          : "Something went wrong. Please try again."
      );
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    requestLink(email);
  };

  const handleResend = () => {
    if (cooldown > 0) return;
    requestLink(sentTo);
  };

  const reset = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setFlowState("idle");
    setError("");
    setSentTo("");
    setCooldown(0);
  };

  const isSent = flowState === "sent";
  const isLoading = flowState === "loading";
  const isError = flowState === "error";

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
          <CardHeader>
            <CardTitle>{isSent ? "Check your inbox" : "Sign in"}</CardTitle>
            <CardDescription>
              {isSent ? (
                <>
                  We sent a sign-in link to{" "}
                  <span className="font-medium text-foreground">{sentTo}</span>.
                </>
              ) : (
                "Enter your email to receive a sign-in link."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!isSent ? (
              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoFocus
                    autoComplete="email"
                    value={email}
                    aria-invalid={isError}
                    aria-describedby={isError ? "email-error" : undefined}
                    disabled={isLoading}
                    placeholder="you@example.com"
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (isError) {
                        setFlowState("idle");
                        setError("");
                      }
                    }}
                  />
                  {isError && (
                    <p id="email-error" role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  )}
                </div>

                <Button type="submit" className="w-full" disabled={isLoading || !email.trim()}>
                  {isLoading ? (
                    <>
                      <Loader2 className="animate-spin" aria-hidden="true" />
                      Sending…
                    </>
                  ) : (
                    <>
                      Send link
                      <ArrowRight aria-hidden="true" />
                    </>
                  )}
                </Button>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <MailCheck className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <p className="text-xs text-muted-foreground">Links expire after 15 minutes.</p>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleResend}
                    disabled={cooldown > 0}
                  >
                    <RefreshCw aria-hidden="true" />
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend link"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={reset}>
                    Use a different email
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
