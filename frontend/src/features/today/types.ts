// Slice 5's internal view-model contract.
//
// Nothing in here is a scheduling rule. Occurrence generation and dose-state
// computation belong to `@/engine` (SPEC §10: "slices 5 and 7 consume it and
// must not reimplement it"); these types only describe how the Today screen
// arranges what the engine returns.
//
// Every `string` field below is ALREADY LOCALIZED. `buildTodayView` takes an
// injected `Translator` and resolves each of them through
// `i18n/catalogue/today.ts` (and, for the schedule/course clauses,
// `i18n/schedule.ts`), so the English examples in the comments are the English
// rendering of a catalogue key, not a literal any file contains. The page
// renders these fields verbatim and composes no copy of its own.
import type { Course, CourseEvent, DoseEvent, LocalDate, Medication, Pet } from "@/domain";
import type { DoseState, Occurrence } from "@/engine";

/** Everything one `qk.today(day)` fetch loads, in a single cache entry. */
export interface TodaySnapshot {
  day: LocalDate;
  pets: Pet[];
  medications: Medication[];
  courses: Course[];
  events: DoseEvent[];
  /**
   * The full CourseEvent ledger, unfiltered — same reasoning as `events`
   * above: `getOccurrences`/`nextDueAt` reconstruct the schedule in effect at
   * each slot's own due instant from this ledger (SPEC §3c), so narrowing it
   * here would silently restore the retroactive-edit bug.
   */
  courseEvents: CourseEvent[];
  /** `getOccurrences(day, { courses, events, courseEvents })` — engine output, verbatim. */
  occurrences: Occurrence[];
}

/**
 * The row pill's numbers, discriminated by what the course's schedule makes
 * countable (SPEC §4). Wording lives in `i18n/catalogue/today.ts`; this type
 * only decides WHICH question the pill answers.
 *
 * - `occurrences` — a `fixedTimes` course: "N of M doses", M being that
 *   course's own occurrences rendered today (resolved ∪ due-today), the same
 *   test the pet card's `Y` uses. Never a schedule-derived guess.
 * - `max` — a `fromLastDose` course with `maxPerDay` set (SPEC §3b-i):
 *   "N of M max". Once N reaches M the row is `capped` and `TodayDose.cap`
 *   re-renders the identical numbers in amber, so the pill never jumps.
 * - `givenOnly` — a `fromLastDose` course with no maximum: "N doses given".
 *   There is no denominator to show, because an interval course's daily total
 *   is genuinely unknowable in advance (COMMON §6 item 8) — and counting
 *   rendered occurrences instead would be worse than useless: a chain emits at
 *   most ONE occurrence per day (the current head), so that count read "0 of
 *   1" all day however many doses had been given.
 */
export type TodayCountPill =
  | { kind: "occurrences"; given: number; total: number }
  | { kind: "max"; given: number; max: number }
  | { kind: "givenOnly"; given: number };

/** One dose line as the screen renders it. */
export interface TodayDose {
  /** Stable React key and the join key back to the engine's occurrence. */
  key: string;
  occurrence: Occurrence;
  /** From `getDoseState(occurrence, now)` — never derived locally. */
  state: DoseState;
  courseId: string;
  petId: string;
  /** "Metacam 0.4 ml" — medication name, amount and unit are all DATA. */
  title: string;
  /** Short medication name alone, for the banner and the done-card status. DATA. */
  medicationName: string;
  /**
   * "08:00 · after food · day 3 of 7" in English. Clock time (never
   * localized) · the course's own instructions (DATA, verbatim) · the
   * engine's `courseProgress`/`describeSchedule` descriptor rendered through
   * `i18n/schedule.ts`. Leads with `today.notStarted` when there is no time.
   */
  detail: string;
  /** "08:00", or null for a `notStarted` occurrence, which has no due time. */
  time: string | null;
  /**
   * That COURSE's own day count — SPEC §4's row pill, in the one shape that
   * course's schedule can honestly support. `given` always means the same
   * thing in all three: this course's live `given` events today, never
   * `skipped` — the pill answers "how many times have I given this", not "how
   * many are resolved" (contrast the pet card counter and the day progress
   * headline, which both fold `skipped` into "done").
   *
   * `null`/absent when there is nothing to say (a `notStarted` row, or a
   * `fixedTimes` course with no rendered occurrence today), so the row renders
   * no pill at all rather than a contentless "0 of 0" (SPEC §4: "a pill
   * claiming an occurrence the user cannot see is worse than no pill").
   * Optional rather than required: `buildTodayView` always sets it, but other
   * fixtures that hand-build a `TodayDose` do not need to know it exists.
   */
  courseCount?: TodayCountPill | null;
  /**
   * SPEC §3b-i's `capped` state, numbers only — `given`/`max` mirror the
   * occurrence's own `givenToday`/`maxPerDay` verbatim, never recomputed
   * here (SPEC §10: the engine owns the capped condition; this file only
   * reads `state`, already decided by `getDoseState`). `null` whenever
   * `state !== "capped"`, which is also how the no-`maxPerDay` course stays
   * a true no-op: `TodayPage` renders the amber `today.pill.cap` pill and
   * the ghost **Give anyway** action only when this is non-null, and the
   * plain `courseCount` pill above otherwise — never both (SPEC §4).
   */
  cap?: { given: number; max: number } | null;
}

/** One pet's card. */
export interface TodayPetGroup {
  pet: Pet;
  /**
   * States `overdue` | `due` | `later` | `notStarted`, earliest due first,
   * `notStarted` last. `given`/`skipped` doses are reflected in `counterLabel`
   * only — SPEC §5.1: "Card body lists that pet's pending doses only."
   */
  pending: TodayDose[];
  /** Doses already resolved today (`given` or `skipped`). */
  resolved: TodayDose[];
  /**
   * What the card body actually renders: `pending`, plus any dose resolved
   * while this screen has been mounted (`keepResolved`).
   *
   * SPEC §5.1 says two things that cannot both hold of a single list: "card
   * body lists that pet's pending doses only; given doses are reflected in the
   * `X of Y today` counter", and "Give logs the dose at the current time — the
   * row animates to its given state in place". A row cannot animate in place if
   * the recompute that follows the log removes it. Read together: doses given
   * *before* this screen loaded live in the counter, and a dose you have just
   * tapped stays put in its resolved presentation until the screen remounts or
   * the day rolls over. `keepResolved` is that "just tapped" set.
   */
  body: TodayDose[];
  /**
   * `today.counter` — "1 of 2 today" in English. `Y` counts resolved +
   * pending doses that have a due time, excluding `notStarted` — COMMON §6
   * item 8: for an interval course `Y` is unknowable in advance, so it is
   * "events logged today + 1 if a live occurrence is due today", which is
   * exactly this count. Empty string when `Y` is 0.
   */
  counterLabel: string;
  /**
   * One of `today.status.overdueSince` | `today.status.nextAt` |
   * `today.notStarted` | `today.status.allDone(At)` |
   * `today.status.nothingScheduled` — "Overdue since 08:00", "Next at 09:00",
   * "All done · Ivermectin at 07:12" in English.
   */
  status: string;
  hasOverdue: boolean;
  /** Nothing pending: renders as the collapsed, greyed `PetCard done`. */
  done: boolean;
  /** Earliest pending due instant, or null when the pet has only `notStarted`. */
  nextDueAt: Date | null;
}

/** The dashed row under the list (COMMON §6 item 11). */
export interface ComingUp {
  /**
   * `today.comingUp.courseEnds` | `today.comingUp.treatment` — "Coming up ·
   * Clover's Baytril course ends" in English. The English possessive has no
   * Ukrainian equivalent, so the two catalogues word the clause differently
   * around the same two interpolated names.
   */
  label: string;
  /** `today.when.*` — "in 6 days" | "tomorrow" | "today" in English. */
  when: string;
}

/**
 * The new block directly under the header (SPEC §6.1): "how much of today is
 * done", counted across every pet. Its own scope word ("given today") keeps
 * it verbally distinct from the row's "N of M doses" and the pet card's
 * "N of M today" (SPEC §4's three-nested-day-counts table).
 */
export interface DayProgressView {
  /** Resolved (`given` or `skipped`) doses today, summed over every non-archived pet's rendered doses. */
  given: number;
  /**
   * Every scheduled dose today, summed the same way — resolved doses plus
   * pending ones that are due today (never `notStarted`/early-`upcoming`).
   * Derived entirely from `groups`, i.e. from what the pet cards themselves
   * render, never from the raw engine occurrence list — an archived pet's
   * course (which generates occurrences but no card) must not inflate this.
   */
  total: number;
  /** How many of the still-open doses are overdue — the berry segment/pips and the note's precedence. */
  overdue: number;
  /** `today.dayProgress.headline` — "3 of 5 given today", large and tabular. */
  headline: string;
  /** `today.dayProgress.overdue` | `.next` | `.allDone`, in that precedence order. */
  note: string;
  /** True when `note` is the overdue clause — the DS component colours it berry instead of quiet ink. */
  noteIsOverdue: boolean;
}

/** Everything `TodayPage` renders, assembled in one `useMemo`. */
export interface TodayView {
  /** `today.greeting.*` — cut at 12:00 and 18:00 (SPEC §6.1). */
  greeting: string;
  /**
   * `today.subtitle` while doses remain, `today.subtitle.allDone` at zero.
   * SPEC §6.1: the overdue count never repeats here — see `dayProgress.note`.
   * The remaining count goes through real plural rules per language.
   */
  subtitle: string;
  /** Ordered: pets with overdue doses, then pending by earliest due, then done. */
  groups: TodayPetGroup[];
  /** SPEC §6.1's day progress block, directly under the header. Exactly one per screen. */
  dayProgress: DayProgressView;
  overdue: {
    count: number;
    /** The single earliest overdue dose — what the banner's Log action logs. */
    earliest: TodayDose | null;
    petName: string | null;
  };
  /** True when no pet has a pending dose: render the `today.emptyTitle` state. */
  isEmpty: boolean;
  /**
   * `today.nextDose.*` — "Next dose at 20:00" / "Next dose tomorrow at 09:00"
   * / "Next dose Sat 15 Aug at 07:00" in English, the date from
   * `Intl.DateTimeFormat`. Null when nothing is scheduled.
   */
  emptyDetail: string | null;
  comingUp: ComingUp | null;
}

/** Everything §6.1a's sheet needs that the row's `TodayDose` does not carry. */
export interface LogAtTimeContext {
  pet: Pet;
  course: Course;
  events: DoseEvent[]; // unfiltered — nextDueAt anchors on events days old
  courseEvents: CourseEvent[]; // unfiltered — nextDueAt reconstructs the schedule in effect from this ledger
  scheduleSummary: string; // ALREADY LOCALIZED by the caller
}
