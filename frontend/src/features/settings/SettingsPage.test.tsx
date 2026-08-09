import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import type { Household, User } from "@/domain";
import { apiClient, ApiError, NetworkError } from "@/shared/api";
import { clearSessionEstablished, getStoreOwner, setStoreOwner } from "@/shared/session";
import { SettingsPage } from "./SettingsPage";

// Design §D7: `handleSignOut` must complete the LOCAL sign-out even when the
// server round trip fails offline, and must never touch `storeOwner` or local
// data — sign-out is not "erase this device". The session card's error alert
// is a false alarm offline (SPEC §9) and must stay silent for a NetworkError
// while still firing for a genuine server error.
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  apiClient: vi.fn(),
}));

vi.mock("@/shared/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/session")>()),
  clearSessionEstablished: vi.fn(),
}));

const mockApiClient = vi.mocked(apiClient);
const mockClearSessionEstablished = vi.mocked(clearSessionEstablished);

const HOUSEHOLD: Household = {
  id: "hh-1",
  name: "Home",
  createdAt: "2026-06-01T09:00:00.000Z",
  updatedAt: "2026-06-01T09:00:00.000Z",
  deletedAt: null,
};

function user(overrides: Partial<User>): User {
  return {
    id: "u-self",
    householdId: HOUSEHOLD.id,
    email: null,
    displayName: "Roman",
    tint: 1,
    isSelf: true,
    joinedAt: "2026-06-12T09:00:00.000Z",
    createdAt: "2026-06-12T09:00:00.000Z",
    updatedAt: "2026-06-12T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function repoWith(users: User[]) {
  return createMemoryRepo({
    household: HOUSEHOLD,
    users,
    joinCodes: [],
    pets: [],
    medications: [],
    courses: [],
    doseEvents: [],
    stockAdjustments: [],
  });
}

beforeEach(() => {
  localStorage.clear();
  mockApiClient.mockReset();
  mockClearSessionEstablished.mockReset();
});

describe("SettingsPage", () => {
  it("completes sign-out locally even when the sign-out request fails offline, and leaves storeOwner and local data untouched", async () => {
    setStoreOwner("u-self");
    const self = user({ id: "u-self" });
    const repo = repoWith([self]);
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === "/auth/sign-out") throw new NetworkError("offline");
      throw new NetworkError("offline");
    });
    const { queryClient } = renderWithProviders(<SettingsPage />, { repo });
    const clearSpy = vi.spyOn(queryClient, "clear");

    const user2 = userEvent.setup();
    await user2.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(mockClearSessionEstablished).toHaveBeenCalled());
    expect(clearSpy).toHaveBeenCalled();
    expect(mockApiClient).toHaveBeenCalledWith("/auth/sign-out", expect.objectContaining({ method: "POST" }));
    // storeOwner survives sign-out — it is not "erase this device".
    expect(getStoreOwner()).toBe("u-self");
    expect(await repo.listUsers()).toHaveLength(1);
  });

  it("completes sign-out when the request succeeds online", async () => {
    setStoreOwner("u-self");
    const self = user({ id: "u-self" });
    const repo = repoWith([self]);
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === "/auth/sign-out") return null;
      throw new NetworkError("offline");
    });
    const { queryClient } = renderWithProviders(<SettingsPage />, { repo });
    const clearSpy = vi.spyOn(queryClient, "clear");

    const user2 = userEvent.setup();
    await user2.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(mockClearSessionEstablished).toHaveBeenCalled());
    expect(clearSpy).toHaveBeenCalled();
    expect(getStoreOwner()).toBe("u-self");
  });

  it("suppresses the session-card alert for a NetworkError (offline is normal, not an error)", async () => {
    const self = user({ id: "u-self" });
    const repo = repoWith([self]);
    mockApiClient.mockRejectedValue(new NetworkError("offline"));
    renderWithProviders(<SettingsPage />, { repo });

    await screen.findByText("Signed in as Roman");
    expect(screen.queryByRole("alert", { name: /could not load your session/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Could not load your session.")).not.toBeInTheDocument();
  });

  it("keeps the session-card alert for a genuine (non-network) session error", async () => {
    const self = user({ id: "u-self" });
    const repo = repoWith([self]);
    mockApiClient.mockRejectedValue(new ApiError(500, "server error"));
    renderWithProviders(<SettingsPage />, { repo });

    expect(await screen.findByText("Could not load your session.")).toBeInTheDocument();
  });
});
