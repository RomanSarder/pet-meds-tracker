// Owned by the Schedule wave. The wording for every `ScheduleSegment` and
// `CourseProgress` the engine emits (I18N-DESIGN.md §3). `i18n/schedule.ts`
// is the only consumer.
//
// Two things deliberately do NOT appear here, because they are not words:
//   - clock times ("08:00") — SPEC §10a, times never localize, so the renderer
//     interpolates them verbatim;
//   - weekday names — those come from `f.isoWeekdayShort`, i.e. from
//     `Intl.DateTimeFormat`, not from hand-written tables.
import type { Formatters } from "../formatters";

export interface ScheduleMessages {
  /** "every 8h" — the `h` abbreviation is not pluralized in either language. */
  "schedule.everyHours": (p: { hours: number }) => string;
  "schedule.fromLastDose": () => string;
  /** `time` is a literal "HH:MM" clock time and is interpolated verbatim. */
  "schedule.firstDose": (p: { time: string }) => string;
  "schedule.weekly": () => string;
  "schedule.everyNDays": (p: { days: number }) => string;
  /** 1 → "once daily"; N → "N× daily". */
  "schedule.timesPerDay": (p: { times: number }) => string;
  "schedule.courseOngoing": () => string;
  "schedule.courseDayOfTotal": (p: { day: number; total: number }) => string;
}

export const enSchedule = (f: Formatters): ScheduleMessages => ({
  "schedule.everyHours": (p) => `every ${p.hours}h`,
  "schedule.fromLastDose": () => "from last dose",
  "schedule.firstDose": (p) => `first dose ${p.time}`,
  "schedule.weekly": () => "weekly",
  // The engine only emits this segment for n > 1, so `other` is what renders
  // today; the `one` form exists so the rule is a real plural rule and not an
  // appended "s".
  "schedule.everyNDays": (p) =>
    f.plural(p.days, {
      one: `every ${p.days} day`,
      other: `every ${p.days} days`,
    }),
  // "once" vs "N×" is a lexical special case for 1, not a plural form of a
  // noun, so it is a branch rather than an `f.plural` call.
  "schedule.timesPerDay": (p) => (p.times === 1 ? "once daily" : `${p.times}× daily`),
  "schedule.courseOngoing": () => "ongoing",
  "schedule.courseDayOfTotal": (p) => `day ${p.day} of ${p.total}`,
});

export const ukSchedule = (f: Formatters): ScheduleMessages => ({
  // "год" is the standard abbreviation of "година" and is invariant, but the
  // determiner agrees with the count: кожну 1 год / кожні 8 год.
  "schedule.everyHours": (p) =>
    f.plural(p.hours, {
      one: `кожну ${p.hours} год`,
      other: `кожні ${p.hours} год`,
    }),
  "schedule.fromLastDose": () => "від останньої дози",
  "schedule.firstDose": (p) => `перша доза ${p.time}`,
  "schedule.weekly": () => "щотижня",
  // one: 1, 21, 31 … → кожен 21 день; few: 2–4 → кожні 2 дні;
  // many: 5–20 → кожні 5 днів; other: fractionals → кожні 1.5 дня.
  "schedule.everyNDays": (p) =>
    f.plural(p.days, {
      one: `кожен ${p.days} день`,
      few: `кожні ${p.days} дні`,
      many: `кожні ${p.days} днів`,
      other: `кожні ${p.days} дня`,
    }),
  "schedule.timesPerDay": (p) => (p.times === 1 ? "раз на день" : `${p.times}× на день`),
  "schedule.courseOngoing": () => "триває",
  "schedule.courseDayOfTotal": (p) => `день ${p.day} з ${p.total}`,
});
