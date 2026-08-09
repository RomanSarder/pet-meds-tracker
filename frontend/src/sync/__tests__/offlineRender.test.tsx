// W9-DESIGN §D7 item 5 (task brief item 8) — the app renders with the
// network unavailable. `fetch` is stubbed to reject for the duration of this
// test, a real screen is mounted through the existing harness, and real
// content must appear: proof that no screen in the tree awaits the network
// before it can show what is already on disk (SPEC §9 local-first).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { PetsPage } from "@/features/pets/PetsPage";

describe("rendering with the network unavailable", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("network unavailable"))) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders real screen content from local storage alone", async () => {
    renderWithProviders(<PetsPage />);

    // Fixture data, read straight out of the (fake-indexeddb-backed) repo —
    // no network round trip is on the path to this text appearing.
    expect(await screen.findByText("Clover")).toBeInTheDocument();
    expect(await screen.findByText("Nugget")).toBeInTheDocument();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
