// Tap-target coverage (SPEC §10 — see ds/README.md "Deliberate differences
// from the source"): AlertBanner's inline text action button paints no
// height or padding of its own (~18px tall, label-width wide), so it
// carries the shared `.ds-hit-44` pointer-area class defined in ds.css,
// which grows the hit area via a pseudo-element without moving any visible
// pixel. The visual styling (background, border, font) is unchanged.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AlertBanner } from "./AlertBanner";

describe("AlertBanner", () => {
  it("carries the ds-hit-44 pointer-area class on its action button", () => {
    render(<AlertBanner title="1 dose overdue" action="Log" />);
    const button = screen.getByRole("button", { name: "Log" });
    expect(button.className).toContain("ds-hit-44");
    expect(button.style.background).toBe("none");
    expect(button.style.fontSize).toBe("13px");
  });

  it("merges a caller-supplied actionClassName instead of dropping it", () => {
    render(<AlertBanner title="1 dose overdue" action="Log" actionClassName="custom" />);
    const button = screen.getByRole("button", { name: "Log" });
    expect(button.className).toContain("ds-hit-44");
    expect(button.className).toContain("custom");
  });
});
