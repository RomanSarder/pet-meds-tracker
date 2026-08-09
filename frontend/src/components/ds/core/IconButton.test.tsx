// Tap-target coverage (SPEC §10 — see ds/README.md "Deliberate differences
// from the source"): IconButton's default size (40) is below the 44px
// minimum, so it carries the shared `.ds-hit-44` pointer-area class defined
// in ds.css, which grows the hit area via a pseudo-element without moving
// any visible pixel. The visual box (width/height) is unchanged.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("carries the ds-hit-44 pointer-area class without changing its visual size", () => {
    render(<IconButton icon="plus" label="Add" />);
    const button = screen.getByRole("button", { name: "Add" });
    expect(button.className).toContain("ds-hit-44");
    expect(button.style.width).toBe("40px");
    expect(button.style.height).toBe("40px");
  });

  it("merges a caller-supplied className instead of dropping it", () => {
    render(<IconButton icon="plus" label="Add" className="custom" />);
    const button = screen.getByRole("button", { name: "Add" });
    expect(button.className).toContain("ds-hit-44");
    expect(button.className).toContain("custom");
  });
});
