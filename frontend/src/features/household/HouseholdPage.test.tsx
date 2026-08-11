import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { HouseholdStateDto } from "@pet-tracker/shared";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import type { DoseEvent, Household, JoinCode, User } from "@/domain";
import { DEFAULT_SELF_DISPLAY_NAME } from "@/domain";
import { apiClient } from "@/shared/api";
import { createTranslator } from "@/i18n";
import { HouseholdPage } from "./HouseholdPage";

// Same pattern as YourNamePanel.test.tsx: the reassurance line is the only
// place an email may render, so every other screen (this one included) must
// prove it never resolves one, whatever the auth session returns.
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  apiClient: vi.fn(),
}));

const mockApiClient = vi.mocked(apiClient);

beforeEach(() => {
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

function doseEvent(overrides: Partial<DoseEvent>): DoseEvent {
  return {
    id: "d1",
    courseId: "c1",
    scheduledFor: null,
    status: "given",
    loggedAt: "2026-08-08T06:00:00.000Z",
    givenAt: "2026-08-08T06:00:00.000Z",
    amount: 1,
    note: null,
    occurrenceKey: "c1|-",
    supersedesId: null,
    actorId: "u-self",
    createdAt: "2026-08-08T06:00:00.000Z",
    updatedAt: "2026-08-08T06:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function joinCode(overrides: Partial<JoinCode>): JoinCode {
  return {
    id: "jc-1",
    householdId: HOUSEHOLD.id,
    code: "ABCDEF",
    createdBy: "u-self",
    expiresAt: "2026-08-09T07:00:00.000Z",
    usedBy: null,
    revokedAt: null,
    createdAt: "2026-08-08T06:00:00.000Z",
    updatedAt: "2026-08-08T06:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function repoWith(opts: { users: User[]; doseEvents?: DoseEvent[]; joinCodes?: JoinCode[] }) {
  return createMemoryRepo({
    household: HOUSEHOLD,
    users: opts.users,
    joinCodes: opts.joinCodes ?? [],
    pets: [],
    medications: [],
    courses: [],
    doseEvents: opts.doseEvents ?? [],
    stockAdjustments: [],
  });
}

describe("HouseholdPage", () => {
  it("renders every member's name and second line, with self showing 'You · joined ‹date›'", async () => {
    const self = user({ id: "u-self", displayName: "Roman", joinedAt: "2026-06-12T09:00:00.000Z" });
    const marta = user({
      id: "u-marta",
      displayName: "Marta",
      isSelf: false,
      tint: 2,
      joinedAt: "2026-06-20T09:00:00.000Z",
    });
    const ilya = user({
      id: "u-ilya",
      displayName: "Ilya",
      isSelf: false,
      tint: 3,
      joinedAt: "2026-07-01T09:00:00.000Z",
    });
    // Marta logged two doses within the last 7 days (of FIXTURE_NOW,
    // 2026-08-08T07:00:00.000Z); Ilya logged none, so falls back to "Joined".
    const events = [
      doseEvent({ id: "d1", actorId: "u-marta", status: "given", loggedAt: "2026-08-07T09:00:00.000Z" }),
      doseEvent({ id: "d2", actorId: "u-marta", status: "given", loggedAt: "2026-08-08T05:00:00.000Z" }),
    ];
    const repo = repoWith({ users: [self, marta, ilya], doseEvents: events });
    renderWithProviders(<HouseholdPage />, { repo });

    expect(await screen.findByText("Roman")).toBeInTheDocument();
    expect(screen.getByText("You · joined 12 Jun")).toBeInTheDocument();

    expect(screen.getByText("Marta")).toBeInTheDocument();
    expect(screen.getByText("Logged 2 doses this week")).toBeInTheDocument();

    expect(screen.getByText("Ilya")).toBeInTheDocument();
    expect(screen.getByText("Joined 1 Jul")).toBeInTheDocument();
  });

  it("household.peopleCount: real Ukrainian one/few/many plural forms at n = 1, 2, 5, 21", () => {
    const uk = createTranslator("uk");
    expect(uk.t("household.peopleCount", { count: 1 })).toBe("1 особа");
    expect(uk.t("household.peopleCount", { count: 2 })).toBe("2 особи");
    expect(uk.t("household.peopleCount", { count: 5 })).toBe("5 осіб");
    expect(uk.t("household.peopleCount", { count: 21 })).toBe("21 особа");
  });

  it("subtitle counts people and singularises at one person", async () => {
    const self = user({ id: "u-self" });
    const repoOne = repoWith({ users: [self] });
    const { unmount } = renderWithProviders(<HouseholdPage />, { repo: repoOne });
    expect(await screen.findByText("1 person · everyone can log and edit")).toBeInTheDocument();
    unmount();

    const marta = user({ id: "u-marta", displayName: "Marta", isSelf: false, tint: 2 });
    const repoTwo = repoWith({ users: [self, marta] });
    renderWithProviders(<HouseholdPage />, { repo: repoTwo });
    expect(await screen.findByText("2 people · everyone can log and edit")).toBeInTheDocument();
  });

  it("Edit on the self row opens the Your-name overlay", async () => {
    const self = user({ id: "u-self" });
    const repo = repoWith({ users: [self] });
    renderWithProviders(<HouseholdPage />, { repo });

    const user2 = userEvent.setup();
    await user2.click(await screen.findByRole("button", { name: "Edit your name" }));

    expect(await screen.findByRole("dialog", { name: "Your name" })).toBeInTheDocument();
  });

  it("the overflow on another member asks for confirmation before removing, and only removes after it", async () => {
    const self = user({ id: "u-self" });
    const marta = user({ id: "u-marta", displayName: "Marta", isSelf: false, tint: 2 });
    const repo = repoWith({ users: [self, marta] });
    renderWithProviders(<HouseholdPage />, { repo });

    const user2 = userEvent.setup();
    await user2.click(await screen.findByRole("button", { name: "More options for Marta" }));
    await user2.click(await screen.findByRole("menuitem", { name: "Remove from household" }));

    const dialog = await screen.findByRole("dialog", { name: "Remove Marta?" });

    // Nothing removed yet — the dialog is open but unconfirmed.
    expect((await repo.listUsers()).map((u) => u.id)).toContain("u-marta");
    expect(screen.getByText("Marta")).toBeInTheDocument();

    await user2.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(async () => {
      expect((await repo.listUsers()).map((u) => u.id)).not.toContain("u-marta");
    });
    expect(screen.queryByText("Marta")).not.toBeInTheDocument();
  });

  it("SPEC §5: the live code renders as six characters; New code issues a fresh one and revokes the previous", async () => {
    const self = user({ id: "u-self" });
    const code = joinCode({ id: "jc-1", code: "ABCDEF" });
    const repo = repoWith({ users: [self], joinCodes: [code] });
    // Defect 2 sibling fix: issuing now calls the backend (`POST
    // /household/codes`, W8) first — the server is the authority on "only
    // one code live per household" — and mirrors its response into the
    // local row this screen actually renders (SPEC §9: local is the read
    // source).
    mockApiClient.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/household/codes" && options?.method === "POST") {
        return {
          id: "jc-server-2",
          householdId: HOUSEHOLD.id,
          code: "ZYXWVU",
          createdBy: "u-self",
          expiresAt: "2026-08-10T07:00:00.000Z",
          usedBy: null,
          revokedAt: null,
          createdAt: "2026-08-08T07:00:00.000Z",
        };
      }
      return Promise.reject(new Error("no session"));
    });
    renderWithProviders(<HouseholdPage />, { repo });

    const group = await screen.findByRole("group", { name: "Join code ABCDEF" });
    expect(group.textContent).toBe("ABCDEF");
    expect(group.children).toHaveLength(6);

    const user2 = userEvent.setup();
    await user2.click(screen.getByRole("button", { name: "New code" }));

    await waitFor(() => {
      expect(screen.getByRole("group")).not.toHaveAccessibleName("Join code ABCDEF");
    });

    expect(mockApiClient).toHaveBeenCalledWith("/household/codes", expect.objectContaining({ method: "POST" }));

    const codesAfter = await repo.listJoinCodes();
    const original = codesAfter.find((c) => c.id === "jc-1");
    expect(original?.revokedAt).not.toBeNull();

    // One live code per household, always.
    const live = codesAfter.filter((c) => c.revokedAt === null && c.usedBy === null);
    expect(live).toHaveLength(1);
    expect(live[0].id).not.toBe("jc-1");
    expect(live[0].code).toBe("ZYXWVU");
  });

  it("SPEC §5: invite actions are disabled while the self row still carries the placeholder name", async () => {
    const self = user({ id: "u-self", displayName: DEFAULT_SELF_DISPLAY_NAME });
    const repo = repoWith({ users: [self] });
    renderWithProviders(<HouseholdPage />, { repo });

    expect(await screen.findByText("Add your name before inviting anyone")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create a code" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy code" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New code" })).not.toBeInTheDocument();

    const user2 = userEvent.setup();
    await user2.click(screen.getByRole("button", { name: "Set your name" }));
    expect(await screen.findByRole("dialog", { name: "Your name" })).toBeInTheDocument();
  });

  it("Leave household asks for confirmation, and nothing happens before it is pressed", async () => {
    const self = user({ id: "u-self" });
    const marta = user({ id: "u-marta", displayName: "Marta", isSelf: false, tint: 2 });
    const repo = repoWith({ users: [self, marta] });
    renderWithProviders(<HouseholdPage />, { repo });

    const user2 = userEvent.setup();
    await user2.click(await screen.findByRole("button", { name: "Leave household" }));

    const dialog = await screen.findByRole("dialog", { name: "Leave household?" });
    expect(
      within(dialog).getByText(
        "You will lose access to the pets, schedules and history in this household. You can rejoin later with a new invite code.",
      ),
    ).toBeInTheDocument();

    // Nothing happens until confirmed.
    expect((await repo.listUsers()).map((u) => u.id)).toContain("u-self");

    await user2.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect((await repo.listUsers()).map((u) => u.id)).toContain("u-self");
  });

  it("Leave household states the household will be deleted when this is the last member, and only deletes on confirm", async () => {
    const self = user({ id: "u-self" });
    const repo = repoWith({ users: [self] });
    renderWithProviders(<HouseholdPage />, { repo });

    const user2 = userEvent.setup();
    await user2.click(await screen.findByRole("button", { name: "Leave household" }));

    const dialog = await screen.findByRole("dialog", { name: "Leave household?" });
    expect(
      within(dialog).getByText(
        "You are the last member. Leaving will delete this household and everything in it — pets, schedules and history — for good.",
      ),
    ).toBeInTheDocument();

    // Nothing happens until confirmed.
    expect(await repo.listUsers()).toHaveLength(1);

    await user2.click(within(dialog).getByRole("button", { name: "Delete household" }));

    await waitFor(async () => {
      expect(await repo.listUsers()).toHaveLength(0);
    });
  });
});

// The reported defect: someone redeems a join code, the server records them,
// and the inviter's People list stays at one person forever. `users` is not a
// synced table (`packages/shared/src/sync.ts` carries six, none of them
// users), so `GET /household` is the only way a second member reaches this
// device at all.
describe("HouseholdPage — members the server knows about", () => {
  function mockHouseholdState(state: HouseholdStateDto) {
    mockApiClient.mockImplementation(async (path: string) => {
      if (path !== "/household") {
        return Promise.reject(new Error("no session"));
      }
      return state as unknown as never;
    });
  }

  it("shows a member who exists only on the server, and counts them", async () => {
    const self = user({ id: "u-self", displayName: "Roman" });
    const repo = repoWith({ users: [self] });
    mockHouseholdState({
      household: { id: HOUSEHOLD.id, name: "Home", createdAt: HOUSEHOLD.createdAt },
      members: [
        { id: "srv-self", householdId: HOUSEHOLD.id, displayName: "Roman", tint: 1, joinedAt: "2026-06-12T09:00:00.000Z" },
        { id: "srv-marta", householdId: HOUSEHOLD.id, displayName: "Marta", tint: 2, joinedAt: "2026-08-01T09:00:00.000Z" },
      ],
      self: {
        id: "srv-self",
        householdId: HOUSEHOLD.id,
        displayName: "Roman",
        tint: 1,
        joinedAt: "2026-06-12T09:00:00.000Z",
        email: "roman@example.com",
      },
    });

    renderWithProviders(<HouseholdPage />, { repo });

    expect(await screen.findByText("Marta")).toBeInTheDocument();
    expect(await screen.findByText("2 people · everyone can log and edit")).toBeInTheDocument();

    // Mirrored into the local store, so every other screen's local read of
    // `listUsers()` resolves the name too.
    await waitFor(async () => {
      expect((await repo.listUsers()).map((u) => u.displayName).sort()).toEqual(["Marta", "Roman"]);
    });
  });

  it("does not render self twice when the server's user id differs from the local one", async () => {
    // `users.id` server-side is the auth identity; the local self row is a
    // device-minted uuid. Mirroring the server's row for self verbatim would
    // add a second "Roman" rather than reconcile anything.
    const self = user({ id: "local-self-uuid", displayName: "Roman" });
    const repo = repoWith({ users: [self] });
    mockHouseholdState({
      household: { id: HOUSEHOLD.id, name: "Home", createdAt: HOUSEHOLD.createdAt },
      members: [
        { id: "srv-self", householdId: HOUSEHOLD.id, displayName: "Roman", tint: 1, joinedAt: "2026-06-12T09:00:00.000Z" },
      ],
      self: {
        id: "srv-self",
        householdId: HOUSEHOLD.id,
        displayName: "Roman",
        tint: 1,
        joinedAt: "2026-06-12T09:00:00.000Z",
        email: "roman@example.com",
      },
    });

    renderWithProviders(<HouseholdPage />, { repo });

    expect(await screen.findByText("1 person · everyone can log and edit")).toBeInTheDocument();
    await waitFor(() => expect(mockApiClient).toHaveBeenCalledWith("/household"));
    expect(await repo.listUsers()).toHaveLength(1);
    expect(screen.getByText("1 person · everyone can log and edit")).toBeInTheDocument();
  });

  it("keeps rendering the local roster when the refresh fails (offline)", async () => {
    // `beforeEach` already rejects every call — the local store is the read
    // source, so a failed refresh must leave the screen exactly as it was.
    const self = user({ id: "u-self", displayName: "Roman" });
    const marta = user({ id: "u-marta", displayName: "Marta", isSelf: false, tint: 2 });
    const repo = repoWith({ users: [self, marta] });

    renderWithProviders(<HouseholdPage />, { repo });

    expect(await screen.findByText("Marta")).toBeInTheDocument();
    expect(screen.getByText("2 people · everyone can log and edit")).toBeInTheDocument();
  });
});
