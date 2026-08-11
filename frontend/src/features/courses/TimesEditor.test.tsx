import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocaleProvider } from "@/i18n";
import { TimesEditor } from "./TimesEditor";

function renderEditor(props: {
  times: string[];
  originalTimes: string[];
  onChange?: (next: string[]) => void;
}) {
  const onChange = props.onChange ?? vi.fn();
  const utils = render(
    <LocaleProvider initialLocale="en">
      <TimesEditor times={props.times} originalTimes={props.originalTimes} onChange={onChange} />
    </LocaleProvider>,
  );
  return { ...utils, onChange };
}

describe("TimesEditor — row rendering and order", () => {
  it("renders one row per times entry, in array order, never sorted", () => {
    renderEditor({ times: ["14:00", "08:00", "20:00"], originalTimes: ["14:00", "08:00", "20:00"] });
    const boxes = screen.getAllByText(/^\d{2}:\d{2}$/);
    expect(boxes.map((el) => el.textContent)).toEqual(["14:00", "08:00", "20:00"]);
  });

  it("labels the section with courses.times.label", () => {
    renderEditor({ times: ["08:00"], originalTimes: ["08:00"] });
    expect(screen.getByText("Times")).toBeInTheDocument();
  });
});

describe("TimesEditor — stepper clamps", () => {
  it("disables − at 00:00 and enables + on the same row", () => {
    renderEditor({ times: ["00:00"], originalTimes: ["00:00"] });
    expect(screen.getByRole("button", { name: "15 minutes earlier, dose 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "15 minutes later, dose 1" })).not.toBeDisabled();
  });

  it("disables + at 23:45 and enables − on the same row", () => {
    renderEditor({ times: ["23:45"], originalTimes: ["23:45"] });
    expect(screen.getByRole("button", { name: "15 minutes later, dose 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "15 minutes earlier, dose 1" })).not.toBeDisabled();
  });

  it("neither clamp applies mid-day", () => {
    renderEditor({ times: ["12:00"], originalTimes: ["12:00"] });
    expect(screen.getByRole("button", { name: "15 minutes earlier, dose 1" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "15 minutes later, dose 1" })).not.toBeDisabled();
  });
});

describe("TimesEditor — the 'was HH:MM' caption", () => {
  it("shows only on a row whose value differs from its original", () => {
    renderEditor({ times: ["08:00", "19:00"], originalTimes: ["08:00", "20:00"] });
    expect(screen.queryByText("was 08:00")).not.toBeInTheDocument();
    expect(screen.getByText("was 20:00")).toBeInTheDocument();
  });

  it("shows on no row when nothing has changed", () => {
    renderEditor({ times: ["08:00", "20:00"], originalTimes: ["08:00", "20:00"] });
    expect(screen.queryByText(/^was /)).not.toBeInTheDocument();
  });
});

describe("TimesEditor — accessibility", () => {
  it("carries exactly one aria-live region for the whole editor, not one per row", () => {
    const { container } = renderEditor({
      times: ["08:00", "14:00", "20:00"],
      originalTimes: ["08:00", "14:00", "20:00"],
    });
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  it("stepper buttons meet the 44px tap-target minimum (Button size='md')", () => {
    renderEditor({ times: ["08:00"], originalTimes: ["08:00"] });
    expect(screen.getByRole("button", { name: "15 minutes earlier, dose 1" }).style.height).toBe("44px");
    expect(screen.getByRole("button", { name: "15 minutes later, dose 1" }).style.height).toBe("44px");
  });

  it("aria-labels name the step size and the 1-based dose index", () => {
    renderEditor({ times: ["08:00", "20:00"], originalTimes: ["08:00", "20:00"] });
    expect(screen.getByRole("button", { name: "15 minutes earlier, dose 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "15 minutes later, dose 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "15 minutes earlier, dose 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "15 minutes later, dose 2" })).toBeInTheDocument();
  });
});

describe("TimesEditor — stepping", () => {
  it("pressing − on one row steps only that row by SCHEDULE_STEP_MIN and announces it", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderEditor({ times: ["08:00", "20:00"], originalTimes: ["08:00", "20:00"], onChange });

    await user.click(screen.getByRole("button", { name: "15 minutes earlier, dose 2" }));

    expect(onChange).toHaveBeenCalledWith(["08:00", "19:45"]);
    expect(screen.getByText("Dose 2 set to 19:45")).toBeInTheDocument();
  });

  it("real <button> elements respond to a keyboard Enter press", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderEditor({ times: ["08:00"], originalTimes: ["08:00"], onChange });

    const earlier = screen.getByRole("button", { name: "15 minutes earlier, dose 1" });
    earlier.focus();
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith(["07:45"]);
  });
});
