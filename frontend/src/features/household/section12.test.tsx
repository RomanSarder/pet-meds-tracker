// SPEC §12 cross-screen sharing conformance:
//   - "A removed member's name still renders on their historical events."
//   - "Renaming a member updates their name on every past event."
//   - "No email address is rendered anywhere in the UI."
// See CONTRACT-W8.md §2 ("Attribution renders only through displayNameFor
// … Email: rendered in exactly ONE place in the whole app") and §7.
//
// The first two cases are proven directly against the repo + domain helper,
// the way the SPEC frames them ("A removed member's name still renders…
// (via displayNameFor + listUsers({ includeRemoved: true }))") — no screen
// in this slice renders the event log itself (`features/history/**` is
// frozen, W6's surface), so asserting at that boundary is both the most
// direct proof and the one this worker is scoped to write.
//
// The email sweep follows the mocking pattern in
// `frontend/src/features/household/YourNamePanel.test.tsx`: the signed-in
// address only ever comes from `useSessionEmail` (`apiClient` mocked here),
// never from `User.email`, which is why every seeded user below carries a
// *wrong* email on purpose — if anything rendered `User.email` instead of
// going through `displayNameFor`/`useSessionEmail`, this would catch it.
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor as rtlWaitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import { displayNameFor, newId, occurrenceKeyFor } from "@/domain";
import type { DoseEvent, Household, User } from "@/domain";
import { apiClient } from "@/shared/api";
import { HouseholdPage } from "./HouseholdPage";
import { JoinHouseholdPage } from "./JoinHouseholdPage";
import { YourNamePanel } from "./YourNamePanel";
import { FirstRunPage } from "@/features/onboarding/FirstRunPage";
import { PetsPage } from "@/features/pets/PetsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";

vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  apiClient: vi.fn(),
}));

const mockApiClient = vi.mocked(apiClient);

// A longer timeout than testing-library's 1000ms default: the sweep renders
// full screens whose member/self data resolves through a chain of
// query-driven effects, which can outrun the default under a loaded test run.
function waitFor<T>(callback: () => T | Promise<T>): Promise<T> {
  return rtlWaitFor(callback, { timeout: 3000 });
}

beforeEach(() => {
  // The session the sweep must not leak: a resolved, real-looking address.
  mockApiClient.mockResolvedValue({ id: "u-roman", email: "roman@example.com" });
});

const HOUSEHOLD_ID = "z1111111-0000-4000-8000-000000000001";

function household(): Household {
  return {
    id: HOUSEHOLD_ID,
    name: "Home",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    deletedAt: null,
  };
}

function user(overrides: Partial<User> & Pick<User, "id" | "displayName">): User {
  return {
    householdId: HOUSEHOLD_ID,
    email: null,
    tint: 1,
    isSelf: false,
    joinedAt: "2026-06-01T09:00:00.000Z",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function doseEventBy(actorId: string, overrides: Partial<DoseEvent> = {}): DoseEvent {
  const ts = "2026-07-01T09:00:00.000Z";
  const courseId = overrides.courseId ?? "course-1";
  const scheduledFor = overrides.scheduledFor ?? null;
  return {
    id: newId(),
    courseId,
    scheduledFor,
    status: "given",
    loggedAt: ts,
    givenAt: ts,
    amount: 1,
    note: null,
    occurrenceKey: occurrenceKeyFor(courseId, scheduledFor),
    supersedesId: null,
    actorId,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
    ...overrides,
  };
}

describe("SPEC §12 — a removed member's history is never rewritten", () => {
  it("still renders their name via displayNameFor + listUsers({ includeRemoved: true })", async () => {
    const roman = user({ id: "u-roman", displayName: "Roman", isSelf: true });
    const marta = user({ id: "u-marta", displayName: "Marta", tint: 2 });
    const event = doseEventBy(marta.id);
    const repo = createMemoryRepo({
      household: household(),
      users: [roman, marta],
      joinCodes: [],
      pets: [],
      medications: [],
      courses: [],
      doseEvents: [event],
      stockAdjustments: [],
    });

    await repo.removeUser(marta.id);

    // Removed: no longer a live member…
    const liveUsers = await repo.listUsers();
    expect(liveUsers.some((u) => u.id === marta.id)).toBe(false);

    // …but her historical event is untouched and her name still resolves —
    // history reads through `listUsers({ includeRemoved: true })`, never a
    // denormalised name on the event row.
    const allUsers = await repo.listUsers({ includeRemoved: true });
    const events = await repo.listDoseEvents({});
    const martaEvent = events.find((e) => e.id === event.id);
    expect(martaEvent).toBeDefined();
    expect(martaEvent!.actorId).toBe(marta.id);
    expect(displayNameFor(martaEvent!.actorId, allUsers)).toBe("Marta");
  });
});

describe("SPEC §12 — renaming a member is retroactive", () => {
  it("updates the name every past event renders, proving names are never denormalised onto event rows", async () => {
    const roman = user({ id: "u-roman", displayName: "Roman", isSelf: true });
    const marta = user({ id: "u-marta", displayName: "Marta", tint: 2 });
    const eventA = doseEventBy(marta.id, { givenAt: "2026-07-01T09:00:00.000Z" });
    const eventB = doseEventBy(marta.id, {
      courseId: "course-2",
      givenAt: "2026-07-02T09:00:00.000Z",
    });
    const repo = createMemoryRepo({
      household: household(),
      users: [roman, marta],
      joinCodes: [],
      pets: [],
      medications: [],
      courses: [],
      doseEvents: [eventA, eventB],
      stockAdjustments: [],
    });

    await repo.updateUser(marta.id, { displayName: "Martina" });

    const users = await repo.listUsers({ includeRemoved: true });
    const events = await repo.listDoseEvents({});
    const martaEvents = events.filter((e) => e.actorId === marta.id);
    // Sanity: there is more than one past event under this actor, or "every
    // past event" would be proven vacuously by a single row.
    expect(martaEvents.length).toBe(2);
    for (const event of martaEvents) {
      expect(displayNameFor(event.actorId, users)).toBe("Martina");
    }
    // The old name is gone, not merely supplemented.
    expect(martaEvents.every((event) => displayNameFor(event.actorId, users) !== "Marta")).toBe(true);
  });
});

// --- the sweep -------------------------------------------------------------

/** Matches any plausible email address — the shape the sweep must never find. */
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.]+/;

/**
 * Every user carries the WRONG email on purpose (`marta@example.com` on
 * both rows, never matching the mocked session's `roman@example.com`): the
 * only way either address could appear on screen is a component that reads
 * `User.email` directly, which SPEC §5/§12 forbid.
 */
function sweepRepo() {
  const roman = user({ id: "u-roman", displayName: "Roman", isSelf: true, email: "marta@example.com" });
  const marta = user({ id: "u-marta", displayName: "Marta", tint: 2, email: "marta@example.com" });
  return createMemoryRepo({
    household: household(),
    users: [roman, marta],
    joinCodes: [],
    pets: [],
    medications: [],
    courses: [],
    doseEvents: [],
    stockAdjustments: [],
  });
}

// One row per screen. Adding a screen to the sweep later is exactly one
// line here: a render thunk plus a readiness check that proves the
// member/self data (the only place an email could leak from) has loaded
// before the assertion runs.
const SWEPT_SCREENS: Array<{
  name: string;
  render: () => ReactElement;
  waitForReady: () => Promise<unknown>;
}> = [
  {
    name: "HouseholdPage",
    render: () => <HouseholdPage />,
    waitForReady: () => screen.findByText("Marta"),
  },
  {
    name: "JoinHouseholdPage",
    render: () => <JoinHouseholdPage />,
    waitForReady: () =>
      waitFor(() => expect(screen.getByRole("textbox", { name: "Your name" })).toHaveValue("Roman")),
  },
  {
    name: "FirstRunPage",
    render: () => <FirstRunPage />,
    waitForReady: () =>
      waitFor(() => expect(screen.getByRole("textbox", { name: "Your name" })).toHaveValue("Roman")),
  },
  {
    name: "PetsPage",
    render: () => <PetsPage />,
    waitForReady: () => screen.findByText("Household · 2 people"),
  },
  // Added after a review-lens pass found this screen rendering `user.email` on
  // its "Signed in" card. SettingsPage predates SPEC §12 — it is exactly the
  // class of screen this sweep exists to catch: one nobody was thinking about
  // when the no-email rule was written.
  {
    name: "SettingsPage",
    render: () => <SettingsPage />,
    waitForReady: () => screen.findByText("Signed in as Roman"),
  },
];

describe("SPEC §12 — no email address is rendered anywhere in the UI", () => {
  it.each(SWEPT_SCREENS)("$name renders no email address anywhere", async ({ render, waitForReady }) => {
    const repo = sweepRepo();
    const { container } = renderWithProviders(render(), { repo });

    await waitForReady();

    expect(container.textContent ?? "").not.toMatch(EMAIL_REGEX);
  });

  // Positive control: proves the regex above actually matches a rendered
  // address, so a bug that made every screen above render literally nothing
  // could never make this sweep pass vacuously.
  it("positive control: the sweep regex DOES match a rendered address", async () => {
    const repo = sweepRepo();
    const { container } = renderWithProviders(<YourNamePanel onClose={() => {}} />, { repo });

    await screen.findByText(/Signed in as roman@example\.com/);

    expect(container.textContent ?? "").toMatch(EMAIL_REGEX);
  });

  // The one sanctioned exception, asserted on its own: SPEC §6.5's
  // reassurance line, sourced from the session (`useSessionEmail`), never
  // from `User.email`.
  it("the Your-name panel is the single sanctioned exception, and names the signed-in session email", async () => {
    const repo = sweepRepo();
    renderWithProviders(<YourNamePanel onClose={() => {}} />, { repo });

    expect(
      await screen.findByText(
        "Signed in as roman@example.com. Your email is never shown to anyone in the household.",
      ),
    ).toBeInTheDocument();
  });
});
