// SPEC §4's row pill and §3b-i's (not-yet-wired) cap variant — driven
// entirely by props, per the DS's own PURITY RULE: every string arrives
// already localized, and `DoseRow` decides only which pill wins, never what
// either one says.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DoseRow } from "./DoseRow";

describe("DoseRow — count pill", () => {
  it("renders no pill when countLabel is absent", () => {
    render(<DoseRow medication="Metacam" detail="08:00 · after food" state="later" />);

    expect(screen.queryByText(/of \d+/)).not.toBeInTheDocument();
  });

  it("renders the plain count pill next to the detail line", () => {
    render(
      <DoseRow
        medication="Metacam"
        detail="08:00 · after food"
        state="later"
        countLabel="1 of 2 doses"
      />,
    );

    expect(screen.getByText("1 of 2 doses")).toBeInTheDocument();
    expect(screen.getByText("08:00 · after food")).toBeInTheDocument();
  });

  it("renders a pill even with no detail text", () => {
    render(<DoseRow medication="Metacam" state="later" countLabel="0 of 1 doses" />);

    expect(screen.getByText("0 of 1 doses")).toBeInTheDocument();
  });
});

describe("DoseRow — cap variant (SPEC §3b-i, not wired to the engine)", () => {
  it("replaces the plain count pill with the amber cap pill, never showing both", () => {
    render(
      <DoseRow
        medication="Metacam"
        detail="08:00 · after food"
        state="later"
        countLabel="3 of 5 doses"
        cap={{ label: "3 of 3 max", giveAnywayLabel: "Give anyway", onGiveAnyway: vi.fn() }}
      />,
    );

    expect(screen.getByText("3 of 3 max")).toBeInTheDocument();
    expect(screen.queryByText("3 of 5 doses")).not.toBeInTheDocument();
  });

  it("reveals the ghost Give anyway action only when cap is present", () => {
    const { rerender } = render(
      <DoseRow medication="Metacam" state="later" countLabel="3 of 5 doses" />,
    );
    expect(screen.queryByRole("button", { name: "Give anyway" })).not.toBeInTheDocument();

    rerender(
      <DoseRow
        medication="Metacam"
        state="later"
        cap={{ label: "3 of 3 max", giveAnywayLabel: "Give anyway", onGiveAnyway: vi.fn() }}
      />,
    );
    expect(screen.getByRole("button", { name: "Give anyway" })).toBeInTheDocument();
  });

  it("raises onGiveAnyway exactly once and does not bubble to a card wrapper", () => {
    const onGiveAnyway = vi.fn();
    const onCardClick = vi.fn();

    render(
      <div onClick={onCardClick}>
        <DoseRow
          medication="Metacam"
          state="later"
          cap={{ label: "3 of 3 max", giveAnywayLabel: "Give anyway", onGiveAnyway }}
        />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Give anyway" }));

    expect(onGiveAnyway).toHaveBeenCalledTimes(1);
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
