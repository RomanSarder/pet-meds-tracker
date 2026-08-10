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

  // --- "log at a different time" sheet (SPEC §6.1a) -----------------------
  "today.logAtTime.title": () => string;
  /** Close control's accessible label. */
  "today.logAtTime.close": () => string;
  /** Header subline: "Clover · scheduled 08:00 · 2× daily · 08:00, 20:00". */
  "today.logAtTime.subline": (p: { petName: string; time: string; schedule: string }) => string;
  /**
   * "N ago" — wraps an already-rendered `history.detail.lateDuration` value.
   * Reused rather than restated: see `today.logAtTime.next.staysDetail`.
   */
  "today.logAtTime.ago": (p: { duration: string }) => string;
  /** "today · <ago>" beside the headline; `ago` is the rendered `today.logAtTime.ago`. */
  "today.logAtTime.todayAgo": (p: { ago: string }) => string;
  /** First relative-offset chip. */
  "today.logAtTime.justNow": () => string;
  /** Relative-offset chip: "15 min" / "30 min" — invariant abbreviation, never plural. */
  "today.logAtTime.offsetMinutes": (p: { minutes: number }) => string;
  /** Relative-offset chip: "1 h" / "2 h" — invariant abbreviation, never plural. */
  "today.logAtTime.offsetHours": (p: { hours: number }) => string;
  "today.logAtTime.atScheduled": () => string;
  "today.logAtTime.atScheduledHelper": () => string;
  "today.logAtTime.exactLabel": () => string;
  /** Stepper's "− 5 min" control. */
  "today.logAtTime.earlier": (p: { minutes: number }) => string;
  /** Stepper's "+ 5 min" control. */
  "today.logAtTime.later": (p: { minutes: number }) => string;
  /** Helper line when the stepper is capped at now. */
  "today.logAtTime.helper.future": () => string;
  /** Helper line more than 12 h before the scheduled time — is this today's dose? */
  "today.logAtTime.helper.dayCheck": (p: { hours: number }) => string;
  /** Default helper line: the entry range is midnight-today onward. */
  "today.logAtTime.helper.range": () => string;
  /** Just the chosen time — composed into `next.moves` / `next.stays`. */
  "today.logAtTime.when.today": (p: { time: string }) => string;
  "today.logAtTime.when.tomorrow": (p: { time: string }) => string;
  /** `date` is already localized by `f.weekdayDayMonth`. */
  "today.logAtTime.when.onDate": (p: { date: string; time: string }) => string;
  /** `fromLastDose` consequence headline; `when` is a rendered `when.*` value. */
  "today.logAtTime.next.moves": (p: { when: string }) => string;
  /** `fromLastDose` chain explanation, entered time later than planned. */
  "today.logAtTime.next.movesDetailLater": (p: { delta: string }) => string;
  /** `fromLastDose` chain explanation, entered time earlier than planned. */
  "today.logAtTime.next.movesDetailEarlier": (p: { delta: string }) => string;
  /** `fixedTimes` consequence headline; `when` is a rendered `when.*` value. */
  "today.logAtTime.next.stays": (p: { when: string }) => string;
  /**
   * `fixedTimes` consequence detail. `late` is `history.detail.givenLate`
   * rendered verbatim — this promises what History will say, so it must
   * reuse that exact string rather than restate it (a mismatch would be a
   * copy bug shipped by construction).
   */
  "today.logAtTime.next.staysDetail": (p: { late: string }) => string;
  /** No further doses in the course to reschedule. */
  "today.logAtTime.next.none": () => string;
  /** Footer confirm: "Log at 08:00". */
  "today.logAtTime.confirm": (p: { time: string }) => string;
  /** Footer's ghost hand-off to the skip flow. */
  "today.logAtTime.skipInstead": () => string;

  // --- logging and undo ---------------------------------------------------
  "today.toast.logged": (p: { medicationName: string }) => string;
  "today.toast.skipped": (p: { medicationName: string }) => string;
  "today.undo": () => string;
  "today.undo.tooLate": () => string;
  /**
   * SPEC §5's dedup rule: a second Give/Skip within the grace window is
   * rejected client-side rather than silently dropped. `name` is already
   * resolved through `displayNameFor` (never an email — SPEC §12) and `time`
   * through `formatHHMM` — both interpolated verbatim, never declined.
   * "Already given by Marta at 07:12" is the exact SPEC §5 copy.
   */
  "today.toast.duplicateGiven": (p: { name: string; time: string }) => string;
  /** Same rule, worded accurately when the conflicting event was a skip, not a give. */
  "today.toast.duplicateSkipped": (p: { name: string; time: string }) => string;
  /** Any other `logDose` failure that isn't the duplicate guard — a plain factual toast rather than silence. */
  "today.toast.logFailed": () => string;
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
  "today.logAtTime.close": () => "Close",
  "today.logAtTime.subline": (p) => `${p.petName} · scheduled ${p.time} · ${p.schedule}`,
  "today.logAtTime.ago": (p) => `${p.duration} ago`,
  "today.logAtTime.todayAgo": (p) => `today · ${p.ago}`,
  "today.logAtTime.justNow": () => "Just now",
  "today.logAtTime.offsetMinutes": (p) => `${p.minutes} min`,
  "today.logAtTime.offsetHours": (p) => `${p.hours} h`,
  "today.logAtTime.atScheduled": () => "At its scheduled time",
  "today.logAtTime.atScheduledHelper": () => "Given on time, logged afterwards",
  "today.logAtTime.exactLabel": () => "Or set it exactly",
  "today.logAtTime.earlier": (p) => `− ${p.minutes} min`,
  "today.logAtTime.later": (p) => `+ ${p.minutes} min`,
  "today.logAtTime.helper.future": () => "A dose cannot be logged in the future.",
  "today.logAtTime.helper.dayCheck": (p) =>
    `That's more than ${p.hours} h before the scheduled time — is this today's dose?`,
  "today.logAtTime.helper.range": () =>
    "Anything from midnight today. Earlier doses are added from history.",
  "today.logAtTime.when.today": (p) => p.time,
  "today.logAtTime.when.tomorrow": (p) => `tomorrow at ${p.time}`,
  "today.logAtTime.when.onDate": (p) => `${p.date} at ${p.time}`,
  "today.logAtTime.next.moves": (p) => `Next dose moves to ${p.when}`,
  "today.logAtTime.next.movesDetailLater": (p) =>
    `This course counts from the last dose, so the whole chain follows the time you enter — ${p.delta} later than planned.`,
  "today.logAtTime.next.movesDetailEarlier": (p) =>
    `This course counts from the last dose, so the whole chain follows the time you enter — ${p.delta} earlier than planned.`,
  "today.logAtTime.next.stays": (p) => `Next dose stays at ${p.when}`,
  "today.logAtTime.next.staysDetail": (p) => `History will read "${p.late}".`,
  "today.logAtTime.next.none": () => "No further doses scheduled.",
  "today.logAtTime.confirm": (p) => `Log at ${p.time}`,
  "today.logAtTime.skipInstead": () => "Skip this dose instead",

  "today.toast.logged": (p) => `${p.medicationName} logged`,
  "today.toast.skipped": (p) => `${p.medicationName} skipped`,
  "today.undo": () => "Undo",
  "today.undo.tooLate": () => "Too late to undo",
  "today.toast.duplicateGiven": (p) => `Already given by ${p.name} at ${p.time}`,
  "today.toast.duplicateSkipped": (p) => `Already skipped by ${p.name} at ${p.time}`,
  "today.toast.logFailed": () => "Could not log the dose",
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
  "today.logAtTime.close": () => "Закрити",
  "today.logAtTime.subline": (p) =>
    `${p.petName} · заплановано на ${p.time} · ${p.schedule}`,
  "today.logAtTime.ago": (p) => `${p.duration} тому`,
  "today.logAtTime.todayAgo": (p) => `сьогодні · ${p.ago}`,
  "today.logAtTime.justNow": () => "Щойно",
  // "хв" is the standard invariant abbreviation — never pluralized, same
  // convention as `history.detail.lateDuration`.
  "today.logAtTime.offsetMinutes": (p) => `${p.minutes} хв`,
  // "год" is likewise invariant — never pluralized.
  "today.logAtTime.offsetHours": (p) => `${p.hours} год`,
  "today.logAtTime.atScheduled": () => "У запланований час",
  "today.logAtTime.atScheduledHelper": () => "Дано вчасно, записано пізніше",
  "today.logAtTime.exactLabel": () => "Або вкажіть точний час",
  "today.logAtTime.earlier": (p) => `− ${p.minutes} хв`,
  "today.logAtTime.later": (p) => `+ ${p.minutes} хв`,
  "today.logAtTime.helper.future": () => "Дозу не можна записати на майбутній час.",
  "today.logAtTime.helper.dayCheck": (p) =>
    `Це більш ніж за ${p.hours} год до запланованого часу — це сьогоднішня доза?`,
  "today.logAtTime.helper.range": () =>
    "Будь-який час від опівночі сьогодні. Раніші дози додаються через історію.",
  // Bare EN time reads fine after "to"/"at"; Ukrainian needs its own
  // preposition here so the fragment composes into `next.moves`/`next.stays`
  // exactly the way `today.nextDose.today` already does in this file.
  "today.logAtTime.when.today": (p) => `о ${p.time}`,
  "today.logAtTime.when.tomorrow": (p) => `завтра о ${p.time}`,
  "today.logAtTime.when.onDate": (p) => `${p.date} о ${p.time}`,
  // Mirrors `today.nextDose.*`: the verb carries no preposition of its own,
  // so it composes with all three `when.*` fragments above.
  "today.logAtTime.next.moves": (p) => `Наступна доза переноситься ${p.when}`,
  "today.logAtTime.next.movesDetailLater": (p) =>
    `Цей курс відлічується від останньої дози, тож увесь ланцюжок зсувається за введеним часом — на ${p.delta} пізніше за план.`,
  "today.logAtTime.next.movesDetailEarlier": (p) =>
    `Цей курс відлічується від останньої дози, тож увесь ланцюжок зсувається за введеним часом — на ${p.delta} раніше за план.`,
  "today.logAtTime.next.stays": (p) => `Наступна доза залишається ${p.when}`,
  "today.logAtTime.next.staysDetail": (p) => `Історія покаже "${p.late}".`,
  "today.logAtTime.next.none": () => "Більше доз не заплановано.",
  "today.logAtTime.confirm": (p) => `Записати о ${p.time}`,
  "today.logAtTime.skipInstead": () => "Натомість пропустити цю дозу",

  "today.toast.logged": (p) => `${p.medicationName} записано`,
  "today.toast.skipped": (p) => `${p.medicationName} пропущено`,
  "today.undo": () => "Скасувати",
  "today.undo.tooLate": () => "Запізно скасовувати",
  // `name` stays nominative and undeclined — it is DATA (SPEC §10a), the same
  // rule `today.comingUp.*` follows for pet/medication names.
  "today.toast.duplicateGiven": (p) => `Вже дано: ${p.name}, о ${p.time}`,
  "today.toast.duplicateSkipped": (p) => `Вже пропущено: ${p.name}, о ${p.time}`,
  "today.toast.logFailed": () => "Не вдалося записати дозу",
});
