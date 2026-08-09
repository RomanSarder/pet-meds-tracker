// The header action button's glyph-token name (audit finding d — see
// ds/README.md "Deliberate differences from the source"): ScreenHeader never
// forwarded a label to its trailing IconButton, so it fell back to "plus".
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScreenHeader } from "./ScreenHeader";

describe("ScreenHeader", () => {
  it("falls back to the glyph token when no actionLabel is given (unchanged default)", () => {
    render(<ScreenHeader title="Settings" action="plus" />);
    expect(screen.getByRole("button", { name: "plus" })).toBeInTheDocument();
  });

  it("forwards actionLabel to the trailing IconButton as its accessible name", () => {
    render(<ScreenHeader title="Today" action="plus" actionLabel="Add a course" />);
    expect(screen.getByRole("button", { name: "Add a course" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "plus" })).not.toBeInTheDocument();
  });

  // SPEC §10 / README "Known deviations": no screen had an <h1>, because
  // ScreenHeader rendered its title as a <div>. Promoted to <h1>, semantic
  // only — same inline font-size/weight, plus an explicit margin: 0 (the DS
  // has no reset that would otherwise zero a heading's default margin).
  it("renders the title as a level-1 heading with its size, weight and an explicit margin: 0 unchanged", () => {
    render(<ScreenHeader title="Today" />);
    const heading = screen.getByRole("heading", { level: 1, name: "Today" });
    expect(heading.tagName).toBe("H1");
    expect(heading.style.fontSize).toBe("28px");
    expect(heading.style.fontWeight).toBe("800");
    expect(heading.style.margin).toBe("0px");
  });
});
