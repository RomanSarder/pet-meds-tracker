// Pure chip <-> Schedule mapping for the course form (SPEC §5.5, §3b). No
// rendering here — see CONTRACT.md §3's engine note: every schedule decision
// lives here so it is testable without a component tree, and so no chip
// label is ever parsed inline in CourseFormPage.tsx.
import type { IsoWeekday, LocalDate, Schedule } from "@/domain";
import { addLocalDays } from "@/domain";
import type { Translator } from "@/i18n";

/** The kit's six interval chips, in the kit's order. SPEC §3b's set is 2|4|6|8|12|24. */
export const INTERVAL_CHOICES = [
  "Every 2h",
  "Every 4h",
  "Every 6h",
  "Every 8h",
  "Every 12h",
  "Every 24h",
] as const;
/** The kit's four frequency chips, in the kit's order. */
export const FREQUENCY_CHOICES = ["Once daily", "2× daily", "3× daily", "Weekly"] as const;
/** The kit's segmented control, plus "Custom" per CONTRACT.md §4 item 2. */
export const DURATION_CHOICES = ["7 days", "14 days", "Ongoing", "Custom"] as const;
export const MODE_CHOICES = ["From last dose", "At set times"] as const;

export type IntervalChoice = (typeof INTERVAL_CHOICES)[number];
export type FrequencyChoice = (typeof FREQUENCY_CHOICES)[number];
export type DurationChoice = (typeof DURATION_CHOICES)[number];
export type ModeChoice = (typeof MODE_CHOICES)[number];

const INTERVAL_HOURS: Record<IntervalChoice, number> = {
  "Every 2h": 2,
  "Every 4h": 4,
  "Every 6h": 6,
  "Every 8h": 8,
  "Every 12h": 12,
  "Every 24h": 24,
};

/**
 * Weekly's fixed day. ISO numbering, 1 = Monday, so 6 is SATURDAY — NOT JS
 * `Date#getDay()`, where 6 is Friday and 0 is Sunday. `IsoWeekday` exists to
 * keep this honest. This is the highest-risk silent off-by-one in the wave:
 * a JS-getDay reading of "6" would silently persist Friday instead of
 * Saturday, and nothing downstream would flag it — the type is just `number`
 * inside a wider array.
 */
const WEEKLY_ISO_DAY: IsoWeekday = 6;

/** Chip label → the exact `Schedule` object persisted. */
export function scheduleForIntervalChoice(c: IntervalChoice): Schedule {
  return { kind: "fromLastDose", intervalHours: INTERVAL_HOURS[c] };
}

/** Chip label → the exact `Schedule` object persisted. */
export function scheduleForFrequencyChoice(c: FrequencyChoice): Schedule {
  switch (c) {
    case "Once daily":
      return { kind: "fixedTimes", times: ["09:00"] };
    case "2× daily":
      return { kind: "fixedTimes", times: ["08:00", "20:00"] };
    case "3× daily":
      return { kind: "fixedTimes", times: ["08:00", "14:00", "20:00"] };
    case "Weekly":
      // Saturday, ISO numbering — see WEEKLY_ISO_DAY above. Emit no
      // anchorTime and no everyNDays: the form offers neither, and adding an
      // absent optional field would change what the persisted object equals.
      return { kind: "fixedTimes", times: ["08:00"], daysOfWeek: [WEEKLY_ISO_DAY] };
  }
}

/**
 * The chip's rendered label — the persisted/compared VALUE stays the fixed
 * English token above (state equality and the `Schedule` mapping both key
 * off it); only the text shown to the user goes through the catalogue. See
 * `i18n/catalogue/pets.ts`'s `courses.interval.*` block.
 */
export function intervalChoiceLabel(c: IntervalChoice, tr: Translator): string {
  switch (c) {
    case "Every 2h":
      return tr.t("courses.interval.every2h");
    case "Every 4h":
      return tr.t("courses.interval.every4h");
    case "Every 6h":
      return tr.t("courses.interval.every6h");
    case "Every 8h":
      return tr.t("courses.interval.every8h");
    case "Every 12h":
      return tr.t("courses.interval.every12h");
    case "Every 24h":
      return tr.t("courses.interval.every24h");
  }
}

/** The hours an interval choice implies — used to compose the Reminders
 * paragraph without re-parsing the chip's own label text. */
export function intervalChoiceHours(c: IntervalChoice): number {
  return INTERVAL_HOURS[c];
}

/** Same rule as `intervalChoiceLabel`, for the frequency chip row. */
export function frequencyChoiceLabel(c: FrequencyChoice, tr: Translator): string {
  switch (c) {
    case "Once daily":
      return tr.t("courses.frequency.onceDaily");
    case "2× daily":
      return tr.t("courses.frequency.twiceDaily");
    case "3× daily":
      return tr.t("courses.frequency.thriceDaily");
    case "Weekly":
      return tr.t("courses.frequency.weekly");
  }
}

/** Same rule, for the duration `SegmentedControl`. */
export function durationChoiceLabel(c: DurationChoice, tr: Translator): string {
  switch (c) {
    case "7 days":
      return tr.t("courses.duration.sevenDays");
    case "14 days":
      return tr.t("courses.duration.fourteenDays");
    case "Ongoing":
      return tr.t("courses.duration.ongoing");
    case "Custom":
      return tr.t("courses.duration.custom");
  }
}

/** Same rule, for the mode `SegmentedControl`. */
export function modeChoiceLabel(c: ModeChoice, tr: Translator): string {
  switch (c) {
    case "From last dose":
      return tr.t("courses.mode.fromLastDose");
    case "At set times":
      return tr.t("courses.mode.atSetTimes");
  }
}

/** The fixed times a frequency choice implies, for the Reminders card. */
export function timesForFrequencyChoice(c: FrequencyChoice): string[] {
  const schedule = scheduleForFrequencyChoice(c);
  return schedule.kind === "fixedTimes" ? schedule.times : [];
}

/**
 * endDate for a duration choice, relative to `startDate`. "Ongoing" → null;
 * "Custom" → the `custom` argument (null when the user has not picked a date
 * yet). The `-1`s are deliberate: a 7-day course starting today must make
 * `courseProgress` read `Day 1 of 7`, and `courseProgress` computes
 * `differenceInLocalDays(endDate, startDate) + 1` — so a 7-day span's
 * endDate is `startDate + 6`, not `startDate + 7`.
 */
export function endDateForDurationChoice(
  c: DurationChoice,
  startDate: LocalDate,
  custom: LocalDate | null,
): LocalDate | null {
  switch (c) {
    case "7 days":
      return addLocalDays(startDate, 6);
    case "14 days":
      return addLocalDays(startDate, 13);
    case "Ongoing":
      return null;
    case "Custom":
      return custom;
  }
}

function nearestIntervalChoice(hours: number): IntervalChoice {
  let best: IntervalChoice = INTERVAL_CHOICES[0];
  let bestDiff = Math.abs(INTERVAL_HOURS[best] - hours);
  for (const choice of INTERVAL_CHOICES) {
    const diff = Math.abs(INTERVAL_HOURS[choice] - hours);
    if (diff < bestDiff) {
      best = choice;
      bestDiff = diff;
    }
  }
  return best;
}

function sameWeekdays(a: IsoWeekday[] | undefined, b: IsoWeekday[] | undefined): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  return aa.every((v, i) => v === bb[i]);
}

function sameTimes(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function nearestFrequencyChoice(s: Extract<Schedule, { kind: "fixedTimes" }>): FrequencyChoice {
  for (const choice of FREQUENCY_CHOICES) {
    const expected = scheduleForFrequencyChoice(choice);
    if (
      expected.kind === "fixedTimes" &&
      sameTimes(expected.times, s.times) &&
      sameWeekdays(expected.daysOfWeek, s.daysOfWeek)
    ) {
      return choice;
    }
  }
  return "Once daily";
}

/**
 * EXACT match against the four `fixedTimes` presets `scheduleForFrequencyChoice`
 * can produce — used by the schedule-edit form to decide whether the chips
 * still describe the data, as opposed to `choicesForSchedule`'s best-effort
 * "nearest chip for display" job below (which this function does not touch
 * or replace). A schedule the user has nudged with the times editor's
 * steppers no longer matches any preset and this returns `false`, even
 * though `choicesForSchedule` still finds a nearest chip to show.
 */
export function isPresetSchedule(s: Schedule): boolean {
  if (s.kind !== "fixedTimes") return false;
  if (s.everyNDays !== undefined) return false;
  if (s.daysOfWeek !== undefined) {
    return sameTimes(s.times, ["08:00"]) && sameWeekdays(s.daysOfWeek, [WEEKLY_ISO_DAY]);
  }
  return (
    sameTimes(s.times, ["09:00"]) ||
    sameTimes(s.times, ["08:00", "20:00"]) ||
    sameTimes(s.times, ["08:00", "14:00", "20:00"])
  );
}

/**
 * Inverse, for edit mode: the closest choice pair describing an existing
 * `Schedule`. Best-effort and never throws — match `intervalHours` to a
 * chip, falling back to the nearest listed one; match `times`/`daysOfWeek`
 * to a frequency chip, falling back to `Once daily`.
 */
export function choicesForSchedule(s: Schedule): {
  mode: ModeChoice;
  interval: IntervalChoice;
  frequency: FrequencyChoice;
} {
  if (s.kind === "fromLastDose") {
    return {
      mode: "From last dose",
      interval: nearestIntervalChoice(s.intervalHours),
      frequency: "Once daily",
    };
  }
  return {
    mode: "At set times",
    interval: "Every 8h",
    frequency: nearestFrequencyChoice(s),
  };
}
