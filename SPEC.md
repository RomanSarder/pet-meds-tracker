# Pet Meds — functional specification

Implementation brief for a mobile-first web app that tracks medication for a small household

of pets. Written to be handed to independent agents: each section is self-contained, and

§10 slices the work.

Design source of truth: this project's design system [`readme.md`](http://readme.md), `styles.css`, `components/`,

`ui_kits/petmeds-app/`). Do not invent visual decisions — every colour, size and copy

convention is already specified there.

---

## 1. Scope

**In scope (v1).** Pets, medication courses, a daily dashboard, logging a dose, a per-pet

history, and a supply/shopping view. Single household, offline-tolerant, no accounts.

**Out of scope (v1).** Vet appointments, weight tracking, photos, multi-household sharing,

cloud sync, push notification delivery infrastructure, dose calculators, medical advice.

**Non-negotiable product rules.**

- Logging a dose is one tap from the dashboard and never navigates away from it.

- The app never guesses that a dose was given. Absence of a log means not given.

- Stock is only ever changed by the user. Logging a dose does **not** draw down stock — most

  medications here are drops and suspensions that cannot be counted reliably per dose.

- Nothing is ever auto-deleted. Skipped and missed doses stay in history.

- Doses are stored and displayed exactly as entered `0.4 ml`, `50 mg`). No unit conversion,

  no rounding, no normalising.

---

## 2. Domain model

```

Pet

  id            uuid

  name          string, required, unique per household

  species       enum: rabbit | guinea_pig | cat | dog | other

  birthdate     date, optional         → age is derived, never stored

  weightGrams   int, optional

  tint          int 1–4, assigned on create in round-robin order, immutable

  archived      bool, default false

Medication                      (a thing you own / buy)

  id            uuid

  name          string, required      e.g. "Metacam"

  strength      string, optional      e.g. "0.5 mg/ml"

  form          enum: liquid | tablet | capsule | topical | injection | other

  unit          string               "ml" | "mg" | "tab" | "drop" | "application"

  packSize      decimal, optional    units per purchased pack (e.g. 15 ml bottle → 15)

  stockUnits    decimal, nullable    units on hand; user-maintained only, null = not set

  lowThreshold  decimal, optional    manual override of the low-stock rule (§7)

Course                          (one pet taking one medication on one schedule)

  id            uuid

  petId, medicationId

  doseAmount    decimal, required    e.g. 0.4

  doseUnit      string               inherited from medication, overridable

  instructions  string, optional     "after food"

  schedule      Schedule             see §3

  startDate     date, required

  endDate       date, optional       null = ongoing

  status        enum: active | paused | finished | stopped

  notes         string, optional

DoseEvent                       (the log; append-only)

  id            uuid

  courseId

  scheduledFor  datetime, nullable   null for interval courses before the first log

  status        enum: given | skipped | missed

  loggedAt      datetime             when the user recorded it

  givenAt       datetime             defaults to loggedAt; editable for back-dating

  amount        decimal              snapshot of doseAmount at log time

  note          string, optional

StockAdjustment                 (append-only ledger; never mutate stockUnits directly)

  id, medicationId, deltaUnits, reason (purchase | correction | waste), createdAt

```

**Derived, never stored:** age, next due time, overdue state, days of cover, shopping list.

---

## 3. Scheduling

Two schedule kinds. This distinction drives most of the app's logic and must be modelled

explicitly, not inferred.

### 3a. `fixedTimes`

```

{ kind: 'fixedTimes', times: ['08:00', '20:00'], daysOfWeek?: [1..7], everyNDays?: int }

```

- Occurrences are generated per calendar day at the given local times.

- `daysOfWeek` restricts to specific weekdays (weekly treatments: `[6]` = Saturday).

- `everyNDays` counts from `startDate` (e.g. every 3 days).

- A dose becomes **due** at its time and **overdue** after the grace window (§4).

- Missing a dose does not shift later doses.

### 3b. `fromLastDose`

```

{ kind: 'fromLastDose', intervalHours: 4 | 6 | 8 | 12 | 24 | int, anchorTime?: 'HH:MM' }

```

- The next due time is `lastGivenAt + intervalHours`, recomputed on every log.

- Before the first `given` event, nothing is due; the course shows "not started" with a

  **Start course** action that logs the first dose at the current time.

- Displayed times are real clock times including minutes `14:10`), and every rendered detail

  line carries the phrase **"from last dose"**.

- Logging a dose early or late shifts the whole chain. This is intended — do not "correct" it.

- `anchorTime` is optional and only used to seed the first occurrence if the user prefers.

### 3c. Course lifecycle

- `paused` suppresses occurrence generation without deleting history. Resuming a

  `fromLastDose` course restarts the chain from the resume moment.

- A course with an `endDate` auto-transitions to `finished` after the last occurrence.

- `stopped` is a user action (medication discontinued); it sets `endDate = today`.

- Editing a schedule never rewrites past DoseEvents.

### 3d. Day boundary and time zone

- All scheduling is in the device's local time zone. Store timestamps in UTC, render local.

- "Today" runs 00:00–23:59 local. A dose scheduled at 23:00 and logged at 00:20 belongs to the

  day it was **scheduled for**, not the day it was logged.

- On DST shifts, `fixedTimes` keeps the wall-clock time; `fromLastDose` keeps the elapsed

  interval.

---

## 4. Dose states

Computed per occurrence, in this precedence order:

| State | Condition | Presentation |

| --- | --- | --- |

| `given` | a `given` DoseEvent exists for the occurrence | 55% opacity, strikethrough, time logged |

| `skipped` | a `skipped` DoseEvent exists | 55% opacity, "Skipped" in place of the time |

| `overdue` | due time + grace has passed, no event | berry; card header tinted |

| `due` | within [due − 30 min, due + grace] | filled terracotta **Give** |

| `later` | due time is in the future today | outlined **Give** |

| `upcoming` | due after today | not shown on the dashboard |

- **Grace window:** 60 minutes for `fixedTimes`, 90 minutes for `fromLastDose`. Configurable

  per course later; hard-coded constants in v1.

- A `fixedTimes` occurrence more than 12 hours past due, with no event, is written as a

  `missed` DoseEvent by a daily sweep so history is complete.

- The user can always log a past dose with a corrected `givenAt` ("log it late").

---

## 5. Screens

Structure and layout are already built in `ui_kits/petmeds-app/`. Behaviour follows.

### 5.1 Today (default screen)

- Header: "Good morning / afternoon / evening" (cut at 12:00 and 18:00) with a factual

  subtitle: `N doses left today · M overdue` (drop the second clause when M = 0).

- Overdue banner when M &gt; 0: count, plus the single earliest overdue dose, and a **Log**

  action that logs exactly that dose.

- One card per pet, ordered: pets with overdue doses → pets with pending doses (earliest next

  due first) → pets fully done (collapsed, greyed).

- Card body lists that pet's **pending** doses only; given doses are reflected in the

  `X of Y today` counter.

- **Give** logs the dose at the current time. The row animates to its given state in place.

  The tap must not navigate. Undo is available for 5 seconds via a toast.

- Long-press (or the row's overflow) opens: *Log at a different time*, *Skip this dose*,

  *Open course*.

- Tapping the card body (not a button) opens the Pet detail screen.

- Below the list: a dashed "coming up" row for the next notable event within 7 days (a course

  ending, a weekly treatment).

- Empty state: "Nothing due today." plus the next due time.

### 5.2 Pets

- Roster of non-archived pets: avatar, name, species, age, and badges for active courses.

- Tap opens Pet detail. Header **+** opens Add medication with no pet preselected.

- Empty state: "No pets yet" with an **Add a pet** action.

### 5.3 Pet detail

- Identity block: avatar, name, species · age · weight.

- **Schedule** — today's occurrences with their states, read-only.

- **Courses** — every active/paused course: name, dose, schedule summary

  `2× daily · 08:00, 20:00` or `every 8h · from last dose`), and progress

  `day 3 of 7` or `ongoing`). Tap opens course edit: pause, resume, stop, edit schedule.

- **Recent** — the last 10 DoseEvents, newest first, with time and status.

- Actions: **Add medication**, and in an overflow: edit pet, archive pet.

### 5.4 Supplies

- Sort switch: **By urgency** (default) / **By pet**.

- **Buy now** group: every medication whose projected cover runs out inside the horizon

  (§7), each with stock on hand, a coverage meter, the run-out date and the quantity needed.

- **Stocked** group: everything else, with weeks of cover.

- **Add to list** toggles a medication onto the shopping list.

- Bottom bar: **Shopping list · N items** → a plain, shareable list (name, quantity needed,

  which pets), copyable as text.

- **Update stock** flow: for each medication, set units on hand or add a purchased pack.

  Writes a `StockAdjustment`, never a direct edit. This is the only thing that changes stock.

- For drops and suspensions, allow a coarse figure instead of a number — `full`, `about half`,

  `nearly out`, `empty` — stored as a fraction of `packSize`. Precision here is false comfort.

### 5.5 Add / edit medication

Single form, in this order:

1. **For** — pet picker (avatars). Required.

2. **Medication** — free text with autocomplete over existing medications. Picking an existing

   one reuses its stock; typing a new name creates one.

3. **Dose** — amount + unit ("0.4" + "ml"), and optional instructions ("after food").

4. **How it is scheduled** — `From last dose` / `At set times`.

5. **Interval** (4/6/8/12/24h) or **How often** (once daily, 2×, 3×, weekly) plus the times.

6. **For how long** — 7 days / 14 days / Ongoing / custom end date.

7. **Reminders** — for fixed times, the notification times; for interval courses, an

   explanation that the next dose is counted from the moment one is logged.

8. **Save medication** (full-width ink bar).

Validation: pet, medication name, dose amount and schedule are required. Everything else

optional. Saving an interval course does not create a due dose until the first log.

### 5.6 Add / edit pet

Name (required), species, birthdate, weight. Tint is assigned automatically.

---

## 6. Notifications

- Local notifications only in v1 (Web Notifications API + service worker; degrade silently

  where unsupported).

- `fixedTimes`: one notification per occurrence, at the scheduled time.

- `fromLastDose`: one notification when `lastGivenAt + intervalHours` is reached.

- One re-alert after the grace window, then stop. Never more than two per dose.

- Notification copy is factual: "Clover · Metacam 0.4 ml due now".

- Actions on the notification: **Give**, **Snooze 30 min**.

---

## 7. Supply projection

For each medication:

```

dailyUse   = Σ over active courses using it of (doses per day × doseAmount)

             fromLastDose courses count as 24 / intervalHours doses per day

remaining  = stockUnits

daysOfCover= remaining / dailyUse            (∞ when dailyUse = 0)

runOutDate = today + daysOfCover

needed     = max(0, dailyUse × horizonDays − remaining)   rounded up to whole packs

```

- **Horizon:** 30 days, or the course end date when it is sooner.

- **Tone:** `out` when daysOfCover ≤ 3, `low` when ≤ 10, otherwise `good`. `lowThreshold`

  on the medication overrides the numeric thresholds.

- The coverage meter shows `min(100, daysOfCover / horizonDays × 100)`.

- **Stock is never decremented automatically.** `stockUnits` changes only through an explicit

  user action in *Update stock*, recorded as a `StockAdjustment`. Logging, skipping or missing

  a dose has no effect on stock.

- Because stock is user-maintained, treat it as an estimate: `daysOfCover` is a projection

  from the schedule, and the run-out date is only as good as the last stock update.

- Prompt for a stock update, without blocking anything, when a medication's projected cover

  has run out but no `StockAdjustment` has been recorded in the last 14 days:

  "Still have Metacam? Update stock." Never guess on the user's behalf.

- Stock may be left at zero or unknown; a medication with no stock figure shows

  "Stock not set" and is excluded from the Buy now group rather than reported as empty.

---

## 8. Data, persistence, sync

- Local-first. IndexedDB is the source of truth; the UI must work fully offline.

- Append-only tables `DoseEvent`, `StockAdjustment`) are never updated in place; corrections

  are new rows referencing the original.

- Every entity carries `createdAt` / `updatedAt` and a `deletedAt` soft-delete.

- Export/import the whole household as a single JSON file (v1 backup story).

- Design for a later server sync: stable UUIDs generated client-side, last-write-wins per

  entity, and no logic that depends on server-assigned ids.

---

## 9. Non-functional requirements

- **Mobile-first**, 360–430px design width; usable one-handed. Every tap target ≥ 44px.

- Cold start to an interactive Today screen under 1.5s on a mid-range phone.

- Installable PWA: manifest, icons, offline shell.

- Accessibility: every control has an accessible name; state is never colour-only (the

  overdue card carries the word "Overdue", not just a berry tint); respects

  `prefers-reduced-motion` by dropping the press-scale and cross-fade.

- No analytics or third-party tracking in v1.

- Time-dependent logic must be injectable (a `now()` provider) so it is testable.

---

## 10. Suggested work slices

Each slice is independently assignable and ends in something testable.

1. **Foundations** — project scaffold, design tokens wired from `styles.css`, the component

   library from `components/`, routing shell with the three-tab navigation.

2. **Data layer** — schema, IndexedDB repositories, append-only ledgers, the `now()` provider,

   JSON export/import.

3. **Scheduling engine** — occurrence generation for both schedule kinds, state computation

   (§4), the daily missed-dose sweep. Pure functions, heavily unit-tested; no UI.

4. **Pets &amp; courses CRUD** — Add/edit pet, Add/edit medication, course lifecycle

   (pause/resume/stop), Pet detail.

5. **Today screen** — card ordering, one-tap logging with undo, late/skip flows, banner,

   empty state.

6. **Supplies** — projection maths (§7), the two groups, stock updates, shopping list, share.

7. **Notifications** — service worker, scheduling for both kinds, notification actions.

8. **PWA &amp; polish** — install manifest, offline shell, reduced-motion, accessibility audit.

**Slice contracts.** Slice 3 exposes `getOccurrences(date)` and `getDoseState(occurrence, now)`

and owns all time logic; slices 5 and 7 consume it and must not reimplement it. Slice 2 owns

every write; no other slice touches IndexedDB directly.

---

## 11. Test cases worth writing first

- A `fromLastDose` course logged 90 minutes late moves the next due time by 90 minutes.

- A `fixedTimes` course logged late does **not** move the following dose.

- A dose scheduled 23:00 and logged 00:20 counts against the previous day.

- Pausing a course removes it from Today but leaves its history intact.

- Logging then undoing a dose leaves history exactly as before, and never touches stock.

- Logging any number of doses leaves `stockUnits` unchanged.

- Two pets sharing one medication both draw down the same stock.

- A medication with only weekly courses reports weeks, not days, of cover.

- Nothing is due for an interval course that has never been started.

