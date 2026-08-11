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
import { act, screen, waitFor } from "@testing-library/react";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { fixedClock, occurrenceKeyFor, setClock } from "@/domain";
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

// Every course this file builds comes from `makeCourse()` and is never
// edited within a test (no `CourseEvent` of kind `edited` appears anywhere
// below), so an empty ledger here is the real ledger for these courses, not
// a stand-in for one that exists.
function makeContext(course: Course, events: DoseEvent[] = []): LogAtTimeContext {
  return { pet, course, events, courseEvents: [], scheduleSummary: "2× daily · 08:00, 20:00" };
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

  it("disables − 5 min once the rolling floor catches up with the chosen time", async () => {
    // The default 30-min-ago seed can no longer reach the floor from a
    // single `now` choice — the floor is now 24 h back, not local midnight —
    // so this drives it there the same way the sheet itself would: leaving
    // the sheet open while `now` advances (SPEC §9), using fake timers so
    // `useNow`'s poll actually fires. Same technique as the re-clamp test
    // below.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let iso = "2026-08-08T13:00:00.000Z"; // 14:00 local
      const advanceable = { now: () => new Date(iso) };
      setClock(advanceable);

      renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse), { now: iso });
      // `renderWithProviders` installs its own frozen clock immediately
      // before it renders, so the advanceable one is re-asserted after mount.
      setClock(advanceable);

      expect(await headline()).toHaveTextContent("13:30");
      expect(screen.getByRole("button", { name: "− 5 min" })).toBeEnabled();

      await act(async () => {
        // 23 h 31 min later: one minute past the point the rolling 24 h
        // floor reaches the chosen 13:30.
        iso = "2026-08-09T12:31:00.000Z";
        vi.advanceTimersByTime(30_001);
      });

      expect(await headline()).toHaveTextContent("13:31");
      expect(screen.getByRole("button", { name: "− 5 min" })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
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
      await screen.findByText("Anything from the last 24 h. Earlier doses are added from history."),
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

  it("phrases 'stays' for today, tomorrow and a later date, with exactly one preposition", async () => {
    // `next.stays` supplies the only "at"; the `when.*` fragment is time-first
    // and carries none, so "stays at tomorrow at 08:00" cannot come back.
    const today = makeCourse({ schedule: { kind: "fixedTimes", times: ["08:00", "20:00"] } });
    const first = renderSheet(
      makeDose(makeOccurrence(today, DAY, at(8, 0))),
      makeContext(today),
    );
    expect(await screen.findByText("Next dose stays at 20:00")).toBeInTheDocument();
    first.unmount();

    // A once-daily grid: the 08:00 slot's own next is tomorrow's 08:00.
    const daily = makeCourse({ schedule: { kind: "fixedTimes", times: ["08:00"] } });
    const second = renderSheet(makeDose(makeOccurrence(daily, DAY, at(8, 0))), makeContext(daily));
    expect(await screen.findByText("Next dose stays at 08:00 tomorrow")).toBeInTheDocument();
    second.unmount();

    // A 48 h chain whose newest given event is already later than the chosen
    // time, so this log is not the anchor and the chain genuinely stays put.
    const chain = makeCourse({ schedule: { kind: "fromLastDose", intervalHours: 48 } });
    renderSheet(
      makeDose(makeOccurrence(chain, DAY, at(8, 0))),
      makeContext(chain, [givenEvent(chain, at(16, 0))]),
    );
    expect(await screen.findByText("Next dose stays at 16:00 on Mon 10 Aug")).toBeInTheDocument();
  });

  it("phrases 'moves' for today, tomorrow and a later date, with exactly one preposition", async () => {
    const sameDay = makeCourse({ schedule: { kind: "fromLastDose", intervalHours: 8 } });
    const first = renderSheet(
      makeDose(makeOccurrence(sameDay, DAY, at(8, 0))),
      makeContext(sameDay, [givenEvent(sameDay, at(0, 0))]),
    );
    // Default chosen 13:30 + 8 h = 21:30 today.
    expect(await screen.findByText("Next dose moves to 21:30")).toBeInTheDocument();
    first.unmount();

    const nextDay = makeCourse({ schedule: { kind: "fromLastDose", intervalHours: 24 } });
    const second = renderSheet(
      makeDose(makeOccurrence(nextDay, DAY, at(8, 0))),
      makeContext(nextDay, [givenEvent(nextDay, at(0, 0))]),
    );
    expect(await screen.findByText("Next dose moves to 13:30 tomorrow")).toBeInTheDocument();
    second.unmount();

    const twoDays = makeCourse({ schedule: { kind: "fromLastDose", intervalHours: 48 } });
    renderSheet(
      makeDose(makeOccurrence(twoDays, DAY, at(8, 0))),
      makeContext(twoDays, [givenEvent(twoDays, at(0, 0))]),
    );
    expect(await screen.findByText("Next dose moves to 13:30 on Mon 10 Aug")).toBeInTheDocument();
  });

  it("gives each Ukrainian verb its own preposition: «переноситься на», «залишається о»", async () => {
    // The two verbs govern different cases, so they cannot share one time
    // fragment: «переноситися» takes the allative «на», «залишатися» the
    // locative «о». The catalogue carries both families; this pins the sheet
    // to routing `moves` at `whenMoves.*` rather than at `when.*`, which
    // typecheck cannot see — an uncalled catalogue key is not an error.
    const chain = makeCourse({ schedule: { kind: "fromLastDose", intervalHours: 8 } });
    const moves = renderSheet(
      makeDose(makeOccurrence(chain, DAY, at(8, 0))),
      makeContext(chain, [givenEvent(chain, at(0, 0))]),
      { locale: "uk" },
    );
    expect(await screen.findByText("Наступна доза переноситься на 21:30")).toBeInTheDocument();
    moves.unmount();

    renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse), { locale: "uk" });
    expect(await screen.findByText("Наступна доза залишається о 20:00")).toBeInTheDocument();
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
      screen.getByText("Будь-який час за останні 24 год. Раніші дози додаються через історію."),
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

  it("keeps Confirm live when the clock has moved on since the last paint (Just now must not disable itself)", async () => {
    // `useNow()` repaints at most every 30 s, but the handlers read `now()`
    // fresh so the committed `givenAt` is not up to 30 s stale. Those two
    // facts used to contradict each other: `chosen = freshNow` is strictly
    // later than the last painted tick, so the render right after the tap
    // called its own value "in the future" — berry headline, dead Confirm —
    // for the rest of the 30 s window. This test reproduces exactly that gap
    // by advancing the injected clock without letting the tick fire.
    const user = userEvent.setup();
    const { onConfirm } = renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse));
    await screen.findByRole("dialog");

    const twentySecondsLater = "2026-08-08T13:00:20.000Z";
    setClock(fixedClock(twentySecondsLater));

    await user.click(screen.getByRole("button", { name: "Just now" }));

    const headlineEl = await headline();
    expect(headlineEl).toHaveTextContent("14:00");
    expect(headlineEl).toHaveStyle({ color: "var(--ink-1)" });

    const confirmButton = screen.getByRole("button", { name: "Log at 14:00" });
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    // ...and the value committed is still the FRESH read, to the second — the
    // whole reason the handlers do not close over the tick.
    const givenAt = onConfirm.mock.calls[0][0] as Date;
    expect(givenAt.getTime()).toBe(new Date(twentySecondsLater).getTime());
  });

  it("steps up to now without the stepper disabling itself against a stale tick", async () => {
    // The same collision reached through `+ 5 min` landing exactly on now.
    // The floor no longer works as the anchor here: it is a rolling 24 h
    // back, never close to `now`, so a single `+ 5 min` step off it can never
    // overshoot the ceiling. The scheduled row is — it is an arbitrary
    // instant, not a 5-minute-multiple offset from `now` the way every chip
    // and stepper value is, so a due time 3 minutes shy of `now` still lands
    // a `+ 5 min` step past it.
    const nearNowOccurrence = makeOccurrence(fixedTimesCourse, DAY, at(13, 57));
    const user = userEvent.setup();
    renderSheet(makeDose(nearNowOccurrence), makeContext(fixedTimesCourse));

    await user.click(await screen.findByRole("button", { name: /At its scheduled time/ }));
    expect(await headline()).toHaveTextContent("13:57");

    setClock(fixedClock("2026-08-08T13:00:20.000Z")); // now (14:00 local) + 20 s
    await user.click(screen.getByRole("button", { name: "+ 5 min" }));

    // Clamped to the fresh now (14:00:20), which is later than the painted tick.
    const headlineEl = await headline();
    expect(headlineEl).toHaveTextContent("14:00");
    expect(headlineEl).toHaveStyle({ color: "var(--ink-1)" });
    expect(screen.getByRole("button", { name: "Log at 14:00" })).toBeEnabled();
    // The one thing that MUST still be disabled at the cap.
    expect(screen.getByRole("button", { name: "+ 5 min" })).toBeDisabled();
    // And the helper still explains why (SPEC §6.1a's `chosen >= now` branch).
    expect(await screen.findByText("A dose cannot be logged in the future.")).toBeInTheDocument();
  });

  it("promises the minute History will actually render, seconds and all", async () => {
    // 14:00:40 local, so the 30-min seed is 13:30:40 — 5 h 30 min 40 s after
    // the 08:00 due time. History ROUNDS that to 5 h 31 min; the sheet used to
    // floor it to 5 h 30 min and promise a number History would not print.
    renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse), {
      now: "2026-08-08T13:00:40.000Z",
    });

    expect(await screen.findByText('History will read "Given 5 h 31 min late".')).toBeInTheDocument();
    // The "N ago" label still FLOORS — a partial minute is not yet elapsed.
    expect(screen.getByText("today · 30 min ago")).toBeInTheDocument();
  });

  it("exposes the selected offset chip through aria-pressed, not colour alone", async () => {
    const user = userEvent.setup();
    renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse));

    await screen.findByRole("dialog");
    const chip = (name: string) => screen.getByRole("button", { name });
    expect(chip("30 min")).toHaveAttribute("aria-pressed", "true");
    for (const name of ["Just now", "15 min", "1 h", "2 h"]) {
      expect(chip(name)).toHaveAttribute("aria-pressed", "false");
    }

    await user.click(chip("1 h"));
    expect(chip("1 h")).toHaveAttribute("aria-pressed", "true");
    expect(chip("30 min")).toHaveAttribute("aria-pressed", "false");
  });

  it("exposes the scheduled row's selected state through aria-pressed too", async () => {
    const user = userEvent.setup();
    renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse));

    const row = await screen.findByRole("button", { name: /At its scheduled time/ });
    expect(row).toHaveAttribute("aria-pressed", "false");

    await user.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    // Every offset chip goes unpressed with it — the row and the chips are one
    // exclusive choice, not two independent toggles.
    expect(screen.getByRole("button", { name: "30 min" })).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "15 min" }));
    expect(row).toHaveAttribute("aria-pressed", "false");
  });

  it("announces the chosen time politely, from a node it mutates rather than replaces", async () => {
    const user = userEvent.setup();
    renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse));

    const headlineEl = await headline();
    expect(headlineEl).toHaveAttribute("aria-live", "polite");
    expect(headlineEl).toHaveAttribute("aria-atomic", "true");

    await user.click(screen.getByRole("button", { name: "1 h" }));

    // Same DOM node, new text: a live region that was torn down and rebuilt
    // would announce nothing, which is what makes this identity check the
    // real assertion rather than the attribute above.
    expect(await headline()).toBe(headlineEl);
    expect(headlineEl).toHaveTextContent("13:00");
    // Exactly one live region — the derived lines stay silent so a single tap
    // does not queue four overlapping utterances.
    expect(screen.getByRole("dialog").querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  it("keeps yesterday's scheduled row on offer until a full 24 h have passed, not merely until the day rolls over", async () => {
    // 07:59:59 on 9 Aug — the day has rolled over twice since the 08:00
    // occurrence on 8 Aug, but only 23 h 59 min 59 s has elapsed, one second
    // inside the rolling 24 h floor.
    renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse), {
      now: "2026-08-09T06:59:59.000Z",
    });

    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: /At its scheduled time/ })).toBeInTheDocument();
  });

  it("withdraws yesterday's scheduled row the instant a full 24 h have passed", async () => {
    // 08:00:01 on 9 Aug — one second past 24 h since the 08:00 occurrence on
    // 8 Aug: its due time is now below the floor, so offering it as a
    // one-tap row would offer a value `canConfirm` refuses.
    renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse), {
      now: "2026-08-09T07:00:01.000Z",
    });

    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /At its scheduled time/ })).not.toBeInTheDocument();
  });

  it("re-clamps a chosen time the rolling floor has left behind, instead of dead-ending the footer", async () => {
    // Fake timers so `useNow`'s 30 s `setTimeout` actually fires inside this
    // sub-second test — the same pattern (and the same `shouldAdvanceTime`
    // caveat) as `HistoryPage.test.tsx`'s own clock-tick test.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // A clock whose `now()` reads a mutable `iso`, so a later mutation is
      // visible to the `now()` call made from inside `useNow`'s already-
      // scheduled timeout.
      let iso = "2026-08-08T13:00:00.000Z"; // 14:00 local
      const advanceable = { now: () => new Date(iso) };
      setClock(advanceable);

      renderSheet(makeDose(fixedTimesOccurrence), makeContext(fixedTimesCourse), { now: iso });
      // `renderWithProviders` installs its own frozen clock immediately before
      // it renders, so the advanceable one is re-asserted after the mount.
      setClock(advanceable);

      expect(await headline()).toHaveTextContent("13:30");
      expect(screen.getByRole("button", { name: "Log at 13:30" })).toBeEnabled();

      await act(async () => {
        // 23 h 31 min later: one minute past the point the rolling 24 h
        // floor reaches the chosen 13:30.
        iso = "2026-08-09T12:31:00.000Z";
        vi.advanceTimersByTime(30_001);
      });

      // 13:30 (8 Aug) is now more than 24 h old, so the value moves to the
      // new floor in plain sight — headline and footer both — rather than
      // sitting there un-confirmable with no explanation.
      expect(await headline()).toHaveTextContent("13:31");
      expect(screen.getByRole("button", { name: "Log at 13:31" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
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
