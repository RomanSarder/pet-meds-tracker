// Deliverable 3 (W0 foundations brief §2, completion criterion 5): proves
// `renderWithProviders` actually wires up every provider it claims to, not
// merely that mounting doesn't throw.
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { TodayPage } from "@/features/today/TodayPage";
import { useToast } from "@/app/Toast";
import { FIXTURE_NOW, now } from "@/domain";
import { getRepo } from "@/data";
import { createMemoryRepo } from "@/data/memoryRepo";
import { renderWithProviders, userEvent } from "./renderWithProviders";

function QueryProbe() {
  const client = useQueryClient();
  return <div data-testid="query-probe">{client ? "has-client" : "no-client"}</div>;
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}

function ToastProbe() {
  const { show } = useToast();
  return (
    <button type="button" onClick={() => show({ message: "hello from probe" })}>
      fire toast
    </button>
  );
}

/** Mounts a real page stub alongside the probes, inside the one provider tree. */
function Harness() {
  return (
    <>
      <TodayPage />
      <QueryProbe />
      <LocationProbe />
      <ToastProbe />
    </>
  );
}

describe("renderWithProviders", () => {
  it("mounts a real page stub inside every provider", async () => {
    const { container, repo } = renderWithProviders(<Harness />, { route: "/today" });

    // The router resolves its first match asynchronously (TanStack Router
    // loads matches via a layout effect, even with no loaders defined), so
    // anything gated behind it must be awaited with `findBy*` rather than
    // asserted synchronously with `getBy*`.
    const queryProbe = await screen.findByTestId("query-probe");

    // DS token scope: DsRoot's ".ds-root" class is a real ancestor, not just
    // present somewhere in the document.
    const dsRoot = container.querySelector(".ds-root");
    expect(dsRoot).not.toBeNull();
    expect(dsRoot).toContainElement(queryProbe);

    // QueryClient reachable from inside `ui`.
    expect(queryProbe).toHaveTextContent("has-client");

    // Router is live and initialised at the requested route.
    expect(screen.getByTestId("location-probe")).toHaveTextContent("/today");

    // Toast context reachable: firing one from inside `ui` renders it into the DOM.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "fire toast" }));
    expect(await screen.findByRole("status")).toHaveTextContent("hello from probe");

    // The returned `repo` is the one `getRepo()` now resolves to, and it is seeded.
    expect(getRepo()).toBe(repo);
    const pets = await repo.listPets();
    expect(pets.map((p) => p.name).sort()).toEqual(["Biscuit", "Clover", "Nugget"]);

    // The fixed clock is installed and defaults to FIXTURE_NOW.
    expect(now().toISOString()).toBe(FIXTURE_NOW);
  });

  it("matches any route string, including nested and param-shaped ones", async () => {
    for (const route of ["/", "/today", "/pets/abc-123"]) {
      const { unmount } = renderWithProviders(<LocationProbe />, { route });
      expect(await screen.findByTestId("location-probe")).toHaveTextContent(route);
      unmount();
    }
  });

  it("honours opts.now instead of the FIXTURE_NOW default", () => {
    renderWithProviders(<div />, { now: "2030-01-01T00:00:00.000Z" });
    expect(now().toISOString()).toBe("2030-01-01T00:00:00.000Z");
  });

  it("gives two successive calls independent repos", async () => {
    const first = renderWithProviders(<div />);
    await first.repo.createPet({ name: "Interloper", species: "cat" });
    const firstPets = await first.repo.listPets();
    expect(firstPets).toHaveLength(4);

    // A fresh call gets a fresh repo — the first call's mutation must not
    // leak across, whether via the module-level `getRepo()` seam or via
    // shared fixture state. This is what makes it safe for one test's writes
    // to never bleed into the next.
    const second = renderWithProviders(<div />);
    expect(second.repo).not.toBe(first.repo);
    const secondPets = await second.repo.listPets();
    expect(secondPets).toHaveLength(3);
    expect(secondPets.some((p) => p.name === "Interloper")).toBe(false);
  });

  it("returns opts.repo when provided, instead of manufacturing one", async () => {
    const customRepo = createMemoryRepo();
    const customPet = await customRepo.createPet({ name: "Custom", species: "guinea_pig" });

    const { repo } = renderWithProviders(<div />, { repo: customRepo });

    expect(repo).toBe(customRepo);
    expect(getRepo()).toBe(customRepo);
    const pets = await repo.listPets();
    expect(pets.some((p) => p.id === customPet.id)).toBe(true);
  });
});
