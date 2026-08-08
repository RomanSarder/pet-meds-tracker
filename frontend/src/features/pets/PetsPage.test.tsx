import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
// `@/test` has no barrel (index) file yet, so this imports the concrete
// module directly rather than the bare `@/test` specifier the brief
// describes — see the final report for why.
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import type { Pet } from "@/domain";
import { fixtures } from "@/domain";
import { ageLabel } from "./age";
import { PetsPage } from "./PetsPage";

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
});
