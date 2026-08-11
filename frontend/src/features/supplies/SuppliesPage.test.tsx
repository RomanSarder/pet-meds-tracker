import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
// `@/test` has no barrel (index) file yet, so this imports the concrete
// module directly rather than the bare `@/test` specifier the brief
// describes — see `features/pets/PetsPage.test.tsx` for the same footnote.
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import type { Course, Medication, Pet } from "@/domain";
import { createTranslator } from "@/i18n";
import { SuppliesPage } from "./SuppliesPage";

const ukTr = createTranslator("uk");
const enTr = createTranslator("en");

// The router underlying `renderWithProviders` resolves its first match
// asynchronously (see `renderWithProviders.test.tsx`), so the first query in
// every test below is a `findBy*`, not a `getBy*`.

function renderPage(repo = createMemoryRepo()) {
  const utils = renderWithProviders(<SuppliesPage />, { repo });
  return { ...utils, repo };
}

/**
 * Every element between the "Buy now" and "Stocked" `SectionLabel`s, in DOM
 * order — both labels and every `SupplyRow` are flat siblings of the same
 * scrolling list (the kit's own composition has no per-group wrapper), so a
 * section's "own subtree" is this sibling slice rather than a container
 * `within()` can target directly.
 */
function buyNowSiblings(): Element[] {
  const buyLabel = screen.getByText("Buy now").closest("div")!;
  const stockedLabel = screen.queryByText("Stocked")?.closest("div") ?? null;
  const siblings: Element[] = [];
  let node = buyLabel.nextElementSibling;
  while (node && node !== stockedLabel) {
    siblings.push(node);
    node = node.nextElementSibling;
  }
  return siblings;
}

function petFixture(overrides: Partial<Pet> = {}): Pet {
  return {
    id: "a0000000-0000-4000-8000-000000000099",
    name: "Pepper",
    species: "rabbit",
    birthdate: null,
    weightGrams: null,
    tint: 1,
    archived: false,
    householdId: "f0000000-0000-4000-8000-000000000099",
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function medicationFixture(overrides: Partial<Medication> = {}): Medication {
  return {
    id: "b0000000-0000-4000-8000-000000000099",
    name: "Unknown Med",
    strength: null,
    form: "tablet",
    unit: "tab",
    packSize: 30,
    stockUnits: null,
    lowThreshold: null,
    createdAt: "2026-06-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function courseFixture(overrides: Partial<Course> = {}): Course {
  return {
    id: "c0000000-0000-4000-8000-000000000099",
    petId: "a0000000-0000-4000-8000-000000000099",
    medicationId: "b0000000-0000-4000-8000-000000000099",
    doseAmount: 1,
    doseUnit: "tab",
    instructions: null,
    schedule: { kind: "fixedTimes", times: ["08:00"] },
    startDate: "2026-07-01",
    endDate: null,
    status: "active",
    notes: null,
    resumedAt: null,
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("SuppliesPage", () => {
  it("renders the header and both group labels against the seeded fixture household", async () => {
    renderPage();

    expect(await screen.findByText("Supplies")).toBeInTheDocument();
    expect(screen.getByText("Stock on hand vs. next 30 days")).toBeInTheDocument();
    expect(await screen.findByText("Buy now")).toBeInTheDocument();
    expect(screen.getByText("Stocked")).toBeInTheDocument();
  });

  it("SPEC §12: logging doses never changes stock, read from this screen's own rendered figure", async () => {
    const repo = createMemoryRepo();
    const { queryClient } = renderPage(repo);

    // Metacam's stock is the fixture's own "3.3 ml" — unique among the seeded
    // rows, so this is unambiguous evidence of what the screen displays.
    expect(await screen.findByText("3.3 ml")).toBeInTheDocument();

    const medications = await repo.listMedications();
    const metacam = medications.find((m) => m.name === "Metacam")!;
    const courses = await repo.listCourses({ medicationId: metacam.id, status: ["active"] });
    const course = courses[0]!;

    // Three doses, spaced well outside the fixedTimes grace window so none
    // is rejected as a duplicate of the last.
    for (const givenAt of [
      "2026-08-08T01:00:00.000Z",
      "2026-08-08T03:00:00.000Z",
      "2026-08-08T05:00:00.000Z",
    ]) {
      await repo.logDose({
        courseId: course.id,
        status: "given",
        scheduledFor: null,
        givenAt,
        amount: course.doseAmount,
      });
    }

    // SPEC §12: "Logging any number of doses leaves stockUnits unchanged."
    const afterLogging = await repo.getMedication(metacam.id);
    expect(afterLogging?.stockUnits).toBe(3.3);

    // Force the screen to refetch (the mutation went straight through the
    // repo, not through this screen's own hooks, so nothing invalidated the
    // query cache automatically) and assert the RENDERED figure is still the
    // same string — this is the screen a drawdown bug would surface on.
    queryClient.invalidateQueries();
    await waitFor(() => {
      expect(screen.getByText("3.3 ml")).toBeInTheDocument();
    });
    expect(screen.queryByText(/^3\.3 ml$/)).toBeInTheDocument();
  });

  it("a medication with stockUnits === null renders 'Stock not set' and is excluded from Buy now", async () => {
    const pet = petFixture();
    const urgentMed = medicationFixture({
      id: "b0000000-0000-4000-8000-000000000001",
      name: "Urgent Med",
      stockUnits: 1,
    });
    const unsetMed = medicationFixture({
      id: "b0000000-0000-4000-8000-000000000002",
      name: "Unknown Med",
      stockUnits: null,
    });
    const repo = createMemoryRepo({
      pets: [pet],
      medications: [urgentMed, unsetMed],
      courses: [
        courseFixture({
          id: "c0000000-0000-4000-8000-000000000001",
          petId: pet.id,
          medicationId: urgentMed.id,
        }),
        courseFixture({
          id: "c0000000-0000-4000-8000-000000000002",
          petId: pet.id,
          medicationId: unsetMed.id,
        }),
      ],
      doseEvents: [],
      stockAdjustments: [],
    });
    renderPage(repo);

    expect(await screen.findByText("Stock not set")).toBeInTheDocument();

    // Scoped to the Buy now section's own subtree, not the whole document.
    await screen.findByText("Buy now");
    const buySectionText = buyNowSiblings()
      .map((el) => el.textContent ?? "")
      .join(" ");
    expect(buySectionText).toContain("Urgent Med");
    expect(buySectionText).not.toContain("Unknown Med");
  });

  it("sorts By urgency by default and re-orders the rendered rows when By pet is chosen", async () => {
    renderPage();
    await screen.findByText("Buy now");

    // "By urgency" (default): ascending days of cover.
    expect(buyNowSiblings().map((el) => el.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Vitamin C")]),
    );
    const urgencyFirst = buyNowSiblings()[0]?.textContent;
    expect(urgencyFirst).toContain("Vitamin C");

    await userEvent.setup().click(screen.getByRole("button", { name: "By pet" }));

    await waitFor(() => {
      const petFirst = buyNowSiblings()[0]?.textContent;
      expect(petFirst).toContain("Metacam");
    });
    // The actual rendered order changed, not merely the control's state.
    expect(buyNowSiblings()[0]?.textContent).not.toContain("Vitamin C");
  });

  it("'Add to list' toggles the bottom bar count through a real plural rule", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Buy now");

    expect(screen.getByRole("button", { name: /Shopping list · 0 items/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add Metacam to list" }));

    // Was the pre-existing English plural bug "Shopping list · 1 items" —
    // fixed by routing the count through `tr.fmt.plural` (WAVE3-COMMON.md).
    expect(screen.getByRole("button", { name: /Shopping list · 1 item$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Shopping list · 0 items/ })).not.toBeInTheDocument();
  });

  // Deliberate Ukrainian coverage of `supplies.shoppingList.countLabel`.
  // n = 1 and 2 are proven through a real render (the default fixtures carry
  // enough "Buy now" medications to toggle two distinct items onto the
  // list); n = 5 and 21 are pinned directly through the same catalogue entry
  // `SuppliesPage.tsx` calls (`t("supplies.shoppingList.countLabel", { count:
  // listed.size })`) — building 21 distinct medications just to click "Add
  // to list" 21 times would test the click handler, not the plural rule,
  // which is already proven wired by the n = 1/2 render below.
  it("'Add to list' toggles the bottom bar count in Ukrainian at n = 1 and n = 2", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SuppliesPage />, { repo: createMemoryRepo(), locale: "uk" });
    await screen.findByText("Купити зараз");

    expect(screen.getByRole("button", { name: /Список покупок · 0 товарів/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Додати Metacam до списку" }));
    expect(screen.getByRole("button", { name: /Список покупок · 1 товар$/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Додати Metoclopramide до списку" }));
    expect(screen.getByRole("button", { name: /Список покупок · 2 товари$/ })).toBeInTheDocument();
  });

  it("supplies.shoppingList.countLabel: real Ukrainian one/few/many forms at n = 1, 2, 5, 21", () => {
    expect(ukTr.t("supplies.shoppingList.countLabel", { count: 1 })).toBe("Список покупок · 1 товар");
    expect(ukTr.t("supplies.shoppingList.countLabel", { count: 2 })).toBe("Список покупок · 2 товари");
    expect(ukTr.t("supplies.shoppingList.countLabel", { count: 5 })).toBe("Список покупок · 5 товарів");
    expect(ukTr.t("supplies.shoppingList.countLabel", { count: 21 })).toBe("Список покупок · 21 товар");
    // English at 1 and 2 alongside, so a regression in either language is caught.
    expect(enTr.t("supplies.shoppingList.countLabel", { count: 1 })).toBe("Shopping list · 1 item");
    expect(enTr.t("supplies.shoppingList.countLabel", { count: 2 })).toBe("Shopping list · 2 items");
  });

  it("opening the shopping list shows the medication name, quantity needed and pet names", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Buy now");

    await user.click(screen.getByRole("button", { name: "Add Metacam to list" }));
    await user.click(screen.getByRole("button", { name: /Shopping list · 1 item$/ }));

    expect(await screen.findByText("Shopping list")).toBeInTheDocument();
    // "Metacam · 1 more pack · Clover, Nugget" — name, quantity, pets (SPEC §6.6).
    expect(screen.getByText("Metacam · 1 more pack · Clover, Nugget")).toBeInTheDocument();
  });

  it("keeps the portalled shopping-list dialog inside a .ds-root token scope, so it is not painted with unresolved tokens", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Buy now");

    await user.click(screen.getByRole("button", { name: "Add Metacam to list" }));
    await user.click(screen.getByRole("button", { name: /Shopping list · 1 item$/ }));

    const dialog = await screen.findByRole("dialog");

    // `Dialog.Portal` moves the popup to the end of `<body>`, outside the
    // `DsRoot` the app mounts inside `#root`. Every DS token is declared on
    // `.ds-root` rather than `:root`, so a popup that lands outside one paints
    // `var(--surface)`/`var(--line-quiet)` as nothing.
    expect(dialog.closest(".ds-root")).not.toBeNull();
  });

  it("'Update stock' opens the dialog for the right medication", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Buy now");

    await user.click(screen.getByRole("button", { name: "Update Metacam stock" }));

    const input = await screen.findByRole("spinbutton", { name: "Units on hand" });
    // Metacam's own stock figure (3.3), not some other medication's — proof
    // the dialog opened against the row that was clicked.
    expect(input).toHaveValue(3.3);
  });

  it("every interactive control is reachable by role and accessible name", async () => {
    renderPage();
    await screen.findByText("Buy now");

    expect(screen.getByRole("button", { name: "By urgency" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "By pet" })).toBeInTheDocument();

    for (const name of ["Metacam", "Metoclopramide", "Vitamin C", "Ivermectin"]) {
      expect(screen.getByRole("button", { name: `Add ${name} to list` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Update ${name} stock` })).toBeInTheDocument();
    }
    // Baytril is Stocked, so it gets "Update stock" alone, no "Add to list".
    expect(screen.getByRole("button", { name: "Update Baytril stock" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Baytril to list" })).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: /Shopping list · 0 items/ })).toBeInTheDocument();
  });
});
