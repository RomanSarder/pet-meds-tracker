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
import type { Course, DoseEvent, LocalDate, Medication, Pet } from "@/domain";
import type { DoseState, Occurrence } from "@/engine";

/** Everything one `qk.today(day)` fetch loads, in a single cache entry. */
export interface TodaySnapshot {
  day: LocalDate;
  pets: Pet[];
  medications: Medication[];
  courses: Course[];
  events: DoseEvent[];
  /** `getOccurrences(day, { courses, events })` — engine output, verbatim. */
  occurrences: Occurrence[];
}

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

/** Everything `TodayPage` renders, assembled in one `useMemo`. */
export interface TodayView {
  /** `today.greeting.*` — cut at 12:00 and 18:00 (SPEC §6.1). */
  greeting: string;
  /**
   * `today.subtitle` joined with `today.subtitle.overdue` — "3 doses left
   * today · 1 overdue" in English; the second clause is dropped when M = 0.
   * Both counts go through real plural rules per language.
   */
  subtitle: string;
  /** Ordered: pets with overdue doses, then pending by earliest due, then done. */
  groups: TodayPetGroup[];
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
  scheduleSummary: string; // ALREADY LOCALIZED by the caller
}
