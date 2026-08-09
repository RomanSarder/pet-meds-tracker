// The selected option's colour-only state (audit finding c — see
// ds/README.md "Deliberate differences from the source"): SegmentedControl
// already knows which option is selected, so it must expose that as
// aria-pressed on the Chip itself, with no change required from callers.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SegmentedControl } from "./SegmentedControl";

describe("SegmentedControl", () => {
  it("exposes the selected option's state via aria-pressed, and marks the rest not pressed", () => {
    render(
      <SegmentedControl
        options={["Rabbit", "Guinea pig", "Cat", "Dog", "Other"]}
        value="Cat"
      />,
    );

    expect(screen.getByRole("button", { name: "Cat" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const name of ["Rabbit", "Guinea pig", "Dog", "Other"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
  });
});
