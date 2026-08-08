import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LogOut, Moon, PawPrint, Sun } from "lucide-react";
import type { SessionUser } from "@pet-tracker/shared";
import { apiClient } from "@/shared/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function HomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  const { data: user, isPending, isError } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiClient<SessionUser>("/auth/me"),
  });

  const toggleTheme = () => {
    const next = document.documentElement.classList.toggle("dark");
    setIsDark(next);
  };

  const handleSignOut = async () => {
    await apiClient("/auth/sign-out", { method: "POST" });
    queryClient.clear();
    navigate({ to: "/sign-in" });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <PawPrint className="h-4 w-4" aria-hidden="true" />
            <span className="text-xs font-semibold tracking-wide uppercase">
              Pet Tracker
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={toggleTheme}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
              You&apos;re signed in
            </CardTitle>
            <CardDescription>
              This confirms the frontend, API, and session cookie are all wired
              together correctly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isPending && (
              <p className="text-sm text-muted-foreground">Loading your session…</p>
            )}
            {isError && (
              <p role="alert" className="text-sm text-destructive">
                Could not load your session.
              </p>
            )}
            {user && (
              <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5">
                <p className="text-xs text-muted-foreground">Signed in as</p>
                <p className="text-sm font-medium text-foreground">{user.email}</p>
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleSignOut}
            >
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
