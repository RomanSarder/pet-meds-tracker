import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { useRouterState } from "@tanstack/react-router";
import type { HouseholdStateDto } from "@pet-tracker/shared";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import type { Household, JoinCode, Pet, User } from "@/domain";
import { apiClient, ApiError } from "@/shared/api";
import { createTranslator } from "@/i18n";
import { joinCodeRejectionMessage } from "./joinCode";
import { JoinHouseholdPage } from "./JoinHouseholdPage";

const EN = createTranslator("en");

// Same pattern as YourNamePanel.test.tsx / HouseholdPage.test.tsx: mock the
// session lookup `useSessionEmail` makes so tests control what it resolves.
// `apiClient` is also how redemption itself now travels (defect 2 — Join
// household used to only call the local repo), so most tests here give it a
// per-path implementation rather than a single blanket resolve/reject.
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

/** The `POST /household/join` success body — the household on the OTHER end of the code. */
function householdStateDto(overrides?: Partial<HouseholdStateDto>): HouseholdStateDto {
  return {
    household: { id: "hh-server", name: "The Clover House", createdAt: "2026-06-01T09:00:00.000Z" },
    members: [{ id: "u-elsewhere", householdId: "hh-server", displayName: "Marta", tint: 2, joinedAt: "2026-06-01T09:00:00.000Z" }],
    self: {
      id: "u-self",
      householdId: "hh-server",
      displayName: "Roman",
      tint: 1,
      joinedAt: "2026-08-08T06:00:00.000Z",
      email: "roman@example.com",
    },
    ...overrides,
  };
}

/** 4xx body `POST /household/join` sends for a refused code (backend/src/household/index.ts `sendJoinCodeRejection`). */
function rejectedError(reason: "already_used" | "expired" | "revoked" | "not_found" | "already_in_household") {
  const status = reason === "not_found" ? 404 : 409;
  return new ApiError(status, "rejected", { error: "join_code_rejected", reason, message: "rejected" });
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

/** Only `/household/join` gets a real implementation; everything else (e.g. `/auth/me`) still rejects. */
function mockJoin(impl: (body: { code: string; displayName?: string }) => HouseholdStateDto) {
  mockApiClient.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path !== "/household/join") {
      return Promise.reject(new Error("no session"));
    }
    const body = JSON.parse((options?.body as string) ?? "{}");
    return impl(body);
  });
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
    expect(mockApiClient).not.toHaveBeenCalledWith("/household/join", expect.anything());
  });

  it('SPEC §5: joining is explicit, not on the last keystroke — only pressing "Join household" joins', async () => {
    const self = user({ id: "u-self" });
    const repo = repoWith({ users: [self] });
    mockJoin(() => householdStateDto());
    renderJoin({ repo });

    const user2 = userEvent.setup();
    await typeCode(user2, "ABCDEF");

    const joinButton = screen.getByRole("button", { name: "Join household" });
    await waitFor(() => expect(joinButton).toBeEnabled());

    // Typing the last character alone must not have called the backend.
    expect(mockApiClient).not.toHaveBeenCalledWith("/household/join", expect.anything());
    expect(screen.getByTestId("pathname")).toHaveTextContent("/");

    await user2.click(joinButton);

    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith("/household/join", expect.objectContaining({ method: "POST" }));
    });
    await waitFor(() => expect(screen.getByTestId("pathname")).toHaveTextContent("/today"));
  });

  it("calls POST /household/join with the entered code and name, and adopts the server's household id locally", async () => {
    const self = user({ id: "u-self", householdId: HOUSEHOLD.id });
    const repo = repoWith({ users: [self] });
    mockJoin(() => householdStateDto());
    renderJoin({ repo });

    const user2 = userEvent.setup();
    await typeCode(user2, "ABCDEF");
    await user2.click(screen.getByRole("button", { name: "Join household" }));

    await waitFor(() => expect(screen.getByTestId("pathname")).toHaveTextContent("/today"));

    const call = mockApiClient.mock.calls.find(([path]) => path === "/household/join");
    expect(call).toBeDefined();
    const [, options] = call!;
    expect(JSON.parse((options as { body: string }).body)).toMatchObject({ code: "ABCDEF", displayName: "Roman" });

    // SPEC §9: local and server ids match after the join, the mirror image
    // of FirstRunPage's provisioning.
    expect(await repo.currentHouseholdId()).toBe("hh-server");
    expect((await repo.getCurrentUser()).householdId).toBe("hh-server");
  });

  it("keeps the people already in the household the join response named", async () => {
    // The mirror image of the inviter's defect: the response carries the
    // household's existing members, and adopting it used to rebuild the local
    // user store from this device's own rows alone — so the joiner landed in a
    // shared household and still saw a roster of one.
    const self = user({ id: "u-self", householdId: HOUSEHOLD.id });
    const repo = repoWith({ users: [self] });
    mockJoin(() => householdStateDto());
    renderJoin({ repo });

    const user2 = userEvent.setup();
    await typeCode(user2, "ABCDEF");
    await user2.click(screen.getByRole("button", { name: "Join household" }));

    await waitFor(() => expect(screen.getByTestId("pathname")).toHaveTextContent("/today"));

    await waitFor(async () => {
      const names = (await repo.listUsers()).map((u) => u.displayName).sort();
      expect(names).toEqual(["Marta", "Roman"]);
    });
    const marta = (await repo.listUsers()).find((u) => u.displayName === "Marta")!;
    expect(marta.isSelf).toBe(false);
    expect(marta.householdId).toBe("hh-server");
  });

  it("refuses a code that was already used, with the used-code message, stays on the screen, and does not join locally", async () => {
    const self = user({ id: "u-self" });
    const repo = repoWith({ users: [self] });
    mockJoin(() => {
      throw rejectedError("already_used");
    });
    renderJoin({ repo });

    const user2 = userEvent.setup();
    await typeCode(user2, "ABCDEF");
    await user2.click(await screen.findByRole("button", { name: "Join household" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      joinCodeRejectionMessage("already_used", EN),
    );
    expect(screen.getByTestId("pathname")).toHaveTextContent("/");
    expect(screen.getByRole("textbox", { name: "Code character 1" })).toBeInTheDocument();
    expect((await repo.getCurrentUser()).householdId).toBe(HOUSEHOLD.id);
  });

  it("refuses a code past its expiry, with the expired message, and stays on the screen", async () => {
    const self = user({ id: "u-self" });
    const repo = repoWith({ users: [self] });
    mockJoin(() => {
      throw rejectedError("expired");
    });
    renderJoin({ repo });

    const user2 = userEvent.setup();
    await typeCode(user2, "ABCDEF");
    await user2.click(await screen.findByRole("button", { name: "Join household" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(joinCodeRejectionMessage("expired", EN));
    expect(screen.getByTestId("pathname")).toHaveTextContent("/");
    expect(screen.getByRole("textbox", { name: "Code character 1" })).toBeInTheDocument();
  });

  it("refuses a code revoked because a newer one was issued, with the revoked message, and stays on the screen", async () => {
    const self = user({ id: "u-self" });
    const repo = repoWith({ users: [self] });
    mockJoin(() => {
      throw rejectedError("revoked");
    });
    renderJoin({ repo });

    const user2 = userEvent.setup();
    await typeCode(user2, "ABCDEF");
    await user2.click(await screen.findByRole("button", { name: "Join household" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(joinCodeRejectionMessage("revoked", EN));
    expect(screen.getByTestId("pathname")).toHaveTextContent("/");
    expect(screen.getByRole("textbox", { name: "Code character 1" })).toBeInTheDocument();
  });

  it("surfaces a generic failure (network down, unexpected server error) instead of joining locally as if it worked", async () => {
    const self = user({ id: "u-self" });
    const repo = repoWith({ users: [self] });
    mockJoin(() => {
      throw new Error("network error");
    });
    renderJoin({ repo });

    const user2 = userEvent.setup();
    await typeCode(user2, "ABCDEF");
    await user2.click(await screen.findByRole("button", { name: "Join household" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
    expect(screen.getByTestId("pathname")).toHaveTextContent("/");
    expect((await repo.getCurrentUser()).householdId).toBe(HOUSEHOLD.id);
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
