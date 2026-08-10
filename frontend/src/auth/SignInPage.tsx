import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, MailCheck, PawPrint, RefreshCw } from "lucide-react";
import { apiClient, ApiError } from "@/shared/api";
import { useT } from "@/i18n";

type FlowState = "idle" | "loading" | "sent" | "error";

const COOLDOWN_SECONDS = 60;

// Brand accent (also the <meta name="theme-color"> value in index.html) and its
// foreground. Auth screens sit outside .ds-root (see AppShell.tsx / components/ds
// README), so they cannot reach for DS tokens (--accent, --ink-*, …) and instead
// use the literal values directly, same as the warm-paper body background below.
const ACCENT = "#C25A3C";
const ACCENT_FOREGROUND = "#F6F3EC";

export function SignInPage() {
  const t = useT();
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
          : t("auth.genericError")
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
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4">
        {/* text-muted-foreground (~4.27:1) fails WCAG AA (4.5:1, normal text) against
            the warm-paper #F6F3EC page background, even though it passes on white.
            #6E6961 (the DS's own secondary-ink value) measures ~4.91:1 here. */}
        <div className="flex items-center justify-center gap-2 text-[#6E6961]">
          <PawPrint className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs font-semibold tracking-wide uppercase">
            {t("auth.brand")}
          </span>
        </div>

        <div className="space-y-5 rounded-xl border bg-card p-6">
          <div className="space-y-1">
            <h1 className="text-base leading-snug font-medium text-foreground">
              {isSent ? t("auth.signIn.checkInbox") : t("auth.signIn.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isSent ? (
                // SPEC §12 flag: `sentTo` is the email address just
                // submitted, echoed back verbatim — see the wave return.
                // Pre-existing behaviour, translated (not fixed) per this
                // wave's scope.
                <>
                  {t("auth.signIn.sentToPrefix")}{" "}
                  <span className="font-medium text-foreground">{sentTo}</span>.
                </>
              ) : (
                t("auth.signIn.description")
              )}
            </p>
          </div>

          {!isSent ? (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <label
                  htmlFor="email"
                  className="text-sm leading-none font-medium text-foreground"
                >
                  {t("auth.signIn.emailLabel")}
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  aria-invalid={isError}
                  aria-describedby={isError ? "email-error" : undefined}
                  disabled={isLoading}
                  placeholder={t("auth.signIn.emailPlaceholder")}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (isError) {
                      setFlowState("idle");
                      setError("");
                    }
                  }}
                  className="w-full rounded-lg border bg-card px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:border-[#C25A3C] focus-visible:ring-2 focus-visible:ring-[#C25A3C] disabled:cursor-not-allowed disabled:opacity-50"
                />
                {isError && (
                  <p id="email-error" role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={isLoading || !email.trim()}
                style={{ backgroundColor: ACCENT, color: ACCENT_FOREGROUND }}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C25A3C] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                    {t("auth.signIn.sending")}
                  </>
                ) : (
                  <>
                    {t("auth.signIn.sendLink")}
                    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${ACCENT}1a` }}
              >
                <MailCheck className="h-5 w-5" style={{ color: ACCENT }} aria-hidden="true" />
              </div>
              <p className="text-xs text-muted-foreground">{t("auth.signIn.linksExpire")}</p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={cooldown > 0}
                  className="inline-flex h-11 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C25A3C] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {cooldown > 0
                    ? t("auth.signIn.resendIn", { seconds: cooldown })
                    : t("auth.signIn.resendLink")}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex h-11 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C25A3C] focus-visible:ring-offset-2"
                >
                  {t("auth.signIn.useDifferentEmail")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
