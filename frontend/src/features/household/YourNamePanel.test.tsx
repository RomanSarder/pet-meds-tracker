import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import type { Household, User } from "@/domain";
import { apiClient } from "@/shared/api";
import { YourNamePanel } from "./YourNamePanel";

// The signed-in address comes from the auth session, never from `User.email`
// (which the repo leaves null). Mocking the one call `useSessionEmail` makes is
// what lets this file prove BOTH halves of the SPEC §6.5 / §12 email paradox:
// the reassurance line names the address, and no other screen can.
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  apiClient: vi.fn(),
}));

const mockApiClient = vi.mocked(apiClient);

beforeEach(() => {
  // Default: no session resolved, so nothing may render an address.
  mockApiClient.mockRejectedValue(new Error("no session"));
});

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

describe("YourNamePanel", () => {
  it("renders as a dialog seeded with the current display name and the join date", async () => {
    const repo = repoWith([user({})]);
    renderWithProviders(<YourNamePanel onClose={() => {}} />, { repo });

    await screen.findByRole("dialog", { name: "Your name" });
    expect(await screen.findByText("In this household since 12 Jun")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Display name" }) as HTMLInputElement;
    expect(input).toHaveValue("Roman");
  });

  it("shows a live N / 24 counter as the field is typed, capped at 24 characters", async () => {
    const repo = repoWith([user({})]);
    renderWithProviders(<YourNamePanel onClose={() => {}} />, { repo });

    const input = await screen.findByRole("textbox", { name: "Display name" });
    expect(input).toHaveAttribute("maxlength", "24");
    expect(await screen.findByText("5 / 24")).toBeInTheDocument();

    const user2 = userEvent.setup();
    await user2.clear(input);
    await user2.type(input, "Romanoff");
    expect(await screen.findByText("8 / 24")).toBeInTheDocument();
  });

  it("names the other member in the retroactive helper copy", async () => {
    const repo = repoWith([
      user({ id: "u-self", displayName: "Roman" }),
      user({ id: "u-marta", displayName: "Marta", isSelf: false, tint: 2 }),
    ]);
    renderWithProviders(<YourNamePanel onClose={() => {}} />, { repo });

    expect(
      await screen.findByText(
        "Shown against every dose you log. Marta will see the new name everywhere, including on doses you logged before.",
      ),
    ).toBeInTheDocument();
  });

  it("falls back to 'Everyone in the household' when there is nobody else", async () => {
    const repo = repoWith([user({})]);
    renderWithProviders(<YourNamePanel onClose={() => {}} />, { repo });

    expect(
      await screen.findByText(
        "Shown against every dose you log. Everyone in the household will see the new name everywhere, including on doses you logged before.",
      ),
    ).toBeInTheDocument();
  });

  it("live-updates the 'How it will look' preview as the name is typed", async () => {
    const repo = repoWith([user({})]);
    renderWithProviders(<YourNamePanel onClose={() => {}} />, { repo });

    const input = await screen.findByRole("textbox", { name: "Display name" });
    expect(await screen.findByText("by Roman")).toBeInTheDocument();

    const user2 = userEvent.setup();
    await user2.clear(input);
    await user2.type(input, "Ilya");
    expect(await screen.findByText("by Ilya")).toBeInTheDocument();
  });

  it("renders the reassurance line with the signed-in email, and nowhere else does", async () => {
    mockApiClient.mockResolvedValue({ id: "u-self", email: "roman@example.com" });
    const repo = repoWith([user({})]);
    renderWithProviders(<YourNamePanel onClose={() => {}} />, { repo });

    expect(
      await screen.findByText(
        "Signed in as roman@example.com. Your email is never shown to anyone in the household.",
      ),
    ).toBeInTheDocument();
  });

  it("renders only the generic reassurance sentence when the session has no email yet", async () => {
    const repo = repoWith([user({})]);
    renderWithProviders(<YourNamePanel onClose={() => {}} />, { repo });

    expect(
      await screen.findByText("Your email is never shown to anyone in the household."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
  });

  it("disables Save for an empty or whitespace-only name, and does not save it", async () => {
    const repo = repoWith([user({})]);
    renderWithProviders(<YourNamePanel onClose={() => {}} />, { repo });

    const input = await screen.findByRole("textbox", { name: "Display name" });
    const save = screen.getByRole("button", { name: "Save name" });
    expect(save).toBeEnabled();

    const user2 = userEvent.setup();
    await user2.clear(input);
    await user2.type(input, "   ");
    expect(save).toBeDisabled();

    await user2.click(save);
    const stillSelf = await repo.getCurrentUser();
    expect(stillSelf.displayName).toBe("Roman");
  });

  it("saves a trimmed name via useSetDisplayName and closes the overlay", async () => {
    const repo = repoWith([user({})]);
    let closed = false;
    renderWithProviders(<YourNamePanel onClose={() => (closed = true)} />, { repo });

    const input = await screen.findByRole("textbox", { name: "Display name" });
    const user2 = userEvent.setup();
    await user2.clear(input);
    await user2.type(input, "  Romi  ");
    await user2.click(screen.getByRole("button", { name: "Save name" }));

    expect(closed).toBe(true);
    const self = await repo.getCurrentUser();
    expect(self.displayName).toBe("Romi");
  });
});
