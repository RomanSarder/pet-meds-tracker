import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import type { Course, LocalDate } from "@/domain";
import type { DoseState } from "@/engine";
import { makeOccurrence, resetEngineStore } from "./testEngine";
import { TodayDoseRow, type TodayDoseRowProps } from "./TodayDoseRow";
import type { TodayDose } from "./types";

vi.mock("@/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/engine")>();
  const { engineDouble } = await import("./testEngine");
  return { ...actual, ...engineDouble };
});

// jsdom implements neither of these, and Base UI's popups (floating-ui's
// autoUpdate, and the menu's roving focus) reach for both. Stubbing them here
// rather than in `src/test/setup.ts` keeps the shared setup file — owned by
// another slice — untouched.
const patchable = window as unknown as {
  ResizeObserver?: typeof ResizeObserver;
};
patchable.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

const DAY: LocalDate = "2026-08-08";

/** Comfortably past the component's 500 ms long-press threshold. */
const LONG_PRESS_WAIT_MS = 700;

const course: Course = {
  id: "course-1",
  petId: "pet-1",
  medicationId: "med-1",
  doseAmount: 0.4,
  doseUnit: "ml",
  instructions: "after food",
  schedule: { kind: "fixedTimes", times: ["08:00"] },
  startDate: DAY,
  endDate: null,
  status: "active",
  notes: null,
  resumedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  deletedAt: null,
};

function makeDose(state: DoseState, overrides: Partial<TodayDose> = {}): TodayDose {
  const scheduledFor = state === "notStarted" ? null : `${DAY}T07:00:00.000Z`;
  const occurrence = makeOccurrence(course, { day: DAY, scheduledFor });
  return {
    key: occurrence.key,
    occurrence,
    state,
    courseId: course.id,
    petId: course.petId,
    title: "Metacam 0.4 ml",
    medicationName: "Metacam",
    detail: "08:00 · after food · day 3 of 7",
    time: state === "notStarted" ? null : "08:00",
    ...overrides,
  };
}

function handlers(): Omit<TodayDoseRowProps, "dose"> {
  return {
    onGive: vi.fn(),
    onSkip: vi.fn(),
    onLogAtTime: vi.fn(),
    onOpenCourse: vi.fn(),
    onStartCourse: vi.fn(),
  };
}

describe("TodayDoseRow", () => {
  beforeEach(() => {
    resetEngineStore();
  });

  it("renders a Give button for a due dose and raises onGive exactly once", async () => {
    const user = userEvent.setup();
    const props = handlers();
    renderWithProviders(<TodayDoseRow dose={makeDose("due")} {...props} />);

    await user.click(await screen.findByRole("button", { name: "Give" }));

    expect(props.onGive).toHaveBeenCalledTimes(1);
    expect(props.onOpenCourse).not.toHaveBeenCalled();
  });

  it("does not let a Give tap bubble to the card wrapper", async () => {
    const user = userEvent.setup();
    const props = handlers();
    const onCardClick = vi.fn();
    renderWithProviders(
      <div onClick={onCardClick}>
        <TodayDoseRow dose={makeDose("due")} {...props} />
      </div>,
    );

    await user.click(await screen.findByRole("button", { name: "Give" }));

    expect(props.onGive).toHaveBeenCalledTimes(1);
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("shows 'Skipped' in place of the time and offers no Give", async () => {
    renderWithProviders(<TodayDoseRow dose={makeDose("skipped")} {...handlers()} />);

    expect(await screen.findByText("Skipped")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Give" })).not.toBeInTheDocument();
  });

  it("renders the logged time for a given dose", async () => {
    renderWithProviders(
      <TodayDoseRow dose={makeDose("given", { time: "07:12" })} {...handlers()} />,
    );

    expect(await screen.findByText("07:12")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Give" })).not.toBeInTheDocument();
  });

  it("offers Start course instead of Give for a notStarted dose", async () => {
    const user = userEvent.setup();
    const props = handlers();
    renderWithProviders(<TodayDoseRow dose={makeDose("notStarted")} {...props} />);

    expect(await screen.findByText(/not started/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Give" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start course" }));

    expect(props.onStartCourse).toHaveBeenCalledTimes(1);
  });

  it("names the overflow trigger and opens the three-item menu from it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TodayDoseRow dose={makeDose("due")} {...handlers()} />);

    const trigger = await screen.findByRole("button", { name: /more options/i });
    expect(trigger).toHaveAccessibleName("More options for Metacam");

    await user.click(trigger);

    // The popup mounts through a portal a tick after the trigger toggles.
    expect(
      await screen.findByRole("menuitem", { name: "Log at a different time" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Skip this dose" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Open course" })).toBeInTheDocument();
  });

  it("raises onSkip from the menu without bubbling to the card wrapper", async () => {
    const user = userEvent.setup();
    const props = handlers();
    const onCardClick = vi.fn();
    renderWithProviders(
      <div onClick={onCardClick}>
        <TodayDoseRow dose={makeDose("due")} {...props} />
      </div>,
    );

    await user.click(await screen.findByRole("button", { name: /more options/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Skip this dose" }));

    expect(props.onSkip).toHaveBeenCalledTimes(1);
    expect(props.onGive).not.toHaveBeenCalled();
    // The popup is a portal in the DOM but a React child of the wrapper, so
    // React would bubble this click to the card unless the subtree stops it.
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("raises onOpenCourse from the menu without bubbling to the card wrapper", async () => {
    const user = userEvent.setup();
    const props = handlers();
    const onCardClick = vi.fn();
    renderWithProviders(
      <div onClick={onCardClick}>
        <TodayDoseRow dose={makeDose("due")} {...props} />
      </div>,
    );

    await user.click(await screen.findByRole("button", { name: /more options/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Open course" }));

    expect(props.onOpenCourse).toHaveBeenCalledTimes(1);
    // *Open course* is the one item allowed to navigate. If the card handler
    // also fires, two navigations race and the wrapper's wins — the user lands
    // on Pet detail instead of the course.
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("does not bubble a menu-item pointer-down to the card wrapper", async () => {
    const user = userEvent.setup();
    const onCardClick = vi.fn();
    const onCardPointerDown = vi.fn();
    renderWithProviders(
      <div onClick={onCardClick} onPointerDown={onCardPointerDown}>
        <TodayDoseRow dose={makeDose("due")} {...handlers()} />
      </div>,
    );

    await user.click(await screen.findByRole("button", { name: /more options/i }));
    onCardPointerDown.mockClear();
    await user.click(await screen.findByRole("menuitem", { name: "Skip this dose" }));

    expect(onCardPointerDown).not.toHaveBeenCalled();
  });

  it("does not open the menu from the overflow trigger's own click bubbling to the card", async () => {
    const user = userEvent.setup();
    const onCardClick = vi.fn();
    renderWithProviders(
      <div onClick={onCardClick}>
        <TodayDoseRow dose={makeDose("due")} {...handlers()} />
      </div>,
    );

    await user.click(await screen.findByRole("button", { name: /more options/i }));

    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("logs at a typed local wall-clock time on the dose's own day", async () => {
    const user = userEvent.setup();
    const props = handlers();
    const onCardClick = vi.fn();
    renderWithProviders(
      <div onClick={onCardClick}>
        <TodayDoseRow dose={makeDose("overdue")} {...props} />
      </div>,
    );

    await user.click(await screen.findByRole("button", { name: /more options/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Log at a different time" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    const input = screen.getByLabelText("Time given");
    expect(input).toHaveValue("08:00");

    await user.clear(input);
    await user.type(input, "09:15");
    // Touching the field is not a tap on the card. The dialog is a portal but
    // still a React child of the wrapper, so this has to be proven.
    expect(onCardClick).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Log" }));

    expect(props.onLogAtTime).toHaveBeenCalledTimes(1);
    const givenAt = (props.onLogAtTime as ReturnType<typeof vi.fn>).mock.calls[0][0] as Date;
    expect(givenAt).toBeInstanceOf(Date);
    expect(givenAt.getFullYear()).toBe(2026);
    expect(givenAt.getMonth()).toBe(7);
    expect(givenAt.getDate()).toBe(8);
    expect(givenAt.getHours()).toBe(9);
    expect(givenAt.getMinutes()).toBe(15);
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("closes the dialog without logging when cancelled", async () => {
    const user = userEvent.setup();
    const props = handlers();
    const onCardClick = vi.fn();
    renderWithProviders(
      <div onClick={onCardClick}>
        <TodayDoseRow dose={makeDose("due")} {...props} />
      </div>,
    );

    await user.click(await screen.findByRole("button", { name: /more options/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Log at a different time" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(props.onLogAtTime).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("dismisses the dialog from the backdrop without reaching the card wrapper", async () => {
    const user = userEvent.setup();
    const props = handlers();
    const onCardClick = vi.fn();
    const { container } = renderWithProviders(
      <div onClick={onCardClick}>
        <TodayDoseRow dose={makeDose("due")} {...props} />
      </div>,
    );

    await user.click(await screen.findByRole("button", { name: /more options/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Log at a different time" }));
    await screen.findByRole("dialog");

    // Base UI renders `Dialog.Backdrop` as `role="presentation"` and marks it
    // `data-open` while the dialog is up. The pair is what separates it from
    // the library's own inert overlay, which carries the role but not the flag.
    const backdrop = container.ownerDocument.querySelector<HTMLElement>(
      '[role="presentation"][data-open]',
    );
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);

    // The guard stops React-tree propagation only. Base UI dismisses on a
    // native document-level outside-press listener, so the dialog must still
    // close — the guard must not have cost the backdrop its actual job.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(props.onLogAtTime).not.toHaveBeenCalled();
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("opens the menu on a 500 ms press of the text region", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TodayDoseRow dose={makeDose("due")} {...handlers()} />);

    const title = await screen.findByText("Metacam 0.4 ml");
    await user.pointer({ keys: "[MouseLeft>]", target: title });

    // Not yet: the press has to be held.
    expect(screen.queryByRole("menuitem", { name: "Skip this dose" })).not.toBeInTheDocument();

    expect(
      await screen.findByRole("menuitem", { name: "Skip this dose" }, { timeout: 2000 }),
    ).toBeInTheDocument();
  });

  it("does not let the long-press release reach the card wrapper as a tap", async () => {
    const user = userEvent.setup();
    const onCardClick = vi.fn();
    renderWithProviders(
      <div onClick={onCardClick}>
        <TodayDoseRow dose={makeDose("due")} {...handlers()} />
      </div>,
    );

    const title = await screen.findByText("Metacam 0.4 ml");
    await user.pointer({ keys: "[MouseLeft>]", target: title });
    expect(
      await screen.findByRole("menuitem", { name: "Skip this dose" }, { timeout: 2000 }),
    ).toBeInTheDocument();

    // Releasing the hold makes the browser synthesise a click on the row text.
    // SPEC §5.1 grants navigation to "tapping the card body (not a button)" —
    // a long-press is a different gesture, so that click must not open Pet
    // detail underneath the menu that just opened.
    await user.pointer({ keys: "[/MouseLeft]", target: title });

    expect(onCardClick).not.toHaveBeenCalled();
  });

  it("still lets an ordinary tap on the card body reach the wrapper", async () => {
    const user = userEvent.setup();
    const onCardClick = vi.fn();
    renderWithProviders(
      <div onClick={onCardClick}>
        <TodayDoseRow dose={makeDose("due")} {...handlers()} />
      </div>,
    );

    const title = await screen.findByText("Metacam 0.4 ml");
    await user.click(title);

    // The long-press suppression is per-gesture, not a blanket block: the tap
    // that SPEC §5.1 does grant navigation to has to survive it.
    expect(onCardClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: "Skip this dose" })).not.toBeInTheDocument();
  });

  it("lets a tap that follows a long-press reach the wrapper again", async () => {
    const user = userEvent.setup();
    const onCardClick = vi.fn();
    renderWithProviders(
      <div onClick={onCardClick}>
        <TodayDoseRow dose={makeDose("due")} {...handlers()} />
      </div>,
    );

    const title = await screen.findByText("Metacam 0.4 ml");
    await user.pointer({ keys: "[MouseLeft>]", target: title });
    await screen.findByRole("menuitem", { name: "Skip this dose" }, { timeout: 2000 });
    await user.pointer({ keys: "[/MouseLeft]", target: title });
    expect(onCardClick).not.toHaveBeenCalled();

    // Dismiss the menu, then tap normally: the suppression flag must have been
    // cleared by the new press rather than latched on for the row's lifetime.
    await user.keyboard("{Escape}");
    await user.click(title);

    expect(onCardClick).toHaveBeenCalledTimes(1);
  });

  it("cancels the long-press when the pointer is released early", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TodayDoseRow dose={makeDose("due")} {...handlers()} />);

    const title = await screen.findByText("Metacam 0.4 ml");
    await user.pointer([{ keys: "[MouseLeft>]", target: title }, { keys: "[/MouseLeft]" }]);
    await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_WAIT_MS));

    expect(screen.queryByRole("menuitem", { name: "Skip this dose" })).not.toBeInTheDocument();
  });
});
