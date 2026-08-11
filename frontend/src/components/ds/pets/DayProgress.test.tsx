// SPEC §6.1's day progress block. Purely presentational — every number and
// every word arrives already computed/localized; this only covers what the
// component itself decides: pip counts and colours, and the >14 bar fallback.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DayProgress } from "./DayProgress";

function pipsIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[aria-hidden="true"] > div > span'));
}

describe("DayProgress", () => {
  it("renders the headline and note verbatim", () => {
    render(
      <DayProgress
        given={2}
        total={5}
        overdue={1}
        headline="2 of 5 given today"
        note="1 overdue"
        noteAlert
      />,
    );

    expect(screen.getByText("2 of 5 given today")).toBeInTheDocument();
    expect(screen.getByText("1 overdue")).toBeInTheDocument();
  });

  it("renders one pip per scheduled dose, sage first then berry then hairline", () => {
    const { container } = render(
      <DayProgress given={2} total={5} overdue={1} headline="2 of 5 given today" note="1 overdue" />,
    );

    const pips = pipsIn(container);
    expect(pips).toHaveLength(5);
    expect(pips[0].style.background).toBe("var(--ok)");
    expect(pips[1].style.background).toBe("var(--ok)");
    expect(pips[2].style.background).toBe("var(--alert)");
    expect(pips[3].style.background).toBe("var(--line-strong)");
    expect(pips[4].style.background).toBe("var(--line-strong)");
  });

  it("degrades to a continuous bar above 14 doses", () => {
    const { container } = render(
      <DayProgress given={5} total={15} overdue={2} headline="5 of 15 given today" note="2 overdue" />,
    );

    // No individual pips once the track has degraded.
    expect(pipsIn(container)).toHaveLength(0);
    const track = container.querySelector('[aria-hidden="true"]');
    expect(track).not.toBeNull();
    // The bar itself (given + overdue segments) is still drawn.
    expect(track!.querySelectorAll("div div")).not.toHaveLength(0);
  });

  it("renders no track at all when nothing is scheduled", () => {
    const { container } = render(
      <DayProgress given={0} total={0} overdue={0} headline="0 of 0 given today" note="all done" />,
    );

    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("marks the track decorative, since the headline and note already state every fact in words", () => {
    const { container } = render(
      <DayProgress given={1} total={2} overdue={0} headline="1 of 2 given today" note="all done" />,
    );

    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
