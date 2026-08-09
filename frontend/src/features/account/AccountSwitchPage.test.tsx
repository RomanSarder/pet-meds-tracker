import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import type { HouseholdBackup } from "@/domain";
import { apiClient } from "@/shared/api";
import { getRepo } from "@/data";
import { downloadBackup } from "@/data/backupFile";
import { clearSessionEstablished, setStoreOwner } from "@/shared/session";
import { AccountSwitchPage } from "./AccountSwitchPage";

// SPEC §12: no email address is ever rendered. The session fixture below
// deliberately does not use an email-shaped string, so nothing in this file
// could accidentally prove the opposite of what it's asserting.
const INCOMING_USER = { id: "u-incoming", email: "" };

vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  apiClient: vi.fn(),
}));

vi.mock("@/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data")>()),
  getRepo: vi.fn(),
}));

vi.mock("@/data/backupFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/backupFile")>()),
  downloadBackup: vi.fn(),
}));

vi.mock("@/shared/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/session")>()),
  clearSessionEstablished: vi.fn(),
  setStoreOwner: vi.fn(),
}));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => mockNavigate,
}));

const mockApiClient = vi.mocked(apiClient);
const mockGetRepo = vi.mocked(getRepo);
const mockDownloadBackup = vi.mocked(downloadBackup);
const mockClearSessionEstablished = vi.mocked(clearSessionEstablished);
const mockSetStoreOwner = vi.mocked(setStoreOwner);

function emptyRepo() {
  return createMemoryRepo({
    pets: [],
    medications: [],
    courses: [],
    doseEvents: [],
    stockAdjustments: [],
    joinCodes: [],
  });
}

/** Resolves `/auth/me` with the incoming user and any other path with a rejection, unless overridden. */
function mockApiRoutes(overrides: Record<string, () => Promise<unknown>>) {
  mockApiClient.mockImplementation(async (path: string) => {
    if (overrides[path]) return overrides[path]();
    if (path === "/auth/me") return INCOMING_USER;
    return Promise.reject(new Error(`unexpected call: ${path}`));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApiClient.mockRejectedValue(new Error("unexpected call"));
  mockGetRepo.mockReturnValue(emptyRepo());
});

describe("AccountSwitchPage", () => {
  it("renders the copy and never renders an email address", async () => {
    mockApiRoutes({});
    renderWithProviders(<AccountSwitchPage />);

    expect(
      await screen.findByText("Another account's data is on this device"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This device still holds pet records that have not been backed up to the server, and they belong to the account that used it last. Signing in here would replace them.",
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/@/);
  });

  it("sign-out path never exports or resets the local store, and navigates to /sign-in", async () => {
    mockApiRoutes({ "/auth/sign-out": async () => null });
    const repo = emptyRepo();
    const exportSpy = vi.spyOn(repo, "exportHousehold");
    const resetSpy = vi.spyOn(repo, "resetLocalHousehold");
    mockGetRepo.mockReturnValue(repo);

    renderWithProviders(<AccountSwitchPage />);

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Sign out and leave it alone" }),
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/sign-in" });
    });
    expect(exportSpy).not.toHaveBeenCalled();
    expect(resetSpy).not.toHaveBeenCalled();
    expect(mockClearSessionEstablished).toHaveBeenCalled();
  });

  it("sign-out path still completes when the sign-out POST rejects", async () => {
    mockApiRoutes({
      "/auth/sign-out": () => Promise.reject(new Error("offline")),
    });

    renderWithProviders(<AccountSwitchPage />);

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Sign out and leave it alone" }),
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/sign-in" });
    });
    expect(mockClearSessionEstablished).toHaveBeenCalled();
  });

  it("backup path downloads before resetting, and the incoming user id is stamped as the new owner", async () => {
    mockApiRoutes({});
    const order: string[] = [];
    const repo = emptyRepo();
    const backup: HouseholdBackup = {
      schemaVersion: 4,
      exportedAt: "2026-08-08T00:00:00.000Z",
      pets: [],
      medications: [],
      courses: [],
      doseEvents: [],
      stockAdjustments: [],
    };
    vi.spyOn(repo, "exportHousehold").mockImplementation(async () => {
      order.push("export");
      return backup;
    });
    vi.spyOn(repo, "resetLocalHousehold").mockImplementation(async () => {
      order.push("reset");
    });
    mockGetRepo.mockReturnValue(repo);
    mockDownloadBackup.mockImplementation(() => {
      order.push("download");
    });

    renderWithProviders(<AccountSwitchPage />);

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Download a backup, then continue",
      }),
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
    });

    expect(order).toEqual(["export", "download", "reset"]);
    expect(mockSetStoreOwner).toHaveBeenCalledWith(INCOMING_USER.id);
  });

  it("backup path does not reset when exportHousehold rejects, and shows an alert", async () => {
    mockApiRoutes({});
    const repo = emptyRepo();
    vi.spyOn(repo, "exportHousehold").mockRejectedValue(new Error("disk full"));
    const resetSpy = vi.spyOn(repo, "resetLocalHousehold");
    mockGetRepo.mockReturnValue(repo);

    renderWithProviders(<AccountSwitchPage />);

    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Download a backup, then continue",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(resetSpy).not.toHaveBeenCalled();
    expect(mockDownloadBackup).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalledWith({ to: "/" });
  });

  it("when /auth/me is unavailable, the secondary button is disabled and only sign-out works", async () => {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path === "/auth/me") return Promise.reject(new Error("offline"));
      if (path === "/auth/sign-out") return null;
      return Promise.reject(new Error(`unexpected call: ${path}`));
    });

    renderWithProviders(<AccountSwitchPage />);

    const secondary = await screen.findByRole("button", {
      name: "Download a backup, then continue",
    });
    await waitFor(() => expect(secondary).toBeDisabled());

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Sign out and leave it alone" }),
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/sign-in" });
    });
  });
});
