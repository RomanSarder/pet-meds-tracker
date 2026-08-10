import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
// `@/test` has no barrel (index) file yet — see Field.test.tsx — so this
// imports the concrete module directly.
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { fixtures } from "@/domain";
import { createTranslator } from "@/i18n";
import { ageLabel } from "./age";

const enTr = createTranslator("en");
import { PetFormView } from "./PetFormPage";
// Rendering PetsPage is required by test 1 (brief §6 item 1). PetsPage is
// owned by a concurrent builder — imported here, never modified.
import { PetsPage } from "./PetsPage";

const CLOVER_ID = fixtures.pets.find((p) => p.name === "Clover")!.id;

describe("PetFormView", () => {
  // The router underlying `renderWithProviders` resolves its first match
  // asynchronously (see renderWithProviders.test.tsx), so the first query in
  // every test must be a `findBy*`, not a `getBy*`.

  it("creates a pet with a tint, adds it to the roster, and its age renders from its birthdate", async () => {
    const { repo } = renderWithProviders(<PetFormView />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Name"), "Willow");
    await user.click(screen.getByRole("button", { name: "Dog" }));
    fireEvent.change(screen.getByLabelText("Birthdate"), { target: { value: "2022-03-10" } });
    await user.click(screen.getByRole("button", { name: "Save pet" }));

    const pets = await repo.listPets();
    const created = pets.find((p) => p.name === "Willow");
    expect(created).toBeDefined();
    expect(Number.isInteger(created!.tint)).toBe(true);
    expect(created!.tint).toBeGreaterThanOrEqual(1);
    expect(created!.tint).toBeLessThanOrEqual(4);
    expect(created!.birthdate).toBe("2022-03-10");

    renderWithProviders(<PetsPage />, { repo });
    // PetsPage joins species + age into one line (`joinMeta`), so assert the
    // age string is present within the same pet card rather than as an
    // isolated text node.
    const petCard = await screen.findByRole("button", { name: "Open Willow" });
    expect(petCard).toHaveTextContent(ageLabel("2022-03-10", "2026-08-08", enTr)!);
  });

  it("stores an entered weight in grams, converted from kilograms", async () => {
    const { repo } = renderWithProviders(<PetFormView />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Name"), "Pip");
    fireEvent.change(screen.getByLabelText("Weight (kg)"), { target: { value: "1.9" } });
    await user.click(screen.getByRole("button", { name: "Save pet" }));

    const pets = await repo.listPets();
    const created = pets.find((p) => p.name === "Pip");
    expect(created!.weightGrams).toBe(1900);
  });

  it("blocks save and shows an error when the name is empty", async () => {
    const { repo } = renderWithProviders(<PetFormView />);
    const before = await repo.listPets();
    const user = userEvent.setup();

    await screen.findByLabelText("Name");
    await user.click(screen.getByRole("button", { name: "Save pet" }));

    expect(await screen.findByText("Enter a name")).toBeInTheDocument();
    const after = await repo.listPets();
    expect(after.length).toBe(before.length);
  });

  it("prefills from the repo in edit mode and persists changes via updatePet", async () => {
    const { repo } = renderWithProviders(<PetFormView petId={CLOVER_ID} />);
    const original = await repo.getPet(CLOVER_ID);

    const nameInput = await screen.findByLabelText("Name");
    await waitFor(() => expect(nameInput).toHaveValue("Clover"));
    expect(screen.getByLabelText("Weight (kg)")).toHaveValue(1.9);

    const user = userEvent.setup();
    await user.clear(nameInput);
    await user.type(nameInput, "Clover the Second");
    await user.click(screen.getByRole("button", { name: "Save pet" }));

    const updated = await repo.getPet(CLOVER_ID);
    expect(updated!.name).toBe("Clover the Second");
    expect(updated!.tint).toBe(original!.tint);
  });

  it("has no tint control anywhere in the form", async () => {
    renderWithProviders(<PetFormView />);
    await screen.findByLabelText("Name");

    expect(screen.queryByLabelText(/tint/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tint/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /tint/i })).not.toBeInTheDocument();
  });

  it("makes every input reachable by its label, and gives save/close accessible names", async () => {
    renderWithProviders(<PetFormView />);

    expect(await screen.findByLabelText("Name")).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText("Birthdate")).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByLabelText("Weight (kg)")).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByRole("button", { name: "Save pet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
