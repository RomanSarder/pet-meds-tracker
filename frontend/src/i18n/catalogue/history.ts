// Owned by the History wave. Every user-facing literal of the Pet history
// screen (SPEC §6.4) — the screen chrome, the day headings, the factual
// detail clauses `features/history/logModel.ts` emits as structure, and the
// plain-text export's header.
//
// Three things deliberately do NOT appear here, because they are not words:
//   - clock times ("08:00") and dose amounts — SPEC §10a, both are echoed
//     verbatim by the renderer;
//   - course instructions and the user's own dose notes — DATA, carried by
//     `{ kind: "text" }` clauses and never looked up here;
//   - weekday/month names — those come from `f.weekdayDayMonth`, i.e. from
//     `Intl.DateTimeFormat`, not from hand-written tables.
import type { Formatters } from "../formatters";

export interface HistoryMessages {
  // --- screen chrome ---
  "history.title": () => string;
  "history.back": () => string;
  /** "Rabbit · 2 active courses" — `species` is already localized by `speciesLabel`. */
  "history.subtitle": (p: { species: string; courses: number }) => string;
  "history.filter.all": () => string;
  "history.filter.doses": () => string;
  "history.filter.courses": () => string;
  "history.stat.given": () => string;
  "history.stat.skipped": () => string;
  "history.stat.missed": () => string;
  /** The section label's trailing count: "1 event" / "6 events". */
  "history.eventCount": (p: { count: number }) => string;
  /** "by Roman" — `name` is DATA (a household display name), never translated. */
  "history.byActor": (p: { name: string }) => string;
  "history.loadEarlier": () => string;
  "history.export.action": () => string;
  "history.export.plainText": () => string;
  "history.export.csv": () => string;
  /** The per-row overflow trigger's label. `medicationName` is DATA, never translated. */
  "history.moreOptions": (p: { medicationName: string }) => string;
  /** The only item in that overflow, for a `given` dose. */
  "history.menu.editTime": () => string;
  /** The plain-text export's first line. `from`/`to` are already-formatted dates. */
  "history.export.header": (p: {
    petName: string;
    from: string;
    to: string;
  }) => string;

  // --- day headings ---
  "history.day.today": () => string;
  "history.day.yesterday": () => string;
  /** Composes "Today" + "Sun 9 Aug" into one heading. */
  "history.day.heading": (p: { relative: string; date: string }) => string;

  // --- detail clauses (one entry per `DetailClause` kind) ---
  "history.detail.given": () => string;
  /**
   * How long a dose was late, as an abbreviation: "40 min" / "2 h" /
   * "2 h 15 min". `h`/`min` are symbols, not spoken words, so they take no
   * plural form in either language. `hours` may be 0.
   */
  "history.detail.lateDuration": (p: {
    hours: number;
    minutes: number;
  }) => string;
  "history.detail.givenLate": (p: { late: string }) => string;
  "history.detail.skipped": () => string;
  "history.detail.missed": () => string;
  "history.detail.scheduledAt": (p: { time: string }) => string;
  "history.detail.chainShifted": () => string;
  /** `schedule` is already rendered by `i18n/schedule.ts#renderSchedule`. */
  "history.detail.nextDue": (p: { time: string; schedule: string }) => string;
  "history.detail.courseStarted": () => string;
  /** The course's length: "for 7 days". */
  "history.detail.forDays": (p: { days: number }) => string;
  "history.detail.coursePaused": () => string;
  "history.detail.courseResumed": () => string;
  "history.detail.courseStopped": () => string;
  "history.detail.courseFinished": () => string;
  "history.detail.courseEdited": () => string;
  /** Both schedules are already rendered by `renderSchedule`. */
  "history.detail.intervalChanged": (p: {
    before: string;
    after: string;
  }) => string;
  /** Both doses are already rendered by `doseLabel`; amounts never localize. */
  "history.detail.doseChanged": (p: {
    before: string;
    after: string;
  }) => string;
  /**
   * A dose whose time was corrected from history. `from` is the clock time it
   * used to carry — interpolated verbatim (SPEC §10a). The row itself shows
   * the corrected time, so this clause is what keeps the correction visible
   * rather than silent: append-only storage is only an audit trail if the
   * screen says an edit happened.
   */
  "history.detail.timeEdited": (p: { from: string }) => string;

  // --- edit-time sheet ------------------------------------------------------
  "history.editTime.title": () => string;
  "history.editTime.close": () => string;
  /** "Recorded Sat 8 Aug at 08:12" — `date` is from `Intl`, `time` is a verbatim clock time. */
  "history.editTime.subline": (p: { date: string; time: string }) => string;
  /** The `0` offset chip: back to the time the dose currently carries. */
  "history.editTime.original": () => string;
  /**
   * The negative/positive offset chips. `duration` is
   * `history.detail.lateDuration` rendered — "30 min" / "1 h" — so the chip
   * row and every other duration on the screen share one formatting rule.
   */
  "history.editTime.earlierBy": (p: { duration: string }) => string;
  "history.editTime.laterBy": (p: { duration: string }) => string;
  "history.editTime.exactLabel": () => string;
  "history.editTime.stepEarlier": (p: { minutes: number }) => string;
  "history.editTime.stepLater": (p: { minutes: number }) => string;
  /**
   * The helper line, in four shapes — one per combination of "is there a dose
   * before this one" and "is there a dose after it". It states WHY the range
   * is what it is, because that reason IS the feature: a dose penned between
   * its neighbours cannot become the newest one, and only the newest one moves
   * a `fromLastDose` chain (SPEC §3b). Every `time` is a verbatim clock time.
   */
  "history.editTime.helper.upToNow": () => string;
  "history.editTime.helper.afterPrevious": (p: { from: string }) => string;
  "history.editTime.helper.beforeNext": (p: { to: string }) => string;
  "history.editTime.helper.between": (p: {
    from: string;
    to: string;
  }) => string;
  /** Consequence headline when the edit moves nothing but this entry. */
  "history.editTime.next.unchanged": () => string;
  "history.editTime.next.unchangedDetail": () => string;
  /**
   * Consequence headline for the last dose of a `fromLastDose` course.
   * `when` is a rendered `today.logAtTime.whenMoves.*` fragment — reused
   * rather than duplicated because it is the same verb in both places
   * ("moves to"), and Ukrainian's «переноситися» takes the allative «на»
   * whichever screen says it. Restating it here would fork that grammar.
   */
  "history.editTime.next.moves": (p: { when: string }) => string;
  "history.editTime.next.movesDetailLater": (p: { delta: string }) => string;
  "history.editTime.next.movesDetailEarlier": (p: { delta: string }) => string;
  /**
   * `aria-label` on the sheet's scrollable content region. Needed because the
   * region has no visible heading of its own — SPEC §9's landmark for a
   * keyboard/screen-reader user to find the scrollable body distinct from the
   * fixed header/footer around it, at viewports short enough that not
   * everything fits without scrolling.
   */
  "history.editTime.scrollRegion": () => string;
  /** Footer: "Save 08:40". Disabled until the time actually differs. */
  "history.editTime.save": (p: { time: string }) => string;
  /** `medicationName` is DATA — never translated. */
  "history.toast.timeUpdated": (p: { medicationName: string }) => string;
  "history.toast.timeUpdateFailed": () => string;
}

export const enHistory = (f: Formatters): HistoryMessages => ({
  "history.title": () => "History",
  "history.back": () => "Back",
  // Pre-localization this read "N active courses" unconditionally, so a
  // single course rendered "1 active courses". Routing the count through a
  // real plural rule corrects it as a side effect.
  "history.subtitle": (p) =>
    `${p.species} · ${f.plural(p.courses, {
      one: `${p.courses} active course`,
      other: `${p.courses} active courses`,
    })}`,
  "history.filter.all": () => "All",
  "history.filter.doses": () => "Doses",
  "history.filter.courses": () => "Courses",
  "history.stat.given": () => "Given",
  "history.stat.skipped": () => "Skipped",
  "history.stat.missed": () => "Missed",
  "history.eventCount": (p) =>
    f.plural(p.count, { one: `${p.count} event`, other: `${p.count} events` }),
  "history.byActor": (p) => `by ${p.name}`,
  "history.loadEarlier": () => "Load earlier",
  "history.export.action": () => "Export history",
  "history.export.plainText": () => "Plain text",
  "history.export.csv": () => "CSV",
  "history.export.header": (p) => `${p.petName} — history ${p.from} to ${p.to}`,
  "history.moreOptions": (p) => `More options for ${p.medicationName}`,
  "history.menu.editTime": () => "Edit time",

  "history.day.today": () => "Today",
  "history.day.yesterday": () => "Yesterday",
  "history.day.heading": (p) => `${p.relative} · ${p.date}`,

  "history.detail.given": () => "Given",
  "history.detail.lateDuration": (p) => {
    if (p.hours === 0) return `${p.minutes} min`;
    return p.minutes === 0 ? `${p.hours} h` : `${p.hours} h ${p.minutes} min`;
  },
  "history.detail.givenLate": (p) => `Given ${p.late} late`,
  "history.detail.skipped": () => "Skipped",
  "history.detail.missed": () => "Missed",
  "history.detail.scheduledAt": (p) => `scheduled ${p.time}`,
  "history.detail.chainShifted": () => "chain shifted",
  "history.detail.nextDue": (p) => `next due ${p.time}, ${p.schedule}`,
  "history.detail.courseStarted": () => "Course started",
  // Pre-localization this read "for N days" unconditionally, so a one-day
  // course rendered "for 1 days". The plural rule corrects it.
  "history.detail.forDays": (p) =>
    f.plural(p.days, { one: `for ${p.days} day`, other: `for ${p.days} days` }),
  "history.detail.coursePaused": () => "Course paused",
  "history.detail.courseResumed": () => "Course resumed",
  "history.detail.courseStopped": () => "Course stopped",
  "history.detail.courseFinished": () => "Course finished",
  "history.detail.courseEdited": () => "Course edited",
  "history.detail.intervalChanged": (p) =>
    `Interval changed · ${p.before} to ${p.after}`,
  "history.detail.doseChanged": (p) =>
    `Dose changed · ${p.before} to ${p.after}`,
  "history.detail.timeEdited": (p) => `time edited from ${p.from}`,

  "history.editTime.title": () => "Edit dose time",
  "history.editTime.close": () => "Close",
  "history.editTime.subline": (p) => `Recorded ${p.date} at ${p.time}`,
  "history.editTime.original": () => "Original",
  "history.editTime.earlierBy": (p) => `− ${p.duration}`,
  "history.editTime.laterBy": (p) => `+ ${p.duration}`,
  "history.editTime.exactLabel": () => "Or set it exactly",
  "history.editTime.stepEarlier": (p) => `− ${p.minutes} min`,
  "history.editTime.stepLater": (p) => `+ ${p.minutes} min`,
  "history.editTime.helper.upToNow": () => "Anything up to now.",
  "history.editTime.helper.afterPrevious": (p) =>
    `Anything after the previous dose at ${p.from}, up to now.`,
  "history.editTime.helper.beforeNext": (p) =>
    `Anything before the next dose at ${p.to}.`,
  "history.editTime.helper.between": (p) =>
    `Anything between the doses either side — ${p.from} and ${p.to}.`,
  "history.editTime.next.unchanged": () => "Nothing else moves",
  "history.editTime.next.unchangedDetail": () =>
    "Only this entry's time changes. Later doses stay where they are.",
  "history.editTime.next.moves": (p) => `Next dose moves to ${p.when}`,
  "history.editTime.next.movesDetailLater": (p) =>
    `This is the last dose, and the course counts from the last dose — so the whole chain follows it, ${p.delta} later.`,
  "history.editTime.next.movesDetailEarlier": (p) =>
    `This is the last dose, and the course counts from the last dose — so the whole chain follows it, ${p.delta} earlier.`,
  "history.editTime.scrollRegion": () => "Edit time details, scrollable",
  "history.editTime.save": (p) => `Save ${p.time}`,
  "history.toast.timeUpdated": (p) => `${p.medicationName} time updated`,
  "history.toast.timeUpdateFailed": () => "That time could not be saved.",
});

export const ukHistory = (f: Formatters): HistoryMessages => ({
  "history.title": () => "Історія",
  "history.back": () => "Назад",
  // one: 1, 21 … → 1 активний курс; few: 2–4 → 2 активні курси;
  // many: 5–20, 0 → 5 активних курсів; other: fractionals.
  "history.subtitle": (p) =>
    `${p.species} · ${f.plural(p.courses, {
      one: `${p.courses} активний курс`,
      few: `${p.courses} активні курси`,
      many: `${p.courses} активних курсів`,
      other: `${p.courses} активного курсу`,
    })}`,
  "history.filter.all": () => "Усі",
  "history.filter.doses": () => "Дози",
  "history.filter.courses": () => "Курси",
  "history.stat.given": () => "Дано",
  "history.stat.skipped": () => "Пропущено",
  "history.stat.missed": () => "Не дано",
  "history.eventCount": (p) =>
    f.plural(p.count, {
      one: `${p.count} подія`,
      few: `${p.count} події`,
      many: `${p.count} подій`,
      other: `${p.count} події`,
    }),
  "history.byActor": (p) => `виконано: ${p.name}`,
  "history.loadEarlier": () => "Завантажити раніші",
  "history.export.action": () => "Експортувати історію",
  "history.export.plainText": () => "Звичайний текст",
  "history.export.csv": () => "CSV",
  "history.export.header": (p) =>
    `${p.petName} — історія з ${p.from} до ${p.to}`,
  "history.moreOptions": (p) => `Більше дій для «${p.medicationName}»`,
  "history.menu.editTime": () => "Змінити час",

  "history.day.today": () => "Сьогодні",
  "history.day.yesterday": () => "Учора",
  "history.day.heading": (p) => `${p.relative} · ${p.date}`,

  "history.detail.given": () => "Дано",
  // "год"/"хв" are the standard invariant abbreviations — never pluralized.
  "history.detail.lateDuration": (p) => {
    if (p.hours === 0) return `${p.minutes} хв`;
    return p.minutes === 0
      ? `${p.hours} год`
      : `${p.hours} год ${p.minutes} хв`;
  },
  "history.detail.givenLate": (p) => `Дано із запізненням на ${p.late}`,
  "history.detail.skipped": () => "Пропущено",
  // Distinct from "Пропущено": a skipped dose was deliberately not given,
  // a missed one was never logged at all.
  "history.detail.missed": () => "Не дано",
  "history.detail.scheduledAt": (p) => `за розкладом ${p.time}`,
  "history.detail.chainShifted": () => "ланцюжок зсунуто",
  "history.detail.nextDue": (p) => `наступна доза ${p.time}, ${p.schedule}`,
  "history.detail.courseStarted": () => "Курс розпочато",
  "history.detail.forDays": (p) =>
    f.plural(p.days, {
      one: `на ${p.days} день`,
      few: `на ${p.days} дні`,
      many: `на ${p.days} днів`,
      other: `на ${p.days} дня`,
    }),
  "history.detail.coursePaused": () => "Курс призупинено",
  "history.detail.courseResumed": () => "Курс відновлено",
  "history.detail.courseStopped": () => "Курс зупинено",
  "history.detail.courseFinished": () => "Курс завершено",
  "history.detail.courseEdited": () => "Курс змінено",
  "history.detail.intervalChanged": (p) =>
    `Інтервал змінено · ${p.before} на ${p.after}`,
  "history.detail.doseChanged": (p) =>
    `Дозу змінено · ${p.before} на ${p.after}`,
  "history.detail.timeEdited": (p) => `час змінено з ${p.from}`,

  "history.editTime.title": () => "Змінити час дози",
  "history.editTime.close": () => "Закрити",
  "history.editTime.subline": (p) => `Записано ${p.date} о ${p.time}`,
  "history.editTime.original": () => "Як було",
  "history.editTime.earlierBy": (p) => `− ${p.duration}`,
  "history.editTime.laterBy": (p) => `+ ${p.duration}`,
  "history.editTime.exactLabel": () => "Або вкажіть точно",
  "history.editTime.stepEarlier": (p) => `− ${p.minutes} хв`,
  "history.editTime.stepLater": (p) => `+ ${p.minutes} хв`,
  "history.editTime.helper.upToNow": () => "Будь-який час до цієї миті.",
  "history.editTime.helper.afterPrevious": (p) =>
    `Будь-який час після попередньої дози о ${p.from} і до цієї миті.`,
  "history.editTime.helper.beforeNext": (p) =>
    `Будь-який час до наступної дози о ${p.to}.`,
  "history.editTime.helper.between": (p) =>
    `Будь-який час між сусідніми дозами — ${p.from} і ${p.to}.`,
  "history.editTime.next.unchanged": () => "Більше нічого не змінюється",
  "history.editTime.next.unchangedDetail": () =>
    "Змінюється лише час цього запису. Пізніші дози залишаються на місці.",
  "history.editTime.next.moves": (p) => `Наступна доза переноситься ${p.when}`,
  "history.editTime.next.movesDetailLater": (p) =>
    `Це остання доза, а курс рахується від останньої дози — тож увесь ланцюжок зсувається за нею, на ${p.delta} пізніше.`,
  "history.editTime.next.movesDetailEarlier": (p) =>
    `Це остання доза, а курс рахується від останньої дози — тож увесь ланцюжок зсувається за нею, на ${p.delta} раніше.`,
  "history.editTime.scrollRegion": () =>
    "Деталі зміни часу, можна прокручувати",
  "history.editTime.save": (p) => `Зберегти ${p.time}`,
  "history.toast.timeUpdated": (p) => `Час дози «${p.medicationName}» змінено`,
  "history.toast.timeUpdateFailed": () => "Не вдалося зберегти цей час.",
});
