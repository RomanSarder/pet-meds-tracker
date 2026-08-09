// W9-DESIGN §D5/§D6 — the production `SyncTransport`, a thin wrapper over
// `shared/api.ts`'s `apiClient` against the two backend endpoints
// (`backend/src/sync/index.ts`). Tests never use this file directly; they
// supply a fake in-memory server that implements the same `SyncTransport`
// interface instead.
import type { SyncPayload, SyncPullResult, SyncPushBody, SyncPushResult } from "@pet-tracker/shared";
import { apiClient } from "@/shared/api";
import type { SyncTransport } from "./types";

export function httpTransport(): SyncTransport {
  return {
    push(changes: SyncPayload): Promise<SyncPushResult> {
      const body: SyncPushBody = { changes };
      return apiClient<SyncPushResult>("/sync/push", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    pull(cursor: string | null): Promise<SyncPullResult> {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      return apiClient<SyncPullResult>(`/sync/pull${query}`);
    },
  };
}
