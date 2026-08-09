import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { useRouterState } from "@tanstack/react-router";
// `@/test` has no barrel (index) file yet, so this imports the concrete
// module directly rather than the bare `@/test` specifier the brief
// describes — see the final report for why.
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import type { Pet } from "@/domain";
import { fixtures } from "@/domain";
import { ageLabel } from "./age";
import { PetsPage } from "./PetsPage";

// The harness's router is a catch-all and does not hand the test its router
// instance, so the current path is read back out of the tree instead — the
// same pattern TodayPage.test.tsx uses.
function LocationProbe() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return <span data-testid="pathname">{pathname}</span>;
}

function renderPets(opts?: Parameters<typeof renderWithProviders>[1]) {
  return renderWithProviders(
    <>
      <PetsPage />
      <LocationProbe />
    </>,
    opts,
  );
}

function pathname(): string {
  return screen.getByTestId("pathname").textContent ?? "";
}

// The router underlying `renderWithProviders` resolves its first match
// asynchronously (see renderWithProviders.test.tsx), so the first query in
// every test must be a `findBy*`, not a `getBy*`.

const TODAY = "2026-08-08";

function onePetNoCoursesRepo() {
  const pet: Pet = {
    id: "z0000000-0000-4000-8000-000000000099",
    name: "Solo",
    species: "cat",
    birthdate: null,
    weightGrams: null,
    tint: 1,
    archived: false,
    householdId: "test-household-id",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
  return createMemoryRepo({
    pets: [pet],
    medications: [],
    courses: [],
    doseEvents: [],
    stockAdjustments: [],
  });
}

describe("PetsPage", () => {
  it("shows every fixture pet with a species + derived-age meta line", async () => {
    renderWithProviders(<PetsPage />);

    for (const pet of fixtures.pets) {
      await screen.findByText(pet.name);
    }

    const clover = fixtures.pets.find((p) => p.name === "Clover")!;
    const expectedAge = ageLabel(clover.birthdate, TODAY);
    expect(await screen.findByText(`Rabbit · ${expectedAge}`)).toBeInTheDocument();
  });

  it("renders a pet's active courses as badges with the medication name and schedule summary", async () => {
    renderWithProviders(<PetsPage />);
    await screen.findByText("Clover");
    expect(await screen.findByText(/Metacam 0\.4 ml/)).toBeInTheDocument();
  });

  it("never shows 'No active medication' for a pet that has active courses, but does for one with none", async () => {
    renderWithProviders(<PetsPage />);
    await screen.findByText("Clover");
    expect(screen.queryByText("No active medication")).not.toBeInTheDocument();

    const repo = onePetNoCoursesRepo();
    renderWithProviders(<PetsPage />, { repo });
    expect(await screen.findByText("No active medication")).toBeInTheDocument();
  });

  it("shows the empty-roster state with an Add a pet control", async () => {
    const repo = createMemoryRepo({
      pets: [],
      medications: [],
      courses: [],
      doseEvents: [],
      stockAdjustments: [],
    });
    renderWithProviders(<PetsPage />, { repo });

    expect(await screen.findByText("No pets yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a pet" })).toBeInTheDocument();
  });

  it("makes each pet card a keyboard-reachable, activatable control", async () => {
    renderWithProviders(<PetsPage />);
    const card = await screen.findByRole("button", { name: "Open Clover" });

    const user = userEvent.setup();
    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");

    expect(card).toBeInTheDocument();
  });

  it("shows the header's + control with an accessible name", async () => {
    renderWithProviders(<PetsPage />);
    await screen.findByText("Pets");
    expect(screen.getByRole("button", { name: "plus" })).toBeInTheDocument();
  });

  it("shows an 'Add a pet' control at the end of the roster when pets exist", async () => {
    renderWithProviders(<PetsPage />);
    await screen.findByText("Clover");
    expect(screen.getByRole("button", { name: "Add a pet" })).toBeInTheDocument();
  });

  it("navigates to /pets/new when the roster's 'Add a pet' control is activated", async () => {
    renderPets();
    await screen.findByText("Clover");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add a pet" }));

    expect(pathname()).toBe("/pets/new");
  });

  it("does not duplicate the empty-state 'Add a pet' action when there are no pets", async () => {
    const repo = createMemoryRepo({
      pets: [],
      medications: [],
      courses: [],
      doseEvents: [],
      stockAdjustments: [],
    });
    renderWithProviders(<PetsPage />, { repo });

    await screen.findByText("No pets yet");
    expect(screen.getAllByRole("button", { name: "Add a pet" })).toHaveLength(1);
  });

  it("shows a Household row below the roster with the member count from useMembers", async () => {
    renderWithProviders(<PetsPage />);
    await screen.findByText("Clover");

    // The default fixtures seed a two-person household (Roman + Marta).
    expect(await screen.findByText("Household · 2 people")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Household, 2 people" })).toBeInTheDocument();
  });

  it("singularises the Household row's label at one person", async () => {
    const repo = onePetNoCoursesRepo();
    renderWithProviders(<PetsPage />, { repo });
    await screen.findByText("Solo");

    expect(await screen.findByText("Household · 1 person")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Household, 1 person" })).toBeInTheDocument();
  });

  it("shows the Household row in the empty-roster branch too", async () => {
    const repo = createMemoryRepo({
      pets: [],
      medications: [],
      courses: [],
      doseEvents: [],
      stockAdjustments: [],
    });
    renderWithProviders(<PetsPage />, { repo });

    await screen.findByText("No pets yet");
    expect(await screen.findByText("Household · 1 person")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Household, 1 person" })).toBeInTheDocument();
  });

  it("navigates to /household when the Household row is activated", async () => {
    renderPets();
    await screen.findByText("Clover");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Household, 2 people" }));

    expect(pathname()).toBe("/household");
  });
});
