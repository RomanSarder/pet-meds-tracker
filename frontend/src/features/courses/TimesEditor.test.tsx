import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocaleProvider } from "@/i18n";
import { TimesEditor, type TimesEditorProps } from "./TimesEditor";

function renderEditor(props: {
  times: string[];
  originalTimes: string[];
  onChange?: (next: string[]) => void;
  previewWarning?: (next: string[]) => string | null;
}) {
  const onChange = props.onChange ?? vi.fn();
  const utils = render(
    <LocaleProvider initialLocale="en">
      <TimesEditor
        times={props.times}
        originalTimes={props.originalTimes}
        onChange={onChange}
        previewWarning={props.previewWarning}
      />
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

// a11y fix: the gap-warning `Card` in `CourseFormPage` has no live region of
// its own — a screen-reader user must hear it through THIS SAME stepper
// announcement, in the same utterance as the time change, or not at all.
describe("TimesEditor — accessibility: folding a warning into the one announcement", () => {
  it("has no warning appended when previewWarning returns null", async () => {
    const user = userEvent.setup();
    renderEditor({
      times: ["08:00", "20:00"],
      originalTimes: ["08:00", "20:00"],
      previewWarning: () => null,
    });

    await user.click(screen.getByRole("button", { name: "15 minutes earlier, dose 2" }));

    expect(screen.getByText("Dose 2 set to 19:45")).toBeInTheDocument();
  });

  it("folds a warning into the SAME announcement as the time change — one utterance, not two", async () => {
    const user = userEvent.setup();
    const previewWarning = vi.fn((next: string[]) =>
      next[1] === "19:45" ? "Only 10 h since the 08:00 dose (this course is every 12 h)." : null,
    );
    renderEditor({
      times: ["08:00", "20:00"],
      originalTimes: ["08:00", "20:00"],
      previewWarning,
    });

    await user.click(screen.getByRole("button", { name: "15 minutes earlier, dose 2" }));

    // `previewWarning` was asked about the POST-press value, not the
    // pre-press one — the warning always describes where the press landed.
    expect(previewWarning).toHaveBeenCalledWith(["08:00", "19:45"]);
    // Exactly one live region, and its full, final text arrives as a single
    // update — never "Dose 2 set to 19:45" first and the warning appended a
    // moment (and therefore an utterance) later.
    expect(
      screen.getByText("Dose 2 set to 19:45. Only 10 h since the 08:00 dose (this course is every 12 h)."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Dose 2 set to 19:45")).not.toBeInTheDocument();
  });

  /** `TimesEditor` is a controlled component: a hard-coded `times` prop never
   * changes across a re-render inside a test. This wrapper feeds `onChange`
   * back into local state, the same way `CourseFormPage` does, so a second
   * press in a test actually steps from the FIRST press's result rather
   * than recomputing from the original prop. */
  function ControlledTimesEditor(props: Omit<TimesEditorProps, "times" | "onChange"> & {
    initialTimes: string[];
  }) {
    const [times, setTimes] = useState(props.initialTimes);
    return <TimesEditor {...props} times={times} onChange={setTimes} />;
  }

  it("the announcement changes when a further press crosses from one warning band into another", async () => {
    const user = userEvent.setup();
    const previewWarning = vi.fn((next: string[]) => {
      if (next[1] === "19:45") return "Only 10 h since the 08:00 dose (this course is every 12 h).";
      if (next[1] === "19:30") return "Doses less than 45m apart cannot both be logged.";
      return null;
    });
    render(
      <LocaleProvider initialLocale="en">
        <ControlledTimesEditor
          initialTimes={["08:00", "20:00"]}
          originalTimes={["08:00", "20:00"]}
          previewWarning={previewWarning}
        />
      </LocaleProvider>,
    );
    const earlier = screen.getByRole("button", { name: "15 minutes earlier, dose 2" });

    await user.click(earlier);
    expect(
      screen.getByText("Dose 2 set to 19:45. Only 10 h since the 08:00 dose (this course is every 12 h)."),
    ).toBeInTheDocument();

    await user.click(earlier);
    expect(
      screen.getByText("Dose 2 set to 19:30. Doses less than 45m apart cannot both be logged."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Dose 2 set to 19:30. Only 10 h since the 08:00 dose (this course is every 12 h)."),
    ).not.toBeInTheDocument();
  });

  // Strictly stronger than "there is one aria-live element" (asserted
  // above, in "TimesEditor — accessibility"): this proves the invariant
  // that actually matters — one `aria-live` element that ALSO only ever
  // carries one combined utterance per press, never a time confirmation and
  // a warning as two back-to-back text mutations of the same node (which
  // would still pass the element-count assertion while still queueing two
  // utterances for one tap).
  it("never leaves the live region in an intermediate, warning-less state after a press that produces one", async () => {
    const user = userEvent.setup();
    const seenTexts: string[] = [];
    const previewWarning = vi.fn((next: string[]) => {
      // Recording every read lets this test show `step` computes the final
      // string BEFORE calling `setAnnouncement`, rather than mutating the
      // region first and patching it up in a later render.
      seenTexts.push(next.join(","));
      return "Doses less than 45m apart cannot both be logged.";
    });
    const { container } = renderEditor({
      times: ["08:00", "20:00"],
      originalTimes: ["08:00", "20:00"],
      previewWarning,
    });

    await user.click(screen.getByRole("button", { name: "15 minutes earlier, dose 2" }));

    const liveRegion = container.querySelector("[aria-live]");
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.textContent).toBe(
      "Dose 2 set to 19:45. Doses less than 45m apart cannot both be logged.",
    );
    expect(seenTexts).toEqual(["08:00,19:45"]);
  });
});
