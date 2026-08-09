// Accessibility regression coverage for TabBar's two colour-only defects
// (audit findings a/b — see ds/README.md "Deliberate differences from the
// source"): the active tab must expose its state non-visually, and the icon
// glyph token must not leak into any tab's accessible name.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TabBar } from "./TabBar";

describe("TabBar", () => {
  it("marks the active tab with aria-current and leaves the others unmarked", () => {
    render(<TabBar value="pets" />);

    expect(screen.getByRole("button", { name: "Pets" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Today" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("button", { name: "Supplies" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("gives each tab its plain label as an accessible name, with no glyph token in it", () => {
    render(<TabBar value="today" />);

    for (const name of ["Today", "Pets", "Supplies"]) {
      const button = screen.getByRole("button", { name });
      expect(button.textContent).not.toMatch(/calendar-check|paw-print|package/);
    }
    // The old defect: the icon contributed its own "img" accessible node
    // (aria-label={name}) alongside the visible label, so a screen reader
    // announced "calendar-check Today". The icon is decorative now.
    expect(screen.queryByRole("img", { name: "calendar-check" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "paw-print" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "package" })).not.toBeInTheDocument();
  });
});
