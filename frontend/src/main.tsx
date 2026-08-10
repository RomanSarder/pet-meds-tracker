import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { queryClient } from "./queryClient";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { startBackgroundSync } from "./sync";
import { startNotifications } from "./notifications";
import { LocaleProvider } from "./i18n";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>
          <RouterProvider router={router} />
        </LocaleProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
);
startBackgroundSync();
startNotifications();
