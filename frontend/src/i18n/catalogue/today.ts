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
  /**
   * "3 doses left today" — the whole header subtitle while doses remain.
   * SPEC §6.1: the overdue count never repeats here — it moved to the day
   * progress note (`today.dayProgress.*`) below the header.
   */
  "today.subtitle": (p: { remaining: number }) => string;
  /** The whole subtitle when nothing remains — SPEC §6.1's zero case. */
  "today.subtitle.allDone": () => string;

  // --- day progress (SPEC §6.1, directly under the header) ----------------
  /**
   * "3 of 5 given today" — the block's large, tabular headline. Counts span
   * every pet (SPEC §6.1's household scope, distinct from the pet card's
   * `today.counter` and the row's `today.pill.count`).
   */
  "today.dayProgress.headline": (p: { given: number; total: number }) => string;
  /** Trailing note when at least one dose is overdue — takes precedence over `next`/`allDone`. */
  "today.dayProgress.overdue": (p: { overdue: number }) => string;
  /** Trailing note naming the next dose due later today, when nothing is overdue. */
  "today.dayProgress.next": (p: { time: string }) => string;
  /** Trailing note when nothing is overdue and nothing else is due today. */
  "today.dayProgress.allDone": () => string;

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

  // --- per-medication row pill (SPEC §4) -----------------------------------
  /**
   * "2 of 3 doses" — every dose row's quiet count pill. `total` is that
   * COURSE's own rendered occurrences today, never a schedule-derived guess
   * (SPEC's denominator rule: a `fromLastDose` course's `total` comes from
   * what is actually on screen, never `24 / intervalHours`). `given` counts
   * only this course's `given` events today, not `skipped` — the pill
   * answers "how many times have I given this", not "how many are resolved".
   * The word is always "doses", never "today" (SPEC §4: that word is reserved
   * for the pet card's `today.counter`).
   */
  "today.pill.count": (p: { given: number; total: number }) => string;
  /**
   * "3 of 3 max" — the amber pill SPEC §3b-i's `capped` state replaces
   * `today.pill.count` with, never alongside it. `given`/`max` come from
   * `todayModel.ts`'s `toDose`, which reads them off the occurrence's own
   * `givenToday`/`maxPerDay` verbatim.
   */
  "today.pill.cap": (p: { given: number; max: number }) => string;
  /**
   * The capped row's ghost action (SPEC §3b-i): "the cap warns, it does not
   * lock". `TodayPage.tsx` wires this to the same `give` callback its
   * primary button uses, which logs a normal `given` event flagged
   * `overMax` — this catalogue entry only supplies the label.
   */
  "today.pill.giveAnyway": () => string;
  /**
   * Defect 4: the ghost action's own accessible name — its visible label
   * (`today.pill.giveAnyway`) is the bare "Give anyway" on every capped row,
   * so a screen-reader user with several capped courses hears identical
   * buttons with no way to tell which medication each belongs to.
   * `medicationName` is DATA, interpolated verbatim (never translated).
   */
  "today.pill.giveAnyway.aria": (p: { medicationName: string }) => string;

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
  /**
   * "yesterday · <ago>" — the SAME shape as `today.logAtTime.todayAgo`, for
   * when `chosen` falls on the previous LOCAL calendar day. Reachable since
   * the backdate floor widened to a rolling 24 h (COMMON §6 item 4): a
   * `chosen` instant near the floor can genuinely be yesterday, and
   * `todayAgo` alone would print a false "today" beside it. `LogAtTimeSheet`
   * selects between the two by comparing `localDayKey(chosen)` against
   * `localDayKey(effectiveNow)`, never by how many hours have elapsed.
   */
  "today.logAtTime.yesterdayAgo": (p: { ago: string }) => string;
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
  /** Default helper line: the entry range is a rolling last 24 hours. */
  "today.logAtTime.helper.range": () => string;
  /**
   * Just the chosen time — composed into `next.stays` in both languages.
   * `next.moves` does NOT use these: «переноситися» ("moves") takes a
   * different preposition than «залишається» ("stays") does from the same
   * time fragment, so it draws on the parallel `whenMoves.*` below instead
   * (see that key's comment).
   *
   * English puts the time first and the day qualifier after ("08:00
   * tomorrow", "14:30 on Sat 15 Aug") rather than "tomorrow at"/"on … at":
   * `next.*` already supplies its own trailing "at"/"to", and a second
   * preposition inside the fragment doubled up into "stays at tomorrow at
   * 08:00" — not English. Putting the day qualifier after the time means
   * only one preposition ever appears, from `next.*`, no matter which
   * variant fills `when`.
   */
  "today.logAtTime.when.today": (p: { time: string }) => string;
  "today.logAtTime.when.tomorrow": (p: { time: string }) => string;
  /** `date` is already localized by `f.weekdayDayMonth`. */
  "today.logAtTime.when.onDate": (p: { date: string; time: string }) => string;
  /**
   * The `when.*` fragment, but for `next.moves` specifically. English's
   * "to" already lives in the `next.*` template and the fragment itself
   * needs no preposition (same time-first structure as `when.*` above), so
   * these read identically to `when.*` in English — but Ukrainian's
   * «переноситися» takes the allative "на", not the punctual-locative "о"
   * that «залишається» (`when.*`) takes, so the two verbs need their own
   * fragments even though they share one time value.
   */
  "today.logAtTime.whenMoves.today": (p: { time: string }) => string;
  "today.logAtTime.whenMoves.tomorrow": (p: { time: string }) => string;
  "today.logAtTime.whenMoves.onDate": (p: { date: string; time: string }) => string;
  /** `fromLastDose` consequence headline; `when` is a rendered `whenMoves.*` value. */
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
   * SPEC §5's dedup rule: a SAME-OCCURRENCE collision (the exact-`scheduledFor`
   * hard block, never bypassable) is rejected client-side rather than
   * silently dropped. `name` is already resolved through `displayNameFor`
   * (never an email — SPEC §12) and `time` through `formatHHMM` — both
   * interpolated verbatim, never declined. "Already given by Marta at 07:12"
   * is the exact SPEC §5 copy. NOT used by the early-give confirm dialog
   * (F4) — that collision is BY CONSTRUCTION a DIFFERENT occurrence, so this
   * copy would assert a falsehood there; see `today.giveConfirm.lastGiven`.
   */
  "today.toast.duplicateGiven": (p: { name: string; time: string }) => string;
  /** Same rule, worded accurately when the conflicting event was a skip, not a give. */
  "today.toast.duplicateSkipped": (p: { name: string; time: string }) => string;
  /** Any other `logDose` failure that isn't the duplicate guard — a plain factual toast rather than silence. */
  "today.toast.logFailed": () => string;
  /**
   * The `EARLY_GIVE_FLOOR_MIN` guard's FALLBACK copy, for a caller that wired
   * no `onGiveConflict` handler and so cannot show the dialog SPEC §5 wants.
   * Unreachable from Today, which wires one for every log path — kept so the
   * degraded path says something rather than nothing. `duration` is
   * `history.detail.lateDuration` rendered ("6 min"), never a raw number.
   */
  "today.toast.tooSoonSinceLastDose": (p: { duration: string }) => string;

  // --- give confirm (SPEC §5: nothing refuses a dose, guards ask) --------
  /**
   * `EarlyGiveConfirmDialog`'s title. `medicationName` is DATA (SPEC §10a),
   * interpolated verbatim. One title for every conflict reason: the question
   * is always "give it anyway?", and the description below carries what makes
   * this particular give worth asking about. Deliberately kind-agnostic (F8):
   * reached for `fixedTimes` courses exactly as for `fromLastDose` ones.
   */
  "today.giveConfirm.title": (p: { medicationName: string }) => string;
  /**
   * Description sentence 1, grace-window case. NOT `today.toast.duplicateGiven`
   * reused — in the toast "already given" means the dose just attempted IS
   * the one on record; here the collision is BY CONSTRUCTION a different
   * occurrence, so that phrasing would read as "this was already given"
   * directly above a "Give anyway" button. `sinceLast` arrives already
   * rendered by `history.detail.lateDuration` ("40 min" / "1 h 30 min"),
   * never a wall-clock time the reader has to subtract.
   */
  "today.giveConfirm.lastGiven": (p: { name: string; sinceLast: string }) => string;
  /**
   * Same, worded for a SKIPPED collision — never "un-skip" framing. The
   * skipped dose stays skipped; this is about the DIFFERENT dose being given.
   */
  "today.giveConfirm.lastSkipped": (p: { name: string; sinceLast: string }) => string;
  /**
   * Same slot, for the `EARLY_GIVE_FLOOR_MIN` floor. Impersonal on purpose:
   * that guard compares against any live dose on the course and carries no
   * actor, so naming one — even as "Someone" — would claim knowledge the
   * error does not have.
   */
  "today.giveConfirm.lastDose": (p: { sinceLast: string }) => string;
  /**
   * Optional sentence 2, added only when the dose is genuinely not due yet.
   * Dropped entirely once it is due, rather than rendering "0 min".
   */
  "today.giveConfirm.notDueYet": (p: { early: string }) => string;
  /** Sentence 3, always present — the actual question the buttons answer. */
  "today.giveConfirm.question": () => string;
  /**
   * The atomic word `useLogDose.ts` substitutes for `lastGiven`/
   * `lastSkipped`'s `name` when the colliding dose's actor is THIS
   * device's own self user. `displayNameFor` (`@/domain`) returns a
   * self-user's raw, stored `displayName` verbatim — SPEC §10a: names are
   * DATA, never translated — and an un-renamed self-user's stored name
   * literally IS the English word "You" (`DEFAULT_SELF_DISPLAY_NAME`),
   * which stayed untranslated inside Ukrainian dialog prose otherwise. Same
   * fix `household.memberLine.you` already applies for the self row in the
   * member list — `isSelf`, not the raw name, decides — just this
   * template's own bare noun rather than a whole phrase.
   */
  "today.giveConfirm.you": () => string;
  /** Footer's negative action. Withdraws — logs nothing. */
  "today.giveConfirm.cancel": () => string;
  /** Footer's positive action — logs the dose now and re-anchors the chain (SPEC §3b). */
  "today.giveConfirm.confirm": () => string;
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
  "today.subtitle.allDone": () => "Everything given today",

  "today.dayProgress.headline": (p) => `${p.given} of ${p.total} given today`,
  "today.dayProgress.overdue": (p) => `${p.overdue} overdue`,
  "today.dayProgress.next": (p) => `next ${p.time}`,
  "today.dayProgress.allDone": () => "all done",

  "today.notStarted": () => "Not started",
  "today.status.overdueSince": (p) => `Overdue since ${p.time}`,
  "today.status.nextAt": (p) => `Next at ${p.time}`,
  "today.status.allDone": (p) => `All done · ${p.medicationName}`,
  "today.status.allDoneAt": (p) => `All done · ${p.medicationName} at ${p.time}`,
  "today.status.nothingScheduled": () => "Nothing scheduled",
  "today.counter": (p) => `${p.done} of ${p.total} today`,

  "today.pill.count": (p) => `${p.given} of ${p.total} doses`,
  "today.pill.cap": (p) => `${p.given} of ${p.max} max`,
  "today.pill.giveAnyway": () => "Give anyway",
  "today.pill.giveAnyway.aria": (p) => `Give ${p.medicationName} anyway`,

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
  "today.logAtTime.yesterdayAgo": (p) => `yesterday · ${p.ago}`,
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
    "Anything from the last 24 h. Earlier doses are added from history.",
  // Time first, day qualifier after — "08:00 tomorrow" / "14:30 on Sat 15
  // Aug" — so `next.*`'s own trailing "at"/"to" is the only preposition;
  // "stays at tomorrow at 08:00" was the double-preposition bug this avoids.
  "today.logAtTime.when.today": (p) => p.time,
  "today.logAtTime.when.tomorrow": (p) => `${p.time} tomorrow`,
  "today.logAtTime.when.onDate": (p) => `${p.time} on ${p.date}`,
  // No separate preposition needed in English — identical to `when.*`.
  "today.logAtTime.whenMoves.today": (p) => p.time,
  "today.logAtTime.whenMoves.tomorrow": (p) => `${p.time} tomorrow`,
  "today.logAtTime.whenMoves.onDate": (p) => `${p.time} on ${p.date}`,
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
  "today.toast.tooSoonSinceLastDose": (p) =>
    `A dose was logged for this course ${p.duration} ago — wait a little before logging another`,

  "today.giveConfirm.title": (p) => `Give ${p.medicationName} anyway?`,
  "today.giveConfirm.lastGiven": (p) => `${p.name} gave a dose ${p.sinceLast} ago.`,
  "today.giveConfirm.lastSkipped": (p) => `${p.name} skipped a dose ${p.sinceLast} ago.`,
  "today.giveConfirm.lastDose": (p) => `The last dose on this course was ${p.sinceLast} ago.`,
  "today.giveConfirm.notDueYet": (p) => `This one isn't due for another ${p.early}.`,
  "today.giveConfirm.question": () => "Give it and record it anyway?",
  "today.giveConfirm.you": () => "You",
  "today.giveConfirm.cancel": () => "Cancel",
  "today.giveConfirm.confirm": () => "Give anyway",
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
  "today.subtitle.allDone": () => "Сьогодні все дано",

  // SPEC §6.1 header never repeats the overdue count — it lives here now, on
  // the day progress note directly under it. Same one/few/many/other forms
  // `today.subtitle.overdue` used before this moved.
  "today.dayProgress.headline": (p) => `Дано ${p.given} з ${p.total} сьогодні`,
  "today.dayProgress.overdue": (p) =>
    f.plural(p.overdue, {
      one: `${p.overdue} прострочена`,
      few: `${p.overdue} прострочені`,
      many: `${p.overdue} прострочених`,
      other: `${p.overdue} простроченої`,
    }),
  "today.dayProgress.next": (p) => `далі о ${p.time}`,
  "today.dayProgress.allDone": () => "усе виконано",

  "today.notStarted": () => "Не розпочато",
  "today.status.overdueSince": (p) => `Прострочено з ${p.time}`,
  "today.status.nextAt": (p) => `Наступна о ${p.time}`,
  "today.status.allDone": (p) => `Усе виконано · ${p.medicationName}`,
  "today.status.allDoneAt": (p) => `Усе виконано · ${p.medicationName} о ${p.time}`,
  "today.status.nothingScheduled": () => "Нічого не заплановано",
  "today.counter": (p) => `${p.done} з ${p.total} сьогодні`,

  // Same one/few/many/other noun declension `today.subtitle` already uses for
  // "доза" — here it agrees with `total` (M), the count the noun is actually
  // describing ("N з M доз"), not `given` (N).
  "today.pill.count": (p) =>
    f.plural(p.total, {
      one: `${p.given} з ${p.total} доза`,
      few: `${p.given} з ${p.total} дози`,
      many: `${p.given} з ${p.total} доз`,
      other: `${p.given} з ${p.total} дози`,
    }),
  // "макс." is an invariant abbreviation, the same convention `today.logAtTime.offsetMinutes`/`offsetHours` already use — never declined.
  "today.pill.cap": (p) => `${p.given} з ${p.max} макс.`,
  "today.pill.giveAnyway": () => "Все одно дати",
  "today.pill.giveAnyway.aria": (p) => `Все одно дати ${p.medicationName}`,

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
  // "вчора" — the standard Ukrainian "yesterday", parallel to `сьогодні` above.
  "today.logAtTime.yesterdayAgo": (p) => `вчора · ${p.ago}`,
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
    "Будь-який час за останні 24 год. Раніші дози додаються через історію.",
  // Bare EN time reads fine after "to"/"at"; Ukrainian needs its own
  // preposition here too — but only for `next.stays` (`залишається`), which
  // takes the punctual-locative "о" the same way `today.nextDose.today`
  // does elsewhere in this file. `next.moves` (`переноситься`) is a verb of
  // relocation and idiomatically takes the allative "на" instead — a
  // different grammatical relationship, not a mirror of this one — so it
  // draws on `whenMoves.*` below rather than these.
  "today.logAtTime.when.today": (p) => `о ${p.time}`,
  "today.logAtTime.when.tomorrow": (p) => `завтра о ${p.time}`,
  "today.logAtTime.when.onDate": (p) => `${p.date} о ${p.time}`,
  // «переноситися» ("moves") takes the allative "на", not the "о" `when.*`
  // supplies for «залишається» ("stays") — "на завтра о 14:30" is the
  // idiomatic form, so "на" leads and the invariant "о" before a bare time
  // stays put when a date/weekday word already precedes it.
  "today.logAtTime.whenMoves.today": (p) => `на ${p.time}`,
  "today.logAtTime.whenMoves.tomorrow": (p) => `на завтра о ${p.time}`,
  "today.logAtTime.whenMoves.onDate": (p) => `на ${p.date} о ${p.time}`,
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
  "today.toast.tooSoonSinceLastDose": (p) =>
    `Дозу цього курсу вже введено ${p.duration} тому — зачекайте трохи, перш ніж вводити ще одну`,

  // `medicationName` stays nominative and undeclined — DATA (SPEC §10a),
  // same rule `today.toast.duplicateGiven`'s `name` follows above.
  "today.giveConfirm.title": (p) => `Все одно дати ${p.medicationName}?`,
  // Passive voice throughout ("дано"/"пропущено", not "дав"/"дала") —
  // `name` is DATA of unknown grammatical gender, the same reason
  // `today.toast.duplicateGiven` above never conjugates a verb to agree with
  // it. `name` rides along parenthetically rather than as a verb's subject,
  // so this is genuine dialog prose, not the toast's colon-delimited
  // "Вже дано: Марта, о 07:12" fragment repurposed.
  //
  // Each fragment is a whole sentence, so the dialog joining them with a
  // space does not depend on English clause order.
  "today.giveConfirm.lastGiven": (p) => `Попередню дозу дано ${p.sinceLast} тому (${p.name}).`,
  "today.giveConfirm.lastSkipped": (p) => `Попередню дозу пропущено ${p.sinceLast} тому (${p.name}).`,
  "today.giveConfirm.lastDose": (p) => `Останню дозу цього курсу введено ${p.sinceLast} тому.`,
  "today.giveConfirm.notDueYet": (p) => `Ця доза знадобиться ще через ${p.early}.`,
  "today.giveConfirm.question": () => "Все одно дати й записати?",
  // "Ви" — the same word `household.memberLine.you` already uses for the
  // self row in the member list, not the literal English "You" that would
  // otherwise land here via `displayNameFor`'s raw, un-renamed self
  // `displayName` (`useLogDose.ts` substitutes this key instead, `isSelf`-gated).
  "today.giveConfirm.you": () => "Ви",
  "today.giveConfirm.cancel": () => "Скасувати",
  "today.giveConfirm.confirm": () => "Все одно дати",
});
