import { QueryClient, QueryCache } from "@tanstack/react-query";
import { ApiError } from "./shared/api";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        // Dynamic import breaks the static cycle: queryClient ← router → queryClient
        import("./router").then(({ router }) => router.navigate({ to: "/sign-in" }));
      }
    },
  }),
});
