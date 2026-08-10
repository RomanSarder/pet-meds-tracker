import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import { SettingsPage } from "@/features/settings/SettingsPage";

// Proves the harness itself is locale-correct: no `locale` opt means
// English (matching all 963 pre-i18n tests), and `{ locale: "uk" }` opts a
// test deliberately into Ukrainian coverage.
describe("renderWithProviders locale default", () => {
  it("defaults to English", async () => {
    renderWithProviders(<SettingsPage />, { repo: createMemoryRepo() });
    expect(await screen.findByText("Settings")).toBeInTheDocument();
  });

  it("{ locale: 'uk' } renders the Ukrainian Settings title", async () => {
    renderWithProviders(<SettingsPage />, { repo: createMemoryRepo(), locale: "uk" });
    expect(await screen.findByText("Налаштування")).toBeInTheDocument();
  });
});
