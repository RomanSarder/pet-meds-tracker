// Tests for SPEC §6.1a's bottom sheet.
//
// NO `vi.mock("@/engine")`, deliberately, exactly like `logAtTimeModel.test.ts`:
// the consequence block previews the real scheduler, so a stubbed `nextDueAt`
// would make those assertions vacuous.
//
// The runner pins TZ=Europe/London (vitest.config.ts). `NOW_ISO` below is
// 2026-08-08T14:00 local (BST, UTC+1).
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { occurrenceKeyFor } from "@/domain";
import type { Course, DoseEvent, LocalDate, Pet, Schedule } from "@/domain";
import type { Occurrence } from "@/engine";
import { LogAtTimeSheet } from "./LogAtTimeSheet";
import type { LogAtTimeContext, TodayDose } from "./types";

// jsdom implements neither of these; Base UI's dismiss-on-outside-press and
// focus handling reach for them in some code paths. Stubbed here rather than
// in the shared `src/test/setup.ts`, which another slice owns — the same
// choice `TodayDoseRow.test.tsx` makes.
const patchable = window as unknown as { ResizeObserver?: typeof ResizeObserver };
patchable.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

const DAY: LocalDate = "2026-08-08";
/** 14:00 local (BST, UTC+1). */
const NOW_ISO = "2026-08-08T13:00:00.000Z";
/** 07:00 local — used only by the day-check helper test. */
const MORNING_NOW_ISO = "2026-08-08T06:00:00.000Z";

function at(hours: number, minutes = 0): Date {
  return new Date(2026, 7, 8, hours, minutes);
}

let courseSeq = 0;
function makeCourse(overrides: Partial<Course> & { schedule: Schedule }): Course {
  courseSeq += 1;
  return {
    id: `course-${courseSeq}`,
    petId: "pet-1",
    medicationId: "med-1",
    doseAmount: 0.4,
    doseUnit: "ml",
    instructions: "after food",
    startDate: "2026-08-01",
    endDate: null,
    status: "active",
    notes: null,
    resumedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

let eventSeq = 0;
function givenEvent(course: Course, givenAt: Date): DoseEvent {
  eventSeq += 1;
  const iso = givenAt.toISOString();
  return {
    id: `event-${eventSeq}`,
    courseId: course.id,
    scheduledFor: null,
    status: "given",
    loggedAt: iso,
    givenAt: iso,
    amount: course.doseAmount,
    note: null,
    occurrenceKey: occurrenceKeyFor(course.id, null),
    supersedesId: null,
    actorId: "actor-1",
    createdAt: iso,
    updatedAt: iso,
    deletedAt: null,
  };
}

function makeOccurrence(course: Course, day: LocalDate, dueAt: Date | null): Occurrence {
  const scheduledFor = dueAt === null ? null : dueAt.toISOString();
  return {
    key: occurrenceKeyFor(course.id, scheduledFor),
    courseId: course.id,
    petId: course.petId,
    medicationId: course.medicationId,
    kind: course.schedule.kind,
    day,
    dueAt,
    graceMinutes: course.schedule.kind === "fixedTimes" ? 60 : 90,
    doseAmount: course.doseAmount,
    doseUnit: course.doseUnit,
    instructions: course.instructions,
    event: null,
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

function makeDose(occurrence: Occurrence, overrides: Partial<TodayDose> = {}): TodayDose {
  return {
    key: occurrence.key,
    occurrence,
    state: "overdue",
    courseId: occurrence.courseId,
    petId: occurrence.petId,
    title: "Metacam 0.4 ml",
    medicationName: "Metacam",
    detail: "08:00 · after food",
    time: "08:00",
    ...overrides,
  };
}

function makeContext(course: Course, events: DoseEvent[] = []): LogAtTimeContext {
  return { pet, course, events, scheduleSummary: "2× daily · 08:00, 20:00" };
}

interface HarnessResult {
  onConfirm: ReturnType<typeof vi.fn>;
  onSkipInstead: ReturnType<typeof vi.fn>;
  reopen: () => Promise<void>;
}

/**
 * A controlled wrapper around the sheet, matching how `TodayDoseRow.tsx`
 * actually holds `sheetOpen` state (`setSheetOpen` passed straight through as
 * `onOpenChange`) — needed for the dismiss and re-seed tests, which must
 * observe a real close/reopen cycle rather than a fixed `open` prop.
 */
function renderSheet(
  dose: TodayDose,
  context: LogAtTimeContext,
  opts?: { now?: string; locale?: "en" | "uk" },
): HarnessResult & ReturnType<typeof renderWithProviders> {
  const onConfirm = vi.fn();
  const onSkipInstead = vi.fn();

  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <div>
        <button type="button" onClick={() => setOpen(true)}>
          reopen
        </button>
        <LogAtTimeSheet
          open={open}
          onOpenChange={setOpen}
          dose={dose}
          context={context}
          onConfirm={onConfirm}
          onSkipInstead={onSkipInstead}
        />
      </div>
    );
  }

  const utils = renderWithProviders(<Harness />, {
    now: opts?.now ?? NOW_ISO,
    locale: opts?.locale ?? "en",
  });

  async function reopen() {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "reopen" }));
  }

  return { ...utils, onConfirm, onSkipInstead, reopen };
}

function isChipSelected(el: HTMLElement): boolean {
  return el.style.background === "var(--ink-1)";
}

/**
 * The headline and the exact-time value box render the same formatted
 * `chosen` time, so a bare `findByText` is ambiguous between them —
 * `data-testid="log-at-time-headline"` disambiguates.
 */
async function headline(): Promise<HTMLElement> {
  return screen.findByTestId("log-at-time-headline");
}

describe("LogAtTimeSheet", () => {
  let fixedTimesCourse: Course;
  let fixedTimesOccurrence: Occurrence;

  beforeEach(() => {
    fixedTimesCourse = makeCourse({
      schedule: { kind: "fixedTimes", times: ["08:00", "20:00"] },
    });
    fixedTimesOccurrence = makeOccurrence(fixedTimesCourse, DAY, at(8, 0));
  });

  it("opens 30 minutes ago by default, with that chip selected", async () => {
    renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse));

    expect(await headline()).toHaveTextContent("13:30");
    const chip = screen.getByRole("button", { name: "30 min" });
    expect(isChipSelected(chip)).toBe(true);
    expect(isChipSelected(screen.getByRole("button", { name: "Just now" }))).toBe(false);
  });

  it("moves the headline to each chip's value, Just now landing on now", async () => {
    const user = userEvent.setup();
    renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse));

    await user.click(await screen.findByRole("button", { name: "15 min" }));
    expect(await headline()).toHaveTextContent("13:45");

    await user.click(screen.getByRole("button", { name: "1 h" }));
    expect(await headline()).toHaveTextContent("13:00");

    await user.click(screen.getByRole("button", { name: "2 h" }));
    expect(await headline()).toHaveTextContent("12:00");

    await user.click(screen.getByRole("button", { name: "Just now" }));
    expect(await headline()).toHaveTextContent("14:00");
  });

  it("renders the pet, medication and subline in the header", async () => {
    renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse));

    expect(await screen.findByText("Metacam 0.4 ml")).toBeInTheDocument();
    expect(
      screen.getByText("Clover · scheduled 08:00 · 2× daily · 08:00, 20:00"),
    ).toBeInTheDocument();
    // PetAvatar renders the pet name as its accessible label.
    expect(screen.getByLabelText("Clover")).toBeInTheDocument();
  });

  it("one-tap scheduled row sets the headline, and confirm logs exactly the occurrence's dueAt", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse));

    await user.click(await screen.findByRole("button", { name: /At its scheduled time/ }));
    expect(await headline()).toHaveTextContent("08:00");

    await user.click(screen.getByRole("button", { name: "Log at 08:00" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const givenAt = onConfirm.mock.calls[0][0] as Date;
    expect(givenAt.getTime()).toBe(at(8, 0).getTime());
  });

  it("steps the headline by 5 minutes in each direction", async () => {
    const user = userEvent.setup();
    renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse));

    expect(await headline()).toHaveTextContent("13:30");
    await user.click(screen.getByRole("button", { name: "+ 5 min" }));
    expect(await headline()).toHaveTextContent("13:35");
    await user.click(screen.getByRole("button", { name: "− 5 min" }));
    await user.click(screen.getByRole("button", { name: "− 5 min" }));
    expect(await headline()).toHaveTextContent("13:25");
  });

  it("disables + 5 min at now", async () => {
    const user = userEvent.setup();
    renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse));

    await user.click(await screen.findByRole("button", { name: "Just now" }));
    expect(await headline()).toHaveTextContent("14:00");
    expect(screen.getByRole("button", { name: "+ 5 min" })).toBeDisabled();
  });

  it("disables − 5 min once the headline is clamped to midnight", async () => {
    // now = 00:20 local: the default 30-min-ago seed clamps to the floor.
    renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse), {
      now: "2026-08-07T23:20:00.000Z",
    });

    expect(await headline()).toHaveTextContent("00:00");
    expect(screen.getByRole("button", { name: "− 5 min" })).toBeDisabled();
  });

  it("disables confirm and turns the headline berry for a future scheduled time, and confirm does nothing", async () => {
    const user = userEvent.setup();
    const futureOccurrence = makeOccurrence(fixedTimesCourse, DAY, at(20, 0));
    const { onConfirm } = renderSheet(makeDose(futureOccurrence), makeContext(fixedTimesCourse));

    await user.click(await screen.findByRole("button", { name: /At its scheduled time/ }));
    const headlineEl = await headline();
    expect(headlineEl).toHaveTextContent("20:00");
    expect(headlineEl).toHaveStyle({ color: "var(--alert)" });

    const confirmButton = screen.getByRole("button", { name: "Log at 20:00" });
    expect(confirmButton).toBeDisabled();
    await user.click(confirmButton);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("switches the helper line across its three kinds", async () => {
    const user = userEvent.setup();
    // range: default 30-min-ago seed, no day-check gap.
    const { unmount } = renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse));
    expect(
      await screen.findByText("Anything from midnight today. Earlier doses are added from history."),
    ).toBeInTheDocument();

    // futureCap: pin the headline to exactly now.
    await user.click(screen.getByRole("button", { name: "Just now" }));
    expect(
      await screen.findByText("A dose cannot be logged in the future."),
    ).toBeInTheDocument();
    unmount();

    // dayCheck: 07:00 local now, scheduled tonight at 20:00 — the default
    // 30-min-ago seed (06:30) is 13.5 h before it.
    const eveningOccurrence = makeOccurrence(fixedTimesCourse, DAY, at(20, 0));
    renderSheet(makeDose(eveningOccurrence), makeContext(fixedTimesCourse), {
      now: MORNING_NOW_ISO,
    });
    expect(
      await screen.findByText("That's more than 13 h before the scheduled time — is this today's dose?"),
    ).toBeInTheDocument();
  });

  it("renders the fromLastDose 'moves' treatment with the delta detail", async () => {
    const intervalCourse = makeCourse({ schedule: { kind: "fromLastDose", intervalHours: 8 } });
    const events = [givenEvent(intervalCourse, at(0, 0))];
    const occurrence = makeOccurrence(intervalCourse, DAY, at(8, 0));
    renderSheet(makeDose(occurrence), makeContext(intervalCourse, events));

    // Default chosen (13:30) anchors the chain: 13:30 + 8h = 21:30, 5h30 later
    // than the planned 16:00 (08:00 + 8h).
    expect(await screen.findByText("Next dose moves to 21:30")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This course counts from the last dose, so the whole chain follows the time you enter — 5 h 30 min later than planned.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the fixedTimes 'stays' treatment with the late note matching history's own rendering", async () => {
    renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse));

    // Default chosen (13:30) is 5h30 after the 08:00 due time; the next slot
    // (20:00) is unaffected.
    expect(await screen.findByText("Next dose stays at 20:00")).toBeInTheDocument();
    expect(
      screen.getByText('History will read "Given 5 h 30 min late".'),
    ).toBeInTheDocument();
  });

  it("skips instead of logging, closing the sheet first and never confirming", async () => {
    const user = userEvent.setup();
    const { onConfirm, onSkipInstead } = renderSheet(
      makeDose(fixedTimesOccurrence),
      makeContext(fixedTimesCourse),
    );

    await user.click(await screen.findByRole("button", { name: "Skip this dose instead" }));

    expect(onSkipInstead).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("re-seeds to 30 minutes ago on every open, discarding a cancelled edit", async () => {
    const user = userEvent.setup();
    const { reopen } = renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse));

    expect(await headline()).toHaveTextContent("13:30");
    await user.click(screen.getByRole("button", { name: "1 h" }));
    expect(await headline()).toHaveTextContent("13:00");

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await reopen();
    expect(await headline()).toHaveTextContent("13:30");
  });

  it("dismisses on Escape and on the backdrop, without confirming", async () => {
    const user = userEvent.setup();
    const { container, onConfirm, reopen } = renderSheet(
      makeDose(fixedTimesOccurrence),
      makeContext(fixedTimesCourse),
    );

    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(onConfirm).not.toHaveBeenCalled();

    await reopen();
    await screen.findByRole("dialog");
    // Base UI marks the live backdrop `role="presentation"` with `data-open` —
    // the same query `TodayDoseRow.test.tsx` uses to find the real overlay
    // rather than an inert one.
    const backdrop = container.ownerDocument.querySelector<HTMLElement>(
      '[role="presentation"][data-open]',
    );
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders Ukrainian copy for the headline label, chips, helper and footer", async () => {
    renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse), { locale: "uk" });

    expect(await screen.findByText("сьогодні · 30 хв тому")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Щойно" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "15 хв" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 год" })).toBeInTheDocument();
    expect(
      screen.getByText("Будь-який час від опівночі сьогодні. Раніші дози додаються через історію."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Записати о 13:30" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Натомість пропустити цю дозу" })).toBeInTheDocument();
  });

  it("keeps every interactive control at a 44px tap target", async () => {
    renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse));

    const confirm = await screen.findByRole("button", { name: "Log at 13:30" });
    expect(confirm.getBoundingClientRect).toBeDefined();
    // jsdom has no layout engine, so height/width are asserted from the
    // component's own contract instead of a measured box: every control here
    // is either a DS `Button size="md"/"lg"` (44/52px, verified by
    // `Button.tsx`'s own SIZES table) or carries the `.ds-hit-44` growth
    // class from the DS (`Chip`, `IconButton`, and the scheduled row's own
    // explicit 44px+ padding via `padding: "13px 16px"` around 15/13px text).
    for (const name of ["Just now", "15 min", "30 min", "1 h", "2 h"]) {
      expect(screen.getByRole("button", { name }).className).toContain("ds-hit-44");
    }
    expect(screen.getByRole("button", { name: "Close" }).className).toContain("ds-hit-44");
  });

  it("carries the ds-root class on both the backdrop and the popup", async () => {
    const { container } = renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse));

    await screen.findByRole("dialog");
    const backdrop = container.ownerDocument.querySelector('[role="presentation"][data-open]');
    const popup = screen.getByRole("dialog");
    expect(backdrop).not.toBeNull();
    expect(backdrop).toHaveClass("ds-root");
    expect(popup).toHaveClass("ds-root");
  });

  it("hides the scheduled row entirely when scheduledChoice returns null", async () => {
    const intervalCourse = makeCourse({ schedule: { kind: "fromLastDose", intervalHours: 8 } });
    const unanchored = makeOccurrence(intervalCourse, DAY, null);
    renderSheet(makeDose(unanchored, { time: null }), makeContext(intervalCourse));

    await screen.findByRole("dialog");
    expect(
      screen.queryByRole("button", { name: /At its scheduled time/ }),
    ).not.toBeInTheDocument();
  });
});
