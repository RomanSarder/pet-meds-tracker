// Tap-target coverage (SPEC §10 — see ds/README.md "Deliberate differences
// from the source"): only size="sm" (36px tall) is below the 44px minimum —
// "md" is 44px and "lg" is 52px, both already compliant. Only "sm" carries
// the shared `.ds-hit-44` pointer-area class defined in ds.css, which grows
// the hit area via a pseudo-element without moving any visible pixel. No
// `SIZES` value changes.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./Button";

describe("Button", () => {
  it('carries the ds-hit-44 pointer-area class at size="sm" (36px, below the minimum)', () => {
    render(<Button size="sm">Resend</Button>);
    const button = screen.getByRole("button", { name: "Resend" });
    expect(button.className).toContain("ds-hit-44");
    expect(button.style.height).toBe("36px");
  });

  it('does not carry the class at size="md", which already meets the 44px minimum', () => {
    render(<Button size="md">Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).not.toContain("ds-hit-44");
    expect(button.style.height).toBe("44px");
  });

  it('merges a caller-supplied className with the hit-area class at size="sm"', () => {
    render(
      <Button size="sm" className="custom">
        Resend
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Resend" });
    expect(button.className).toContain("ds-hit-44");
    expect(button.className).toContain("custom");
  });

  it('still forwards a caller-supplied className at size="md"', () => {
    render(
      <Button size="md" className="custom">
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toBe("custom");
  });
});
