// SPEC §6.9 First run — one screen, pre-filled from the email-derived
// suggestion, two ways forward, name is skippable. See CONTRACT-W8.md §5.4
// and §7. Follows the mocking pattern in
// `frontend/src/features/household/YourNamePanel.test.tsx`: the signed-in
// address never comes from the repo, only from `useSessionEmail`'s one call
// through `apiClient`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor as rtlWaitFor } from "@testing-library/react";
import { useRouterState } from "@tanstack/react-router";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import { apiClient } from "@/shared/api";
import { FirstRunPage } from "./FirstRunPage";

// A longer timeout than testing-library's 1000ms default: this suite chains
// several query-driven effects (self + session both resolving before the
// pre-fill lands), which can outrun the default under a loaded test run.
function waitFor<T>(callback: () => T | Promise<T>): Promise<T> {
  return rtlWaitFor(callback, { timeout: 3000 });
}

vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  apiClient: vi.fn(),
}));

const mockApiClient = vi.mocked(apiClient);

beforeEach(() => {
  // Default: no session resolved yet, matching the moment this screen is
  // actually shown — right after the magic link, before the session query
  // has necessarily settled.
  mockApiClient.mockRejectedValue(new Error("no session"));
});

// A freshly signed-in user has no household yet and carries the repo's
// placeholder self name — `needsDisplayName` is true, which is exactly the
// situation FirstRunPage exists for. Passing the five original arrays but
// omitting `household`/`users` makes the memory repo mint both itself (see
// `memoryRepo.ts`), the same way a first-ever launch would.
function freshSelfRepo() {
  return createMemoryRepo({
    pets: [],
    medications: [],
    courses: [],
    doseEvents: [],
    stockAdjustments: [],
    joinCodes: [],
  });
}

function LocationProbe() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return <span data-testid="pathname">{pathname}</span>;
}

function renderFirstRun(opts?: Parameters<typeof renderWithProviders>[1]) {
  return renderWithProviders(
    <>
      <FirstRunPage />
      <LocationProbe />
    </>,
    opts,
  );
}

function pathname(): string {
  return screen.getByTestId("pathname").textContent ?? "";
}

function nameInput(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Your name" }) as HTMLInputElement;
}

describe("FirstRunPage", () => {
  it("pre-fills the name field with the local part of the signed-in email as an editable suggestion", async () => {
    mockApiClient.mockResolvedValue({ id: "u-1", email: "roman@example.com" });
    const repo = freshSelfRepo();
    renderFirstRun({ repo });

    await waitFor(() => expect(nameInput()).toHaveValue("Roman"));
    // Editable, not a locked placeholder.
    expect(nameInput()).not.toBeDisabled();
  });

  it("keeps an edited name after a late-resolving session, rather than overwriting it with the suggestion", async () => {
    let resolveSession!: (value: { id: string; email: string }) => void;
    mockApiClient.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSession = resolve;
        }),
    );
    const repo = freshSelfRepo();
    renderFirstRun({ repo });

    // The session has not resolved yet, so there is nothing to suggest from.
    await waitFor(() => expect(nameInput()).toHaveValue(""));

    const user = userEvent.setup();
    await user.type(nameInput(), "Romina");
    expect(nameInput()).toHaveValue("Romina");

    // The session now resolves, late, with a name-bearing email. It must not
    // clobber what was already typed.
    resolveSession({ id: "u-1", email: "roman@example.com" });
    await waitFor(() => expect(mockApiClient).toHaveResolvedWith({ id: "u-1", email: "roman@example.com" }));

    expect(nameInput()).toHaveValue("Romina");
  });

  it("Start a household saves the edited name and navigates to /today", async () => {
    mockApiClient.mockResolvedValue({ id: "u-1", email: "roman@example.com" });
    const repo = freshSelfRepo();
    renderFirstRun({ repo });

    // Let the suggestion settle first, so `clear()` has something to clear
    // instead of racing the pre-fill effect and ending up with "RomanRomi".
    await waitFor(() => expect(nameInput()).toHaveValue("Roman"));
    const user = userEvent.setup();
    await user.clear(nameInput());
    await user.type(nameInput(), "Romi");
    await user.click(screen.getByRole("button", { name: "Start a household" }));

    await waitFor(() => expect(pathname()).toBe("/today"));
    const self = await repo.getCurrentUser();
    expect(self.displayName).toBe("Romi");
  });

  it("I have a join code saves the edited name and navigates to /household/join", async () => {
    mockApiClient.mockResolvedValue({ id: "u-1", email: "roman@example.com" });
    const repo = freshSelfRepo();
    renderFirstRun({ repo });

    await waitFor(() => expect(nameInput()).toHaveValue("Roman"));
    const user = userEvent.setup();
    await user.clear(nameInput());
    await user.type(nameInput(), "Romi");
    await user.click(screen.getByRole("button", { name: "I have a join code" }));

    await waitFor(() => expect(pathname()).toBe("/household/join"));
    const self = await repo.getCurrentUser();
    expect(self.displayName).toBe("Romi");
  });

  it("SPEC §5: the name is skippable — Start a household still proceeds with an empty name", async () => {
    const repo = freshSelfRepo();
    renderFirstRun({ repo });

    await waitFor(() => expect(nameInput()).toHaveValue(""));
    expect(screen.getByRole("button", { name: "Start a household" })).toBeEnabled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Start a household" }));

    await waitFor(() => expect(pathname()).toBe("/today"));
    // Nothing meaningful was given, so nothing was saved over the placeholder.
    const self = await repo.getCurrentUser();
    expect(self.displayName.trim().length).toBeGreaterThan(0);
  });

  it("SPEC §5: the name is skippable — I have a join code still proceeds with an empty name", async () => {
    const repo = freshSelfRepo();
    renderFirstRun({ repo });

    await waitFor(() => expect(nameInput()).toHaveValue(""));
    expect(screen.getByRole("button", { name: "I have a join code" })).toBeEnabled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "I have a join code" }));

    await waitFor(() => expect(pathname()).toBe("/household/join"));
  });

  it("is one screen: no carousel and no permission prompt", async () => {
    const repo = freshSelfRepo();
    renderFirstRun({ repo });

    await screen.findByText("What should we call you?");

    // Exactly one screen-level heading, and exactly the two documented
    // buttons — a carousel would add next/skip/dot controls, a permission
    // prompt would add an Allow/Enable control.
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Start a household" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I have a join code" })).toBeInTheDocument();
    expect(screen.queryByText(/enable notifications|allow notifications|skip/i)).not.toBeInTheDocument();
  });
});
