import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
// `@/test` has no barrel (index) file yet, so this imports the concrete
// module directly rather than the bare `@/test` specifier the brief
// describes — see `features/pets/PetsPage.test.tsx` for the same footnote.
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import type { Medication } from "@/domain";
import { UpdateStockDialog } from "./UpdateStockDialog";

function liquidMedication(overrides: Partial<Medication> = {}): Medication {
  return {
    id: "b0000000-0000-4000-8000-000000000001",
    name: "Metacam",
    strength: "0.4 ml",
    form: "liquid",
    unit: "ml",
    packSize: 15,
    stockUnits: 3.3,
    lowThreshold: null,
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function tabletMedication(overrides: Partial<Medication> = {}): Medication {
  return liquidMedication({
    id: "b0000000-0000-4000-8000-000000000002",
    name: "Vitamin C",
    strength: "50 mg",
    form: "tablet",
    unit: "tab",
    packSize: 60,
    stockUnits: 54,
    ...overrides,
  });
}

function renderDialog(medication: Medication) {
  const repo = createMemoryRepo({
    pets: [],
    medications: [medication],
    courses: [],
    doseEvents: [],
    stockAdjustments: [],
  });
  const utils = renderWithProviders(
    <UpdateStockDialog open onOpenChange={() => {}} medication={medication} />,
    { repo },
  );
  return { ...utils, repo };
}

// The router underlying `renderWithProviders` resolves its first match
// asynchronously (see `renderWithProviders.test.tsx`), so the first query in
// every test below is a `findBy*`, not a `getBy*`.

describe("UpdateStockDialog", () => {
  it("saves a typed units figure as a NEW StockAdjustment and updates medication.stockUnits", async () => {
    const user = userEvent.setup();
    const medication = liquidMedication();
    const { repo } = renderDialog(medication);

    const before = await repo.listStockAdjustments(medication.id);
    const input = await screen.findByRole("spinbutton", { name: "Units on hand" });
    await user.clear(input);
    await user.type(input, "9");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(async () => {
      const after = await repo.listStockAdjustments(medication.id);
      // Append, not an in-place edit: exactly one new row.
      expect(after.length).toBe(before.length + 1);
    });

    const updated = await repo.getMedication(medication.id);
    expect(updated?.stockUnits).toBe(9);
  });

  it("stamps a non-empty actorId that the test never supplied", async () => {
    const user = userEvent.setup();
    const medication = liquidMedication();
    const { repo } = renderDialog(medication);

    const input = await screen.findByRole("spinbutton", { name: "Units on hand" });
    await user.clear(input);
    await user.type(input, "5");
    await user.click(screen.getByRole("button", { name: "Save" }));

    let adjustments = await repo.listStockAdjustments(medication.id);
    await waitFor(async () => {
      adjustments = await repo.listStockAdjustments(medication.id);
      expect(adjustments.length).toBeGreaterThan(0);
    });
    const last = adjustments[adjustments.length - 1];
    expect(last.actorId).toBeTruthy();
  });

  it("'Add a purchased pack' appends deltaUnits === packSize and reason 'purchase'", async () => {
    const user = userEvent.setup();
    const medication = liquidMedication();
    const { repo } = renderDialog(medication);

    const before = await repo.listStockAdjustments(medication.id);
    await screen.findByRole("spinbutton", { name: "Units on hand" });
    await user.click(screen.getByRole("button", { name: "Add a purchased pack" }));

    let after = await repo.listStockAdjustments(medication.id);
    await waitFor(async () => {
      after = await repo.listStockAdjustments(medication.id);
      expect(after.length).toBe(before.length + 1);
    });
    const added = after[after.length - 1];
    expect(added.deltaUnits).toBe(medication.packSize);
    expect(added.reason).toBe("purchase");
  });

  it("offers the four coarse figures for a liquid medication", async () => {
    renderDialog(liquidMedication());
    await screen.findByRole("spinbutton", { name: "Units on hand" });

    expect(screen.getByRole("button", { name: "full" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "about half" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "nearly out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "empty" })).toBeInTheDocument();
  });

  it("does not offer coarse figures for a tablet medication", async () => {
    renderDialog(tabletMedication());
    await screen.findByRole("spinbutton", { name: "Units on hand" });

    expect(screen.queryByRole("button", { name: "full" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "about half" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "nearly out" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "empty" })).not.toBeInTheDocument();
  });

  it("stores 'about half' as exactly packSize * 0.5, a fraction of packSize not a guess", async () => {
    const user = userEvent.setup();
    const medication = liquidMedication();
    const { repo } = renderDialog(medication);

    await screen.findByRole("spinbutton", { name: "Units on hand" });
    await user.click(screen.getByRole("button", { name: "about half" }));

    await waitFor(async () => {
      const updated = await repo.getMedication(medication.id);
      expect(updated?.stockUnits).toBe(medication.packSize! * 0.5);
    });
  });

  it("stores 'empty' as exactly 0", async () => {
    const user = userEvent.setup();
    const medication = liquidMedication();
    const { repo } = renderDialog(medication);

    await screen.findByRole("spinbutton", { name: "Units on hand" });
    await user.click(screen.getByRole("button", { name: "empty" }));

    await waitFor(async () => {
      const updated = await repo.getMedication(medication.id);
      expect(updated?.stockUnits).toBe(0);
    });
  });

  it("disables Save for an empty field", async () => {
    const user = userEvent.setup();
    renderDialog(liquidMedication());

    const input = await screen.findByRole("spinbutton", { name: "Units on hand" });
    await user.clear(input);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("disables Save for a negative figure", async () => {
    const user = userEvent.setup();
    renderDialog(liquidMedication());

    const input = await screen.findByRole("spinbutton", { name: "Units on hand" });
    await user.clear(input);
    await user.type(input, "-1");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("gives every interactive control an accessible name", async () => {
    renderDialog(liquidMedication());

    expect(await screen.findByRole("spinbutton", { name: "Units on hand" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a purchased pack" })).toBeInTheDocument();
    for (const level of ["full", "about half", "nearly out", "empty"]) {
      expect(screen.getByRole("button", { name: level })).toBeInTheDocument();
    }
  });
});
