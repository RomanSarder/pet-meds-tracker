import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import type { Course, LocalDate, Pet } from "@/domain";
import type { DoseState } from "@/engine";
import { makeOccurrence, resetEngineStore } from "./testEngine";
import { TodayDoseRow, type TodayDoseRowProps } from "./TodayDoseRow";
import type { LogAtTimeContext, TodayDose } from "./types";

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

const pet: Pet = {
  id: "pet-1",
  name: "Clover",
  species: "rabbit",
  birthdate: "2023-05-15",
  weightGrams: 1900,
  tint: 1,
  archived: false,
  householdId: "household-1",
  createdAt: "2026-06-01T09:00:00.000Z",
  updatedAt: "2026-06-01T09:00:00.000Z",
  deletedAt: null,
};

/** Everything §6.1a's sheet needs beyond `dose` — the row forwards this verbatim as `context`. */
function makeContext(overrides: Partial<LogAtTimeContext> = {}): LogAtTimeContext {
  return {
    pet,
    course,
    events: [],
    scheduleSummary: "08:00 · after food",
    ...overrides,
  };
}

function handlers(): Omit<TodayDoseRowProps, "dose"> {
  return {
    logAtTime: makeContext(),
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

  it("keeps the portalled overflow menu inside a .ds-root token scope, so it is not painted with unresolved tokens", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TodayDoseRow dose={makeDose("due")} {...handlers()} />);

    await user.click(await screen.findByRole("button", { name: /more options/i }));
    const menu = await screen.findByRole("menu");

    // `Menu.Portal` moves the popup to the end of `<body>`, outside the
    // `DsRoot` the app mounts inside `#root`. Every DS token is declared on
    // `.ds-root` rather than `:root`, so a popup that lands outside one paints
    // `var(--surface)`/`var(--line-quiet)` as nothing — which is what made this
    // menu read as floating text over a transparent background.
    expect(menu.closest(".ds-root")).not.toBeNull();
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

  // SPEC §6.1: "The overflow is hidden once the dose is `given`." Literally
  // `given` only — a `skipped` row keeps it, since logging a dose previously
  // marked skipped is a legitimate recovery path (a deliberate product
  // decision, not an oversight).
  const OVERFLOW_VISIBILITY: Array<{ state: DoseState; visible: boolean }> = [
    { state: "overdue", visible: true },
    { state: "due", visible: true },
    { state: "later", visible: true },
    { state: "notStarted", visible: true },
    { state: "skipped", visible: true },
    { state: "given", visible: false },
  ];

  for (const { state, visible } of OVERFLOW_VISIBILITY) {
    it(`${visible ? "shows" : "hides"} the "⋯" overflow trigger when the dose is ${state}`, async () => {
      renderWithProviders(<TodayDoseRow dose={makeDose(state)} {...handlers()} />);

      // Every state renders the row's `role="group"` wrapper synchronously;
      // waiting on it settles the render before asserting on the trigger.
      await screen.findByRole("group");
      const trigger = screen.queryByRole("button", { name: /more options/i });
      expect(trigger === null).toBe(!visible);
    });
  }

  it("confirms through the sheet at its default 30-minutes-ago offset, calling onLogAtTime exactly once with the chosen Date", async () => {
    const user = userEvent.setup();
    const props = handlers();
    renderWithProviders(<TodayDoseRow dose={makeDose("overdue")} {...props} />);

    await user.click(await screen.findByRole("button", { name: /more options/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Log at a different time" }));
    await screen.findByRole("dialog");

    // SPEC §6.1a: "the default is 30 minutes ago." The fixed clock reads
    // 08:00 local, so the footer reads "Log at 07:30".
    await user.click(await screen.findByRole("button", { name: "Log at 07:30" }));

    expect(props.onLogAtTime).toHaveBeenCalledTimes(1);
    const givenAt = (props.onLogAtTime as ReturnType<typeof vi.fn>).mock.calls[0][0] as Date;
    expect(givenAt).toBeInstanceOf(Date);
    expect(givenAt.getFullYear()).toBe(2026);
    expect(givenAt.getMonth()).toBe(7);
    expect(givenAt.getDate()).toBe(8);
    expect(givenAt.getHours()).toBe(7);
    expect(givenAt.getMinutes()).toBe(30);
  });

  it("confirms through the sheet without letting any interaction — click or pointerdown — reach the card wrapper", async () => {
    const user = userEvent.setup();
    const props = handlers();
    const onCardClick = vi.fn();
    const onCardPointerDown = vi.fn();
    renderWithProviders(
      <div onClick={onCardClick} onPointerDown={onCardPointerDown}>
        <TodayDoseRow dose={makeDose("overdue")} {...props} />
      </div>,
    );

    await user.click(await screen.findByRole("button", { name: /more options/i }));
    // `Menu.Trigger`'s own `onClick` stops the click but not the pointerdown
    // that precedes it (see "does not bubble a menu-item pointer-down..."
    // above) — cleared here so the assertions below are about the SHEET's
    // guards, not the trigger's known, pre-existing gap.
    onCardPointerDown.mockClear();
    await user.click(await screen.findByRole("menuitem", { name: "Log at a different time" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    // Picking a chip is an interaction inside the sheet. The sheet is a
    // portal in the DOM but still a React child of the wrapper, so this has
    // to be proven the same way the old dialog's field-edit was.
    await user.click(screen.getByRole("button", { name: "Just now" }));
    expect(onCardClick).not.toHaveBeenCalled();
    expect(onCardPointerDown).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Log at 08:00" }));

    expect(props.onLogAtTime).toHaveBeenCalledTimes(1);
    const givenAt = (props.onLogAtTime as ReturnType<typeof vi.fn>).mock.calls[0][0] as Date;
    expect(givenAt.getFullYear()).toBe(2026);
    expect(givenAt.getMonth()).toBe(7);
    expect(givenAt.getDate()).toBe(8);
    expect(givenAt.getHours()).toBe(8);
    expect(givenAt.getMinutes()).toBe(0);
    expect(onCardClick).not.toHaveBeenCalled();
    expect(onCardPointerDown).not.toHaveBeenCalled();
  });

  it("closes the sheet without logging when dismissed via its close control, without reaching the card wrapper", async () => {
    const user = userEvent.setup();
    const props = handlers();
    const onCardClick = vi.fn();
    const onCardPointerDown = vi.fn();
    renderWithProviders(
      <div onClick={onCardClick} onPointerDown={onCardPointerDown}>
        <TodayDoseRow dose={makeDose("due")} {...props} />
      </div>,
    );

    await user.click(await screen.findByRole("button", { name: /more options/i }));
    // See the identical note in the previous test: the trigger's own
    // pointerdown leak is orthogonal to what this test is proving.
    onCardPointerDown.mockClear();
    await user.click(await screen.findByRole("menuitem", { name: "Log at a different time" }));
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(props.onLogAtTime).not.toHaveBeenCalled();
    expect(onCardClick).not.toHaveBeenCalled();
    expect(onCardPointerDown).not.toHaveBeenCalled();
  });

  it("dismisses the sheet from the backdrop without reaching the card wrapper", async () => {
    const user = userEvent.setup();
    const props = handlers();
    const onCardClick = vi.fn();
    const onCardPointerDown = vi.fn();
    const { container } = renderWithProviders(
      <div onClick={onCardClick} onPointerDown={onCardPointerDown}>
        <TodayDoseRow dose={makeDose("due")} {...props} />
      </div>,
    );

    await user.click(await screen.findByRole("button", { name: /more options/i }));
    // See the identical note two tests up: the trigger's own pointerdown
    // leak is orthogonal to what this test is proving.
    onCardPointerDown.mockClear();
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
    expect(onCardPointerDown).not.toHaveBeenCalled();
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

  // Deliberate Ukrainian coverage. The DS `DoseRow`'s button label defaults to
  // the English "Give"; ADDENDUM A1 made that default overridable precisely so
  // this row could pass a translated one, and this is the test that the wire
  // is actually connected rather than the default silently winning.
  it("labels the one-tap control in Ukrainian, and the row with it", async () => {
    const user = userEvent.setup();
    const props = handlers();
    renderWithProviders(<TodayDoseRow dose={makeDose("due")} {...props} />, {
      locale: "uk",
    });

    const give = await screen.findByRole("button", { name: "Дати" });
    expect(screen.queryByRole("button", { name: "Give" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Metacam/ })).toHaveAccessibleName(
      "Більше дій для Metacam",
    );

    await user.click(give);
    expect(props.onGive).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Більше дій для Metacam" }));
    expect(
      await screen.findByRole("menuitem", { name: "Записати в інший час" }),
    ).toBeInTheDocument();
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
