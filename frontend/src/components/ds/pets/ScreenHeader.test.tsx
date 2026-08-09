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
});
