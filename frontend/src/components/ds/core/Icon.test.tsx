// Icon's decorative mode (audit finding b — see ds/README.md "Deliberate
// differences from the source"): a caller beside visible text must be able
// to mark the glyph decorative so it stops emitting its own accessible name.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Icon } from "./Icon";

describe("Icon", () => {
  it("defaults to a named img, as other call sites still rely on", () => {
    render(<Icon name="plus" />);
    expect(screen.getByRole("img", { name: "plus" })).toBeInTheDocument();
  });

  it("becomes decorative — no role, no aria-label — when aria-hidden is passed", () => {
    // `getByRole` excludes aria-hidden nodes on its own, which would make this
    // pass even if the underlying attributes were wrong — so this asserts on
    // the DOM node directly instead.
    const { container } = render(<Icon name="plus" aria-hidden />);
    const span = container.querySelector("span");
    expect(span).toHaveAttribute("aria-hidden", "true");
    expect(span).not.toHaveAttribute("aria-label");
    expect(span).not.toHaveAttribute("role");
  });
});
