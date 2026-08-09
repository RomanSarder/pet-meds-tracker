import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { useRouterState } from "@tanstack/react-router";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import type { Household, JoinCode, Pet, User } from "@/domain";
import { apiClient } from "@/shared/api";
import { joinCodeRejectionMessage } from "./joinCode";
import { JoinHouseholdPage } from "./JoinHouseholdPage";

// Same pattern as YourNamePanel.test.tsx / HouseholdPage.test.tsx: mock the
// session lookup `useSessionEmail` makes so tests control what it resolves.
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

function pet(overrides: Partial<Pet>): Pet {
  return {
    id: "p-1",
    name: "Clover",
    species: "rabbit",
    birthdate: null,
    weightGrams: null,
    tint: 1,
    archived: false,
    householdId: "hh-other",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

// `householdId` deliberately differs from `HOUSEHOLD.id` (self's own
// household): CONTRACT-W8.md §0 — the frontend only ever models one
// household locally, so `getRepo().listPets()` stands in for "the pets of
// the household behind this code". Keeping the code's householdId distinct
// from self's throughout means a successful redemption never trips the
// unrelated "already_in_household" refusal these tests are not about.
function joinCode(overrides: Partial<JoinCode>): JoinCode {
  return {
    id: "jc-1",
    householdId: "hh-other",
    code: "ABCDEF",
    createdBy: "u-elsewhere",
    expiresAt: "2026-08-09T07:00:00.000Z",
    usedBy: null,
    revokedAt: null,
    createdAt: "2026-08-08T06:00:00.000Z",
    updatedAt: "2026-08-08T06:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function repoWith(opts: { users: User[]; joinCodes?: JoinCode[]; pets?: Pet[] }) {
  return createMemoryRepo({
    household: HOUSEHOLD,
    users: opts.users,
    joinCodes: opts.joinCodes ?? [],
    pets: opts.pets ?? [],
    medications: [],
    courses: [],
    doseEvents: [],
    stockAdjustments: [],
  });
}

function LocationProbe() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return <span data-testid="pathname">{pathname}</span>;
}

function renderJoin(opts?: Parameters<typeof renderWithProviders>[1]) {
  return renderWithProviders(
    <>
      <JoinHouseholdPage />
      <LocationProbe />
    </>,
    opts,
  );
}

async function typeCode(user2: ReturnType<typeof userEvent.setup>, code: string) {
  const box1 = await screen.findByRole("textbox", { name: "Code character 1" });
  await user2.type(box1, code);
}

describe("JoinHouseholdPage", () => {
  it("SPEC §5 step 3: lists the pets being joined before joining", async () => {
    const self = user({ id: "u-self" });
    const code = joinCode({ code: "ABCDEF" });
    const clover = pet({ id: "p-1", name: "Clover", species: "rabbit" });
    const repo = repoWith({ users: [self], joinCodes: [code], pets: [clover] });
    renderJoin({ repo });

    expect(
      await screen.findByText("Enter the code to see what you are joining"),
    ).toBeInTheDocument();

    const user2 = userEvent.setup();
    await typeCode(user2, "ABCDEF");

    expect(await screen.findByText("Clover · Rabbit")).toBeInTheDocument();
    expect(screen.queryByText("Enter the code to see what you are joining")).not.toBeInTheDocument();

    // The preview must not itself have joined anything.
    expect((await repo.getJoinCodeByCode("ABCDEF"))?.usedBy).toBeNull();
  });

  it('SPEC §5: joining is explicit, not on the last keystroke — only pressing "Join household" joins', async () => {
    const self = user({ id: "u-self" });
    const code = joinCode({ code: "ABCDEF" });
    const repo = repoWith({ users: [self], joinCodes: [code] });
    renderJoin({ repo });

    const user2 = userEvent.setup();
    await typeCode(user2, "ABCDEF");

    const joinButton = screen.getByRole("button", { name: "Join household" });
    await waitFor(() => expect(joinButton).toBeEnabled());

    // Typing the last character alone must not have joined.
    expect((await repo.getJoinCodeByCode("ABCDEF"))?.usedBy).toBeNull();
    expect(screen.getByTestId("pathname")).toHaveTextContent("/");

    await user2.click(joinButton);

    await waitFor(async () => {
      expect((await repo.getJoinCodeByCode("ABCDEF"))?.usedBy).not.toBeNull();
    });
  });

  it("refuses a code that was already used, with the used-code message, and stays on the screen", async () => {
    const self = user({ id: "u-self" });
    const code = joinCode({ code: "ABCDEF", usedBy: "someone-else" });
    const repo = repoWith({ users: [self], joinCodes: [code] });
    renderJoin({ repo });

    const user2 = userEvent.setup();
    await typeCode(user2, "ABCDEF");
    await user2.click(await screen.findByRole("button", { name: "Join household" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      joinCodeRejectionMessage("already_used"),
    );
    expect(screen.getByTestId("pathname")).toHaveTextContent("/");
    expect(screen.getByRole("textbox", { name: "Code character 1" })).toBeInTheDocument();
  });

  it("refuses a code past its expiry, with the expired message, and stays on the screen", async () => {
    const self = user({ id: "u-self" });
    const code = joinCode({ code: "ABCDEF", expiresAt: "2026-08-01T00:00:00.000Z" });
    const repo = repoWith({ users: [self], joinCodes: [code] });
    renderJoin({ repo });

    const user2 = userEvent.setup();
    await typeCode(user2, "ABCDEF");
    await user2.click(await screen.findByRole("button", { name: "Join household" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      joinCodeRejectionMessage("expired"),
    );
    expect(screen.getByTestId("pathname")).toHaveTextContent("/");
    expect(screen.getByRole("textbox", { name: "Code character 1" })).toBeInTheDocument();
  });

  it("refuses a code revoked because a newer one was issued, with the revoked message, and stays on the screen", async () => {
    const self = user({ id: "u-self" });
    const code = joinCode({ code: "ABCDEF", revokedAt: "2026-08-08T06:30:00.000Z" });
    const repo = repoWith({ users: [self], joinCodes: [code] });
    renderJoin({ repo });

    const user2 = userEvent.setup();
    await typeCode(user2, "ABCDEF");
    await user2.click(await screen.findByRole("button", { name: "Join household" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      joinCodeRejectionMessage("revoked"),
    );
    expect(screen.getByTestId("pathname")).toHaveTextContent("/");
    expect(screen.getByRole("textbox", { name: "Code character 1" })).toBeInTheDocument();
  });

  it("accepts a pasted six-character code and rejects characters outside the alphabet", async () => {
    const self = user({ id: "u-self" });
    const repo = repoWith({ users: [self] });
    renderJoin({ repo });

    const boxes = (await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) => screen.findByRole("textbox", { name: `Code character ${n}` })),
    )) as HTMLInputElement[];

    const user2 = userEvent.setup();

    // "O" and "0" are excluded from the alphabet (ambiguous with 0/O) — both rejected.
    await user2.type(boxes[0], "O");
    expect(boxes[0]).toHaveValue("");
    await user2.type(boxes[0], "0");
    expect(boxes[0]).toHaveValue("");

    // A pasted string keeps only alphabet characters, uppercased, filling the six boxes.
    await user2.click(boxes[0]);
    await user2.paste("a-b-c-d-e-f");

    expect(boxes.map((b) => b.value).join("")).toBe("ABCDEF");
  });
});
