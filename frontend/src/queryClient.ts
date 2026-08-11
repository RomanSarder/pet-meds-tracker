import { QueryClient, QueryCache } from "@tanstack/react-query";
import { ApiError } from "./shared/api";
import { clearSessionEstablished } from "./shared/session";
import { stopBackgroundSync } from "./sync";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        // A 401 discovered mid-run (not just at the router guard) is the
        // server revoking this session right now. Clear `established`
        // before navigating so a later offline cold start cannot resurrect
        // it (design §D6).
        clearSessionEstablished();
        // …and silence background sync, which is not routed through
        // react-query and would otherwise keep polling behind the sign-in
        // screen until its own 401 stopped it.
        stopBackgroundSync();
        // Dynamic import breaks the static cycle: queryClient ← router → queryClient
        import("./router").then(({ router }) => router.navigate({ to: "/sign-in" }));
      }
      // Every other error (NetworkError, non-401 ApiError) stays silent:
      // offline is the normal case, not an error state (SPEC §9).
    },
  }),
});
