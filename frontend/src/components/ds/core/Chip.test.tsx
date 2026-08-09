// Tap-target coverage (SPEC §10 — see ds/README.md "Deliberate differences
// from the source"): Chip's fixed 34px height is below the 44px minimum, so
// it carries the shared `.ds-hit-44` pointer-area class defined in ds.css,
// which grows the hit area via a pseudo-element without moving any visible
// pixel. The visual height is unchanged. `SegmentedControl` is a pure
// composition of Chip and needs no coverage of its own for this.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Chip } from "./Chip";

describe("Chip", () => {
  it("carries the ds-hit-44 pointer-area class without changing its visual height", () => {
    render(<Chip>Rabbit</Chip>);
    const button = screen.getByRole("button", { name: "Rabbit" });
    expect(button.className).toContain("ds-hit-44");
    expect(button.style.height).toBe("34px");
  });

  it("merges a caller-supplied className instead of dropping it", () => {
    render(<Chip className="custom">Rabbit</Chip>);
    const button = screen.getByRole("button", { name: "Rabbit" });
    expect(button.className).toContain("ds-hit-44");
    expect(button.className).toContain("custom");
  });
});
