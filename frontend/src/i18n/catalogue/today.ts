// Owned by the Today wave. Every user-facing string the Today screen composes
// — the view model (`features/today/todayModel.ts`), the page, the dose row,
// the "log at a different time" dialog and the logging hook — lives here.
//
// Three things deliberately do NOT appear here, because they are not words:
//   - clock times ("08:00"), which SPEC §10a keeps 24-hour and unlocalized, so
//     they are interpolated verbatim from `formatHHMM`;
//   - dates ("Sat 15 Aug"), which come from `f.weekdayDayMonth`
//     (`Intl.DateTimeFormat`), never from a hand-written weekday/month table;
//   - pet names, medication names and dose amounts, which are DATA (SPEC §10a)
//     and are interpolated exactly as stored, never translated or declined.
import type { Formatters } from "../formatters";

export interface TodayMessages {
  // --- greeting and subtitle (SPEC §6.1) ---------------------------------
  "today.greeting.morning": () => string;
  "today.greeting.afternoon": () => string;
  "today.greeting.evening": () => string;
  /** "3 doses left today" — the first clause of the header subtitle. */
  "today.subtitle": (p: { remaining: number }) => string;
  /** "1 overdue" — appended after " · " only when M > 0. */
  "today.subtitle.overdue": (p: { overdue: number }) => string;

  // --- pet-card status line ----------------------------------------------
  /** Also the leading clause of a `notStarted` dose's detail line (SPEC §3b). */
  "today.notStarted": () => string;
  "today.status.overdueSince": (p: { time: string }) => string;
  "today.status.nextAt": (p: { time: string }) => string;
  /** A resolved dose whose event carried no time. */
  "today.status.allDone": (p: { medicationName: string }) => string;
  "today.status.allDoneAt": (p: { medicationName: string; time: string }) => string;
  "today.status.nothingScheduled": () => string;
  /** "1 of 2 today" — the per-card counter. */
  "today.counter": (p: { done: number; total: number }) => string;

  // --- empty state --------------------------------------------------------
  "today.emptyTitle": () => string;
  "today.nextDose.today": (p: { time: string }) => string;
  "today.nextDose.tomorrow": (p: { time: string }) => string;
  /** `date` is already localized by `f.weekdayDayMonth`. */
  "today.nextDose.onDate": (p: { date: string; time: string }) => string;

  // --- the dashed "coming up" row ----------------------------------------
  /**
   * "Coming up · Clover's Baytril course ends".
   *
   * English uses a possessive `'s`, which Ukrainian has no equivalent of —
   * and neither name may be declined, because both are DATA. So the two
   * catalogues word this differently rather than sharing one template: the
   * Ukrainian entry re-orders into an analytic "курс X для Y" construction
   * and inserts both proper nouns verbatim, in the nominative, exactly as
   * stored.
   */
  "today.comingUp.courseEnds": (p: { petName: string; medicationName: string }) => string;
  /** "Coming up · Nugget's Ivermectin" — same possessive problem, same fix. */
  "today.comingUp.treatment": (p: { petName: string; medicationName: string }) => string;
  "today.when.today": () => string;
  "today.when.tomorrow": () => string;
  "today.when.inDays": (p: { days: number }) => string;

  // --- page chrome --------------------------------------------------------
  "today.addCourse": () => string;
  "today.loadingDoses": () => string;
  /** The pet card's accessible name; `petName` is DATA. */
  "today.openPet": (p: { petName: string }) => string;
  "today.banner.overdueCount": (p: { count: number }) => string;
  /**
   * "Clover · Metacam, 08:00" — three interpolated data values and
   * punctuation, no words. Identical in both catalogues on purpose; it is
   * routed through the catalogue so the page holds no literal, and so a
   * language that wants a different separator can have one.
   */
  "today.banner.detail": (p: {
    petName: string;
    medicationName: string;
    time: string;
  }) => string;
  /** The banner's and the dialog's confirm action. */
  "today.log": () => string;

  // --- dose row -----------------------------------------------------------
  /**
   * The DS `DoseRow`'s button label. Its own default is the English "Give";
   * `features/today/TodayDoseRow.tsx` passes this explicitly at both call
   * sites (I18N-DESIGN.md ADDENDUM A1).
   */
  "today.give": () => string;
  "today.startCourse": () => string;
  /** Shown where the time goes on a skipped dose (SPEC §4). */
  "today.skipped": () => string;
  "today.row.givenLabel": (p: { title: string }) => string;
  "today.row.skippedLabel": (p: { title: string }) => string;
  "today.moreOptions": (p: { medicationName: string }) => string;
  "today.menu.logAtTime": () => string;
  "today.menu.skip": () => string;
  "today.menu.openCourse": () => string;

  // --- "log at a different time" dialog -----------------------------------
  "today.logAtTime.title": () => string;
  "today.logAtTime.timeGiven": () => string;
  "today.cancel": () => string;

  // --- logging and undo ---------------------------------------------------
  "today.toast.logged": (p: { medicationName: string }) => string;
  "today.toast.skipped": (p: { medicationName: string }) => string;
  "today.undo": () => string;
  "today.undo.tooLate": () => string;
}

export const enToday = (f: Formatters): TodayMessages => ({
  "today.greeting.morning": () => "Good morning",
  "today.greeting.afternoon": () => "Good afternoon",
  "today.greeting.evening": () => "Good evening",
  "today.subtitle": (p) =>
    f.plural(p.remaining, {
      one: `${p.remaining} dose left today`,
      other: `${p.remaining} doses left today`,
    }),
  "today.subtitle.overdue": (p) => `${p.overdue} overdue`,

  "today.notStarted": () => "Not started",
  "today.status.overdueSince": (p) => `Overdue since ${p.time}`,
  "today.status.nextAt": (p) => `Next at ${p.time}`,
  "today.status.allDone": (p) => `All done · ${p.medicationName}`,
  "today.status.allDoneAt": (p) => `All done · ${p.medicationName} at ${p.time}`,
  "today.status.nothingScheduled": () => "Nothing scheduled",
  "today.counter": (p) => `${p.done} of ${p.total} today`,

  "today.emptyTitle": () => "Nothing due today.",
  "today.nextDose.today": (p) => `Next dose at ${p.time}`,
  "today.nextDose.tomorrow": (p) => `Next dose tomorrow at ${p.time}`,
  "today.nextDose.onDate": (p) => `Next dose ${p.date} at ${p.time}`,

  "today.comingUp.courseEnds": (p) =>
    `Coming up · ${p.petName}'s ${p.medicationName} course ends`,
  "today.comingUp.treatment": (p) => `Coming up · ${p.petName}'s ${p.medicationName}`,
  "today.when.today": () => "today",
  "today.when.tomorrow": () => "tomorrow",
  // The model only reaches this for n ≥ 2 (0 and 1 have their own words), so
  // `other` is what renders today; the `one` form exists so this is a real
  // plural rule rather than an appended "s".
  "today.when.inDays": (p) =>
    f.plural(p.days, {
      one: `in ${p.days} day`,
      other: `in ${p.days} days`,
    }),

  "today.addCourse": () => "Add a course",
  "today.loadingDoses": () => "Loading today's doses",
  "today.openPet": (p) => `Open ${p.petName}`,
  "today.banner.overdueCount": (p) =>
    f.plural(p.count, {
      one: `${p.count} dose overdue`,
      other: `${p.count} doses overdue`,
    }),
  "today.banner.detail": (p) => `${p.petName} · ${p.medicationName}, ${p.time}`,
  "today.log": () => "Log",

  "today.give": () => "Give",
  "today.startCourse": () => "Start course",
  "today.skipped": () => "Skipped",
  "today.row.givenLabel": (p) => `${p.title}, given`,
  "today.row.skippedLabel": (p) => `${p.title}, skipped`,
  "today.moreOptions": (p) => `More options for ${p.medicationName}`,
  "today.menu.logAtTime": () => "Log at a different time",
  "today.menu.skip": () => "Skip this dose",
  "today.menu.openCourse": () => "Open course",

  "today.logAtTime.title": () => "Log at a different time",
  "today.logAtTime.timeGiven": () => "Time given",
  "today.cancel": () => "Cancel",

  "today.toast.logged": (p) => `${p.medicationName} logged`,
  "today.toast.skipped": (p) => `${p.medicationName} skipped`,
  "today.undo": () => "Undo",
  "today.undo.tooLate": () => "Too late to undo",
});

export const ukToday = (f: Formatters): TodayMessages => ({
  "today.greeting.morning": () => "Доброго ранку",
  "today.greeting.afternoon": () => "Доброго дня",
  "today.greeting.evening": () => "Доброго вечора",
  // one: 1, 21 … → 1 доза; few: 2–4 → 2 дози; many: 5–20 → 5 доз;
  // other: fractionals → 1.5 дози.
  "today.subtitle": (p) =>
    f.plural(p.remaining, {
      one: `сьогодні залишилася ${p.remaining} доза`,
      few: `сьогодні залишилося ${p.remaining} дози`,
      many: `сьогодні залишилося ${p.remaining} доз`,
      other: `сьогодні залишилося ${p.remaining} дози`,
    }),
  "today.subtitle.overdue": (p) =>
    f.plural(p.overdue, {
      one: `${p.overdue} прострочена`,
      few: `${p.overdue} прострочені`,
      many: `${p.overdue} прострочених`,
      other: `${p.overdue} простроченої`,
    }),

  "today.notStarted": () => "Не розпочато",
  "today.status.overdueSince": (p) => `Прострочено з ${p.time}`,
  "today.status.nextAt": (p) => `Наступна о ${p.time}`,
  "today.status.allDone": (p) => `Усе виконано · ${p.medicationName}`,
  "today.status.allDoneAt": (p) => `Усе виконано · ${p.medicationName} о ${p.time}`,
  "today.status.nothingScheduled": () => "Нічого не заплановано",
  "today.counter": (p) => `${p.done} з ${p.total} сьогодні`,

  "today.emptyTitle": () => "Сьогодні нічого не заплановано.",
  "today.nextDose.today": (p) => `Наступна доза о ${p.time}`,
  "today.nextDose.tomorrow": (p) => `Наступна доза завтра о ${p.time}`,
  "today.nextDose.onDate": (p) => `Наступна доза ${p.date} о ${p.time}`,

  // The English possessive ("Clover's Baytril course") has no Ukrainian
  // equivalent, and neither the pet name nor the medication name may be
  // declined — both are DATA and go in exactly as stored. So the clause is
  // rebuilt analytically: "курс <med> для <pet> завершується".
  "today.comingUp.courseEnds": (p) =>
    `Скоро · курс ${p.medicationName} для ${p.petName} завершується`,
  "today.comingUp.treatment": (p) => `Скоро · ${p.medicationName} для ${p.petName}`,
  "today.when.today": () => "сьогодні",
  "today.when.tomorrow": () => "завтра",
  // one: 1, 21 → через 21 день; few: 2–4 → через 2 дні;
  // many: 5–20 → через 5 днів; other: fractionals → через 1.5 дня.
  "today.when.inDays": (p) =>
    f.plural(p.days, {
      one: `через ${p.days} день`,
      few: `через ${p.days} дні`,
      many: `через ${p.days} днів`,
      other: `через ${p.days} дня`,
    }),

  "today.addCourse": () => "Додати курс",
  "today.loadingDoses": () => "Завантаження доз на сьогодні",
  "today.openPet": (p) => `Відкрити ${p.petName}`,
  "today.banner.overdueCount": (p) =>
    f.plural(p.count, {
      one: `${p.count} доза прострочена`,
      few: `${p.count} дози прострочені`,
      many: `${p.count} доз прострочено`,
      other: `${p.count} дози прострочено`,
    }),
  "today.banner.detail": (p) => `${p.petName} · ${p.medicationName}, ${p.time}`,
  "today.log": () => "Записати",

  "today.give": () => "Дати",
  "today.startCourse": () => "Розпочати курс",
  "today.skipped": () => "Пропущено",
  "today.row.givenLabel": (p) => `${p.title}, дано`,
  "today.row.skippedLabel": (p) => `${p.title}, пропущено`,
  "today.moreOptions": (p) => `Більше дій для ${p.medicationName}`,
  "today.menu.logAtTime": () => "Записати в інший час",
  "today.menu.skip": () => "Пропустити цю дозу",
  "today.menu.openCourse": () => "Відкрити курс",

  "today.logAtTime.title": () => "Записати в інший час",
  "today.logAtTime.timeGiven": () => "Час прийому",
  "today.cancel": () => "Скасувати",

  "today.toast.logged": (p) => `${p.medicationName} записано`,
  "today.toast.skipped": (p) => `${p.medicationName} пропущено`,
  "today.undo": () => "Скасувати",
  "today.undo.tooLate": () => "Запізно скасовувати",
});
