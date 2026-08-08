// Slice 5's internal view-model contract.
//
// Nothing in here is a scheduling rule. Occurrence generation and dose-state
// computation belong to `@/engine` (SPEC §10: "slices 5 and 7 consume it and
// must not reimplement it"); these types only describe how the Today screen
// arranges what the engine returns.
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
  /** "Metacam 0.4 ml" */
  title: string;
  /** Short medication name alone, for the banner and the done-card status. */
  medicationName: string;
  /** "08:00 · after food · day 3 of 7" — the trailing clause is the engine's wording. */
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
   * "1 of 2 today". `Y` counts resolved + pending doses that have a due time,
   * excluding `notStarted` — COMMON §6 item 8: for an interval course `Y` is
   * unknowable in advance, so it is "events logged today + 1 if a live
   * occurrence is due today", which is exactly this count.
   */
  counterLabel: string;
  /** "Overdue since 08:00" | "Next at 09:00" | "All done · Ivermectin at 07:12". */
  status: string;
  hasOverdue: boolean;
  /** Nothing pending: renders as the collapsed, greyed `PetCard done`. */
  done: boolean;
  /** Earliest pending due instant, or null when the pet has only `notStarted`. */
  nextDueAt: Date | null;
}

/** The dashed row under the list (COMMON §6 item 11). */
export interface ComingUp {
  /** "Coming up · Clover's Baytril course ends" */
  label: string;
  /** "in 6 days" | "tomorrow" | "today" */
  when: string;
}

/** Everything `TodayPage` renders, assembled in one `useMemo`. */
export interface TodayView {
  /** "Good morning" | "Good afternoon" | "Good evening" — cut at 12:00 and 18:00. */
  greeting: string;
  /** "3 doses left today · 1 overdue"; the second clause is dropped when M = 0. */
  subtitle: string;
  /** Ordered: pets with overdue doses, then pending by earliest due, then done. */
  groups: TodayPetGroup[];
  overdue: {
    count: number;
    /** The single earliest overdue dose — what the banner's Log action logs. */
    earliest: TodayDose | null;
    petName: string | null;
  };
  /** True when no pet has a pending dose: render the "Nothing due today." state. */
  isEmpty: boolean;
  /** "Next dose at 20:00" / "Next dose tomorrow at 09:00" / null if nothing is scheduled. */
  emptyDetail: string | null;
  comingUp: ComingUp | null;
}
