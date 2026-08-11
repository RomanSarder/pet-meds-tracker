// Owned by the Pets wave. Backs `features/pets/format.ts`.
import type { Formatters } from "../formatters";

export interface PetsMessages {
  "pets.species.rabbit": () => string;
  "pets.species.guineaPig": () => string;
  "pets.species.cat": () => string;
  "pets.species.dog": () => string;
  "pets.species.other": () => string;

  "pets.eventWhen.today": () => string;
  "pets.eventWhen.yesterday": () => string;

  // The per-language "does this unit take a suffix" rule for doseLabel. The
  // unit string itself (`p.unit`) is user-entered DATA and must be echoed
  // verbatim — never translated — in both languages. See SPEC §10a and
  // I18N-DESIGN.md §4: English morphology (`+"s"`) is only correct applied
  // to English-entered data in an English sentence; Ukrainian renders the
  // unit exactly as entered, with no suffix.
  "pets.dose.countableUnit": (p: { unit: string; plural: boolean }) => string;

  // --- age.ts: ageLabel's four unit bands, each a real plural rule ---------
  "pets.age.years": (p: { n: number }) => string;
  "pets.age.months": (p: { n: number }) => string;
  "pets.age.weeks": (p: { n: number }) => string;
  "pets.age.days": (p: { n: number }) => string;

  // --- doseRow.ts / ScheduleRow.tsx: read-only schedule row states --------
  /** SPEC §9: state is never colour-only — the word itself carries "overdue". */
  "pets.schedule.overdue": () => string;

  // --- PetsPage.tsx (roster) -----------------------------------------------
  "pets.pageTitle": () => string;
  "pets.addCourseAction": () => string;
  "pets.noPetsYet": () => string;
  "pets.noActiveMedication": () => string;
  /** "3 animals" — the roster subtitle's first clause. */
  "pets.subtitle.animals": (p: { count: number }) => string;
  /** "2 active courses" — the roster subtitle's second clause. */
  "pets.subtitle.activeCourses": (p: { count: number }) => string;
  /** "2 people" / "1 person" — the household row's irregular count noun. */
  "pets.household.people": (p: { count: number }) => string;
  /** "Household · 2 people" — visible row text. */
  "pets.household.row": (p: { peopleLabel: string }) => string;
  /** "Household, 2 people" — the row's accessible name (comma, not a dot). */
  "pets.household.ariaLabel": (p: { peopleLabel: string }) => string;
  /** The pet card's accessible name; `name` is DATA. */
  "pets.openPet": (p: { name: string }) => string;
  /**
   * "Add a pet" — shared verbatim by the roster's empty-state action, its
   * dashed trailing card, and the pet form's own title/heading when creating
   * (all four are the same words in both languages), so this single key
   * backs every one of them rather than four near-duplicates.
   */
  "pets.addPetTitle": () => string;

  // --- PetDetailPage.tsx (and shared with PetFormPage/CourseFormPage) -----
  "pets.back": () => string;
  "pets.moreActions": () => string;
  /** Shared by the overflow menu item and the pet-form heading in edit mode. */
  "pets.editPet": () => string;
  "pets.archivePet": () => string;
  /** Shared "Close" aria-label for the pet form and the course form. */
  "pets.close": () => string;
  "pets.schedule": () => string;
  /** "2 today" — no noun follows the number in either language, so there is
   * nothing to decline; not routed through `tr.fmt.plural` (same precedent
   * as `today.counter`, which also pairs a bare count with an invariant
   * word). */
  "pets.schedule.countToday": (p: { count: number }) => string;
  "pets.courses": () => string;
  /** The course card's accessible name; `label` already carries DATA. */
  "pets.openCourse": (p: { label: string }) => string;
  "pets.recent": () => string;
  "pets.seeAllHistory": () => string;
  "pets.addMedication": () => string;
  /** "6 Aug 07:05 · by Roman" — `when` is already localized, `actor` is DATA. */
  "pets.recent.attribution": (p: { when: string; actor: string }) => string;

  // --- course status, shared by the Pet-detail "Paused" badge and the
  //     course form's own status word -------------------------------------
  "pets.courseStatus.active": () => string;
  "pets.courseStatus.paused": () => string;
  "pets.courseStatus.finished": () => string;
  "pets.courseStatus.stopped": () => string;

  // --- PetFormPage.tsx ------------------------------------------------------
  "pets.form.nameLabel": () => string;
  "pets.form.namePlaceholder": () => string;
  "pets.form.nameError": () => string;
  "pets.form.speciesLabel": () => string;
  "pets.form.birthdateLabel": () => string;
  "pets.form.weightLabel": () => string;
  "pets.form.weightPlaceholder": () => string;
  "pets.form.weightError": () => string;
  "pets.form.savePet": () => string;

  // --- CourseFormPage.tsx ----------------------------------------------------
  "courses.newMedicationTitle": () => string;
  "courses.for": () => string;
  "courses.loadingPets": () => string;
  "courses.lockedNote": () => string;
  "courses.petError": () => string;
  "courses.medicationLabel": () => string;
  "courses.medicationPlaceholder": () => string;
  "courses.medicationError": () => string;
  "courses.doseAmountLabel": () => string;
  "courses.doseAmountPlaceholder": () => string;
  "courses.doseError": () => string;
  "courses.unitLabel": () => string;
  "courses.unitPlaceholder": () => string;
  "courses.instructionsLabel": () => string;
  "courses.instructionsPlaceholder": () => string;
  "courses.howScheduled": () => string;
  "courses.intervalLabel": () => string;
  "courses.howOften": () => string;
  "courses.forHowLong": () => string;
  "courses.endDateLabel": () => string;
  "courses.endDateError": () => string;
  "courses.reminders": () => string;
  /**
   * The "From last dose" reminders paragraph. `hours` is interpolated as a
   * bare number + "h"/"год" — an abbreviated unit like the clock times
   * elsewhere in this app, not a countable noun — so it is not routed
   * through `tr.fmt.plural` (English's own "8h" is not pluralized either).
   */
  "courses.reminders.fromLastDose": (p: { hours: number }) => string;
  /**
   * SPEC §6.7 step 7: appended to the reminders paragraph ONLY when a daily
   * maximum is set — a second sentence, never a replacement for
   * `courses.reminders.fromLastDose` above. `max` is a bare count, same
   * non-pluralized convention as `hours` above (English "3 doses" IS
   * pluralized, so this one routes through `f.plural`; Ukrainian's own
   * plural rule differs and needs it too — see the `uk` export below).
   */
  "courses.reminders.maxPerDay": (p: { max: number }) => string;
  "courses.courseSection": () => string;
  "courses.pause": () => string;
  "courses.stop": () => string;
  "courses.resume": () => string;
  "courses.saveMedication": () => string;

  // --- scheduleChoice.ts: the chip label for every choice token. The chip
  //     VALUE (e.g. "Every 8h") stays an internal English token used for
  //     state/equality and persisted-schedule mapping; only the rendered
  //     label goes through the catalogue. ------------------------------
  "courses.interval.every2h": () => string;
  "courses.interval.every4h": () => string;
  "courses.interval.every6h": () => string;
  "courses.interval.every8h": () => string;
  "courses.interval.every12h": () => string;
  "courses.interval.every24h": () => string;
  "courses.frequency.onceDaily": () => string;
  "courses.frequency.twiceDaily": () => string;
  "courses.frequency.thriceDaily": () => string;
  "courses.frequency.weekly": () => string;
  "courses.duration.sevenDays": () => string;
  "courses.duration.fourteenDays": () => string;
  "courses.duration.ongoing": () => string;
  "courses.duration.custom": () => string;
  "courses.mode.fromLastDose": () => string;
  "courses.mode.atSetTimes": () => string;
  /** SPEC §6.7 step 5a section heading, above the daily-maximum chips. */
  "courses.maxPerDayLabel": () => string;
  "courses.maxPerDay.noMaximum": () => string;
  "courses.maxPerDay.two": () => string;
  "courses.maxPerDay.three": () => string;
  "courses.maxPerDay.four": () => string;

  // --- scheduleEditModel.ts / the times editor (shift-earlier feature) ----
  // `gap`/`expected` are already-rendered durations — the caller resolves
  // them through `history.detail.lateDuration` first (same convention as
  // `LogAtTimeSheet.tsx`), so no new plural rule is needed here; `time` is a
  // bare `HH:MM` from `formatHHMM`, never localized (SPEC §10a).
  /** `fixedTimes`: "Only {gap} since the {time} dose (this course is every {expected})." */
  "courses.gapWarning.tooSoon": (p: { gap: string; time: string; expected: string }) => string;
  /** `fromLastDose`: "Only {gap} between doses (was every {expected})." */
  "courses.gapWarning.tooSoonInterval": (p: { gap: string; expected: string }) => string;
  /** The sub-`GRACE_FIXED_MIN` band: the second dose this implies cannot
   * physically be logged (`DuplicateDoseError`), so the copy says so rather
   * than reusing the softer "only N since…" wording. */
  "courses.gapWarning.tooSoonToLog": (p: { gap: string }) => string;

  /** Section label for the `fixedTimes` slot editor. */
  "courses.times.label": () => string;
  /** Stepper `aria-label`, decrementing one slot — "15 minutes earlier, dose 2". */
  "courses.times.earlier": (p: { minutes: number; index: number }) => string;
  /** Stepper `aria-label`, incrementing one slot — "15 minutes later, dose 2". */
  "courses.times.later": (p: { minutes: number; index: number }) => string;
  /** The "was 20:00" caption under a slot that has been nudged off its original value. */
  "courses.times.was": (p: { time: string }) => string;
  /** Suffix shown once the edited times no longer match any preset (`isPresetSchedule` false). */
  "courses.times.customNote": () => string;
  /** The times editor's single `aria-live` region, announced after each stepper press. */
  "courses.times.announce": (p: { index: number; time: string }) => string;
}

export const enPets = (f: Formatters): PetsMessages => ({
  "pets.species.rabbit": () => "Rabbit",
  "pets.species.guineaPig": () => "Guinea pig",
  "pets.species.cat": () => "Cat",
  "pets.species.dog": () => "Dog",
  "pets.species.other": () => "Other",

  "pets.eventWhen.today": () => "today",
  "pets.eventWhen.yesterday": () => "yesterday",

  "pets.dose.countableUnit": (p) => (p.plural ? `${p.unit}s` : p.unit),

  "pets.age.years": (p) =>
    f.plural(p.n, { one: `${p.n} yr`, other: `${p.n} yrs` }),
  "pets.age.months": (p) =>
    f.plural(p.n, { one: `${p.n} mth`, other: `${p.n} mths` }),
  "pets.age.weeks": (p) =>
    f.plural(p.n, { one: `${p.n} wk`, other: `${p.n} wks` }),
  "pets.age.days": (p) =>
    f.plural(p.n, { one: `${p.n} day`, other: `${p.n} days` }),

  "pets.schedule.overdue": () => "Overdue",

  "pets.pageTitle": () => "Pets",
  "pets.addCourseAction": () => "Add a course",
  "pets.noPetsYet": () => "No pets yet",
  "pets.noActiveMedication": () => "No active medication",
  "pets.subtitle.animals": (p) =>
    f.plural(p.count, { one: `${p.count} animal`, other: `${p.count} animals` }),
  "pets.subtitle.activeCourses": (p) =>
    f.plural(p.count, {
      one: `${p.count} active course`,
      other: `${p.count} active courses`,
    }),
  "pets.household.people": (p) =>
    f.plural(p.count, { one: `${p.count} person`, other: `${p.count} people` }),
  "pets.household.row": (p) => `Household · ${p.peopleLabel}`,
  "pets.household.ariaLabel": (p) => `Household, ${p.peopleLabel}`,
  "pets.openPet": (p) => `Open ${p.name}`,
  "pets.addPetTitle": () => "Add a pet",

  "pets.back": () => "Back",
  "pets.moreActions": () => "More actions",
  "pets.editPet": () => "Edit pet",
  "pets.archivePet": () => "Archive pet",
  "pets.close": () => "Close",
  "pets.schedule": () => "Schedule",
  "pets.schedule.countToday": (p) => `${p.count} today`,
  "pets.courses": () => "Courses",
  "pets.openCourse": (p) => `Open ${p.label}`,
  "pets.recent": () => "Recent",
  "pets.seeAllHistory": () => "See all history",
  "pets.addMedication": () => "Add medication",
  "pets.recent.attribution": (p) => `${p.when} · by ${p.actor}`,

  "pets.courseStatus.active": () => "Active",
  "pets.courseStatus.paused": () => "Paused",
  "pets.courseStatus.finished": () => "Finished",
  "pets.courseStatus.stopped": () => "Stopped",

  "pets.form.nameLabel": () => "Name",
  "pets.form.namePlaceholder": () => "e.g. Clover",
  "pets.form.nameError": () => "Enter a name",
  "pets.form.speciesLabel": () => "Species",
  "pets.form.birthdateLabel": () => "Birthdate",
  "pets.form.weightLabel": () => "Weight (kg)",
  "pets.form.weightPlaceholder": () => "e.g. 1.9",
  "pets.form.weightError": () => "Enter a weight in kilograms",
  "pets.form.savePet": () => "Save pet",

  "courses.newMedicationTitle": () => "New medication",
  "courses.for": () => "For",
  "courses.loadingPets": () => "Loading pets",
  "courses.lockedNote": () =>
    "Pet and medication can't be changed after a course is created.",
  "courses.petError": () => "Choose a pet",
  "courses.medicationLabel": () => "Medication",
  "courses.medicationPlaceholder": () => "e.g. Metacam",
  "courses.medicationError": () => "Enter a medication name",
  "courses.doseAmountLabel": () => "Dose amount",
  "courses.doseAmountPlaceholder": () => "e.g. 0.4",
  "courses.doseError": () => "Enter a dose amount",
  "courses.unitLabel": () => "Unit",
  "courses.unitPlaceholder": () => "e.g. ml",
  "courses.instructionsLabel": () => "Instructions",
  "courses.instructionsPlaceholder": () => "e.g. after food",
  "courses.howScheduled": () => "How it is scheduled",
  "courses.intervalLabel": () => "Interval",
  "courses.howOften": () => "How often",
  "courses.forHowLong": () => "For how long",
  "courses.endDateLabel": () => "End date",
  "courses.endDateError": () => "Pick an end date",
  "courses.reminders": () => "Reminders",
  "courses.reminders.fromLastDose": (p) =>
    `The next dose is counted from the moment you log one — every ${p.hours}h. Nothing is due until the first dose is logged.`,
  "courses.reminders.maxPerDay": (p) =>
    f.plural(p.max, {
      one: `Nothing more is due once ${p.max} dose has been given today — you can still give and record one if needed.`,
      other: `Nothing more is due once ${p.max} doses have been given today — you can still give and record one if needed.`,
    }),
  "courses.courseSection": () => "Course",
  "courses.pause": () => "Pause",
  "courses.stop": () => "Stop",
  "courses.resume": () => "Resume",
  "courses.saveMedication": () => "Save medication",

  "courses.interval.every2h": () => "Every 2h",
  "courses.interval.every4h": () => "Every 4h",
  "courses.interval.every6h": () => "Every 6h",
  "courses.interval.every8h": () => "Every 8h",
  "courses.interval.every12h": () => "Every 12h",
  "courses.interval.every24h": () => "Every 24h",
  "courses.frequency.onceDaily": () => "Once daily",
  "courses.frequency.twiceDaily": () => "2× daily",
  "courses.frequency.thriceDaily": () => "3× daily",
  "courses.frequency.weekly": () => "Weekly",
  "courses.duration.sevenDays": () => "7 days",
  "courses.duration.fourteenDays": () => "14 days",
  "courses.duration.ongoing": () => "Ongoing",
  "courses.duration.custom": () => "Custom",
  "courses.mode.fromLastDose": () => "From last dose",
  "courses.mode.atSetTimes": () => "At set times",
  "courses.maxPerDayLabel": () => "Daily maximum",
  "courses.maxPerDay.noMaximum": () => "No maximum",
  "courses.maxPerDay.two": () => "2",
  "courses.maxPerDay.three": () => "3",
  "courses.maxPerDay.four": () => "4 per day",

  "courses.gapWarning.tooSoon": (p) =>
    `Only ${p.gap} since the ${p.time} dose (this course is every ${p.expected}).`,
  "courses.gapWarning.tooSoonInterval": (p) =>
    `Only ${p.gap} between doses (was every ${p.expected}).`,
  "courses.gapWarning.tooSoonToLog": (p) =>
    `Doses less than ${p.gap} apart cannot both be logged.`,

  "courses.times.label": () => "Times",
  "courses.times.earlier": (p) => `${p.minutes} minutes earlier, dose ${p.index}`,
  "courses.times.later": (p) => `${p.minutes} minutes later, dose ${p.index}`,
  "courses.times.was": (p) => `was ${p.time}`,
  "courses.times.customNote": () => "Custom times",
  "courses.times.announce": (p) => `Dose ${p.index} set to ${p.time}`,
});

export const ukPets = (f: Formatters): PetsMessages => ({
  "pets.species.rabbit": () => "Кріль",
  "pets.species.guineaPig": () => "Морська свинка",
  "pets.species.cat": () => "Кіт",
  "pets.species.dog": () => "Собака",
  "pets.species.other": () => "Інше",

  "pets.eventWhen.today": () => "сьогодні",
  "pets.eventWhen.yesterday": () => "учора",

  // No English pluralisation morphology applied to Ukrainian sentences, and
  // the unit is never translated — it is echoed exactly as the user typed
  // it, regardless of amount.
  "pets.dose.countableUnit": (p) => p.unit,

  // one: 1, 21 → рік; few: 2-4 → роки; many: 0, 5-20 → років; other
  // (fractional) shares the "few" noun form, matching the convention set by
  // `i18n/catalogue/today.ts`.
  "pets.age.years": (p) =>
    f.plural(p.n, {
      one: `${p.n} рік`,
      few: `${p.n} роки`,
      many: `${p.n} років`,
      other: `${p.n} роки`,
    }),
  "pets.age.months": (p) =>
    f.plural(p.n, {
      one: `${p.n} місяць`,
      few: `${p.n} місяці`,
      many: `${p.n} місяців`,
      other: `${p.n} місяці`,
    }),
  "pets.age.weeks": (p) =>
    f.plural(p.n, {
      one: `${p.n} тиждень`,
      few: `${p.n} тижні`,
      many: `${p.n} тижнів`,
      other: `${p.n} тижні`,
    }),
  // Also what a future/today birthdate renders through (n = 0 → "many").
  "pets.age.days": (p) =>
    f.plural(p.n, {
      one: `${p.n} день`,
      few: `${p.n} дні`,
      many: `${p.n} днів`,
      other: `${p.n} дні`,
    }),

  "pets.schedule.overdue": () => "Прострочено",

  "pets.pageTitle": () => "Тварини",
  "pets.addCourseAction": () => "Додати курс",
  "pets.noPetsYet": () => "Ще немає тварин",
  "pets.noActiveMedication": () => "Немає активних ліків",
  "pets.subtitle.animals": (p) =>
    f.plural(p.count, {
      one: `${p.count} тварина`,
      few: `${p.count} тварини`,
      many: `${p.count} тварин`,
      other: `${p.count} тварини`,
    }),
  "pets.subtitle.activeCourses": (p) =>
    f.plural(p.count, {
      one: `${p.count} активний курс`,
      few: `${p.count} активні курси`,
      many: `${p.count} активних курсів`,
      other: `${p.count} активні курси`,
    }),
  "pets.household.people": (p) =>
    f.plural(p.count, {
      one: `${p.count} особа`,
      few: `${p.count} особи`,
      many: `${p.count} осіб`,
      other: `${p.count} особи`,
    }),
  "pets.household.row": (p) => `Домогосподарство · ${p.peopleLabel}`,
  "pets.household.ariaLabel": (p) => `Домогосподарство, ${p.peopleLabel}`,
  "pets.openPet": (p) => `Відкрити ${p.name}`,
  "pets.addPetTitle": () => "Додати тварину",

  "pets.back": () => "Назад",
  "pets.moreActions": () => "Більше дій",
  "pets.editPet": () => "Редагувати тварину",
  "pets.archivePet": () => "Архівувати тварину",
  "pets.close": () => "Закрити",
  "pets.schedule": () => "Розклад",
  "pets.schedule.countToday": (p) => `${p.count} сьогодні`,
  "pets.courses": () => "Курси",
  "pets.openCourse": (p) => `Відкрити ${p.label}`,
  "pets.recent": () => "Останнє",
  "pets.seeAllHistory": () => "Уся історія",
  "pets.addMedication": () => "Додати ліки",
  // "від {actor}" ("from {actor}") rather than a literal "by", which reads
  // more naturally in Ukrainian and needs no gender agreement with the
  // actor's name (DATA, interpolated verbatim either way).
  "pets.recent.attribution": (p) => `${p.when} · від ${p.actor}`,

  "pets.courseStatus.active": () => "Активний",
  "pets.courseStatus.paused": () => "Призупинено",
  "pets.courseStatus.finished": () => "Завершено",
  "pets.courseStatus.stopped": () => "Зупинено",

  "pets.form.nameLabel": () => "Ім'я",
  "pets.form.namePlaceholder": () => "напр. Кловер",
  "pets.form.nameError": () => "Введіть ім'я",
  "pets.form.speciesLabel": () => "Вид",
  "pets.form.birthdateLabel": () => "Дата народження",
  "pets.form.weightLabel": () => "Вага (кг)",
  "pets.form.weightPlaceholder": () => "напр. 1.9",
  "pets.form.weightError": () => "Введіть вагу в кілограмах",
  "pets.form.savePet": () => "Зберегти тварину",

  "courses.newMedicationTitle": () => "Нові ліки",
  "courses.for": () => "Для",
  "courses.loadingPets": () => "Завантаження тварин",
  "courses.lockedNote": () =>
    "Тварину та ліки не можна змінити після створення курсу.",
  "courses.petError": () => "Виберіть тварину",
  "courses.medicationLabel": () => "Ліки",
  "courses.medicationPlaceholder": () => "напр. Метакам",
  "courses.medicationError": () => "Введіть назву ліків",
  "courses.doseAmountLabel": () => "Доза",
  "courses.doseAmountPlaceholder": () => "напр. 0.4",
  "courses.doseError": () => "Введіть дозу",
  "courses.unitLabel": () => "Одиниця",
  "courses.unitPlaceholder": () => "напр. ml",
  "courses.instructionsLabel": () => "Інструкції",
  "courses.instructionsPlaceholder": () => "напр. після їжі",
  "courses.howScheduled": () => "Як призначено",
  "courses.intervalLabel": () => "Інтервал",
  "courses.howOften": () => "Як часто",
  "courses.forHowLong": () => "Як довго",
  "courses.endDateLabel": () => "Дата завершення",
  "courses.endDateError": () => "Виберіть дату завершення",
  "courses.reminders": () => "Нагадування",
  // `hours` stays a bare number + "год" — an abbreviated unit, like the
  // clock times elsewhere in the app — not a declined countable noun, so no
  // `f.plural` here (mirrors English's own unpluralized "8h").
  "courses.reminders.fromLastDose": (p) =>
    `Наступна доза відраховується з моменту, коли ви фіксуєте попередню, — кожні ${p.hours} год. Жодна доза не вважається простроченою, доки ви не зафіксуєте першу.`,
  // "понад" ("more than") governs the genitive plural invariantly regardless
  // of the count that follows it — unlike `hours` above, there is no
  // one/few/many form to branch on here, so this is not `f.plural` and is
  // not a lazy suffix either (SPEC §10a): it is the one correct form for
  // every value the chips can produce (2, 3, 4).
  "courses.reminders.maxPerDay": (p) =>
    `Понад ${p.max} доз на день більше не заплановано — ви завжди можете дати та зафіксувати ще одну, якщо потрібно.`,
  "courses.courseSection": () => "Курс",
  "courses.pause": () => "Призупинити",
  "courses.stop": () => "Зупинити",
  "courses.resume": () => "Відновити",
  "courses.saveMedication": () => "Зберегти ліки",

  // The chip's persisted VALUE stays the English token (see the interface
  // comment above); only these rendered labels are Ukrainian.
  "courses.interval.every2h": () => "Кожні 2 год",
  "courses.interval.every4h": () => "Кожні 4 год",
  "courses.interval.every6h": () => "Кожні 6 год",
  "courses.interval.every8h": () => "Кожні 8 год",
  "courses.interval.every12h": () => "Кожні 12 год",
  "courses.interval.every24h": () => "Кожні 24 год",
  "courses.frequency.onceDaily": () => "Раз на день",
  "courses.frequency.twiceDaily": () => "2× на день",
  "courses.frequency.thriceDaily": () => "3× на день",
  "courses.frequency.weekly": () => "Щотижня",
  "courses.duration.sevenDays": () => "7 днів",
  "courses.duration.fourteenDays": () => "14 днів",
  "courses.duration.ongoing": () => "Постійно",
  "courses.duration.custom": () => "Власний варіант",
  "courses.mode.fromLastDose": () => "Від останньої дози",
  "courses.mode.atSetTimes": () => "У встановлений час",
  "courses.maxPerDayLabel": () => "Добовий максимум",
  "courses.maxPerDay.noMaximum": () => "Без максимуму",
  "courses.maxPerDay.two": () => "2",
  "courses.maxPerDay.three": () => "3",
  "courses.maxPerDay.four": () => "4 на день",

  "courses.gapWarning.tooSoon": (p) =>
    `Лише ${p.gap} після дози о ${p.time} (цей курс — кожні ${p.expected}).`,
  "courses.gapWarning.tooSoonInterval": (p) =>
    `Лише ${p.gap} між дозами (було кожні ${p.expected}).`,
  "courses.gapWarning.tooSoonToLog": (p) =>
    `Дози з інтервалом менше ${p.gap} не можна зафіксувати обидві.`,

  "courses.times.label": () => "Час прийому",
  "courses.times.earlier": (p) => `На ${p.minutes} хв раніше, доза ${p.index}`,
  "courses.times.later": (p) => `На ${p.minutes} хв пізніше, доза ${p.index}`,
  "courses.times.was": (p) => `було ${p.time}`,
  "courses.times.customNote": () => "Власний розклад",
  "courses.times.announce": (p) => `Дозу ${p.index} встановлено на ${p.time}`,
});
