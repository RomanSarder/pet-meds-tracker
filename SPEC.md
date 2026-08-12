# Pet Meds — functional specification

Implementation brief for a mobile-first web app that tracks medication for a small household

of pets. Written to be handed to independent agents: each section is self-contained, and

§11 slices the work.

Design source of truth: the Pet Meds design system [`readme.md`](http://readme.md), `styles.css`, `tokens/`,

`components/`, `ui_kits/petmeds-app/`). Do not invent visual decisions — every colour, size and

copy convention is already specified there.

Screens designed after the original UI kit live as separate files and are equally binding:

| Screen | File |

| --- | --- |

| Pet history (§6.4) | `Pet History.dc.html` |

| Household, Join a household, Your name (§6.5) | `Household.dc.html` |

---

## 1. Scope

**In scope (v1).** Pets, medication courses, a daily dashboard, logging a dose, a per-pet

event log, a supply/shopping view, a shared household several people can join, and a fully

localized interface in Ukrainian and English.

**Out of scope (v1).** Vet appointments, weight tracking, photos, belonging to more than one

household at a time, per-pet (rather than whole-household) sharing, roles and permissions,

dose calculators, medical advice.

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

Household

  id            uuid

  name          string, optional     defaults to "Home"

  createdAt     datetime

User

  id            uuid

  householdId

  email         string               from magic-link auth; never displayed

  displayName   string, required     set by the user, shown against every action they take

  tint          int 1-4              same palette as pets, assigned on join

  isSelf        bool                 local flag; exactly one per device

  joinedAt      datetime

JoinCode

  id            uuid

  householdId

  code          string               6 chars, uppercase, no O/0/I/1

  createdBy     userId

  expiresAt     datetime             24 h from issue

  usedBy        userId, nullable     single use

  revokedAt     datetime, nullable

Pet

  id            uuid

  householdId

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

  lowThreshold  decimal, optional    manual override of the low-stock rule (§8)

Course                          (one pet taking one medication on one schedule)

  id            uuid

  petId, medicationId

  doseAmount    decimal, required    e.g. 0.4

  doseUnit      string               inherited from medication, overridable

  instructions  string, optional     "after food"

  schedule      Schedule             see §3 — carries the optional maxPerDay (§3b-i)

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

  actorId       userId               who logged it; never null once sharing is on

  givenAt       datetime             defaults to loggedAt; editable for back-dating

  amount        decimal              snapshot of doseAmount at log time

  note          string, optional

  overMax       boolean, default false   set only when logged past a course's maxPerDay (§3b-i)

StockAdjustment                 (append-only ledger; never mutate stockUnits directly)

  id, medicationId, deltaUnits, reason (purchase | correction | waste), actorId, createdAt

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

{ kind: 'fromLastDose', intervalHours: 4 | 6 | 8 | 12 | 24 | int, anchorTime?: 'HH:MM',

  maxPerDay?: int }

```

- The next due time is `lastGivenAt + intervalHours`, recomputed on every log.

- Before the first `given` event, nothing is due; the course shows "not started" with a

  **Start course** action that logs the first dose at the current time.

- Displayed times are real clock times including minutes `14:10`), and every rendered detail

  line carries the phrase **"from last dose"**.

- Logging a dose early or late shifts the whole chain. This is intended — do not "correct" it.

- **An outstanding interval dose never expires.** The chain re-anchors only on a `given` event,

  so a dose that goes unlogged stays due — it keeps appearing, reading `overdue`, on every day

  after its due day until it is given or skipped. It must not stop being generated at the end of

  its own day: that would take the course off Today with nothing to give and no way back, and

  the pet would read as done for the day. Once resolved it stops — a `given` event re-anchors

  the chain onto a new occurrence, and a `skipped` one ends that occurrence where it stands.

- `anchorTime` is optional and only used to seed the first occurrence if the user prefers.

### 3b-i. `maxPerDay` — an optional daily ceiling on an interval course

**`maxPerDay` is optional and unset by default.** A course without it behaves exactly as §3b

describes, with no cap logic anywhere in the pipeline; most courses will never carry one. Treat

the field as absent-or-integer — never default it to a number, and never infer one from the

interval. Everything in this section applies **only** when the user has explicitly set a value.

**Builder checklist for the unset case** — when `maxPerDay` is `null`/absent:

- No `capped` state is ever computed; the §4 precedence table runs unchanged.

- No pill renders on the dose row (`DoseRow`'s `cap` prop is simply not passed).

- The supply forecast uses `24 / intervalHours` doses per day, with no `min()`.

- Notifications follow §3b with no cap suppression.

- No `overMax` flag can ever appear on a DoseEvent for that course.

The common prescription "every 8 hours, maximum 3 per day" is an interval **and** a cap: the

interval sets the earliest the next dose may be given, the cap sets how many the day may hold.

With an 8 h interval a slipping chain can fit four doses into a calendar day, which the cap

exists to prevent. When the user does set one:

- `maxPerDay` counts `given` DoseEvents whose `givenAt` falls in the local calendar day (§3d),

  for that course only. `skipped` and `missed` events do not count.

- While `givenToday < maxPerDay`, scheduling is exactly §3b.

- On reaching the cap the course is **capped** for the rest of the day: no occurrence is due,

  the chain does not advance, and the next dose is due at `00:00 tomorrow + interval` from the

  last dose — whichever is later.

- **The cap warns, it does not lock.** A capped dose row keeps a ghost **Give anyway** action;

  using it writes a normal `given` event flagged `overMax`, which reads "over the daily maximum"

  in history. A carer told by a vet to give a fourth dose must not be blocked by the app, and a

  silent block would be logged as nothing at all — worse than a recorded exception.

- A capped dose is never counted as `overdue`, and never raises the overdue banner.

- `maxPerDay` is offered for `fromLastDose` only. A `fixedTimes` course already states its

  count by listing its times, so a cap there would be a second source of truth.

- Removing the cap later (setting it back to `No maximum`) takes effect immediately and never

  rewrites past events: a dose already flagged `overMax` keeps that flag in history.

### 3c. Course lifecycle

- `paused` suppresses occurrence generation without deleting history. Resuming a

  `fromLastDose` course restarts the chain from the resume moment.

- A course with an `endDate` auto-transitions to `finished` after the last occurrence.

- `stopped` is a user action (medication discontinued); it sets `endDate = today`.

- Editing a schedule never rewrites past DoseEvents.

- **An edit takes effect immediately, including on the day it is made.** A `fixedTimes` slot

  whose time has already passed today still moves to its new time, and a slot the edit removes

  still disappears — the carer sees what they just saved, not tomorrow.

- **The one exception is history.** A slot that already carries a live DoseEvent (`given` or

  `skipped`) keeps its old time for the rest of that day, and is still shown even if the edit

  makes the day itself ineligible under `daysOfWeek`/`everyNDays`. That is the whole purpose of

  the forward-only rule: an edit must never orphan a dose someone already logged. It is not a

  reason to freeze slots that carry nothing.

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

| `capped` | course **has** `maxPerDay` set and `givenToday >= maxPerDay` | amber `N of M max` pill on the detail line, ghost **Give anyway** (§3b-i) |

| `overdue` | due time + grace has passed, no event | berry; card header tinted |

Every dose row carries a quiet **per-medication day count** pill on its detail line —
`N of M doses`, where M is that course's own scheduled occurrences for the day, so "how many
times have I given Metacam?" is answerable without opening history. When a course has
`maxPerDay` set, the `N of M max` pill replaces it rather than sitting beside it: two count
pills on one row is one number too many.

**Three nested day counts appear on Today, and their wording must keep them apart:**

| Scope | Where | Wording |

| --- | --- | --- |

| One medication | dose row pill | `N of M doses` — never "today" |

| One pet | pet card header | `N of M today` |

| The household | day progress under the header | `N of M given today` (§6.1) |

Each denominator must be derivable from what is on screen: a row's M counts that course's
occurrences for the day, and a pet card's M counts that pet's occurrences. Do not compute a
denominator from a course definition the list does not render — a pill claiming an occurrence
the user cannot see is worse than no pill.

| `due` | within [due − 30 min, due + grace] | filled terracotta **Give** |

| `later` | due time is in the future today | outlined **Give** |

| `upcoming` | due after today | not shown on the dashboard |

- **Grace window:** 60 minutes for `fixedTimes`, 90 minutes for `fromLastDose`. Configurable

  per course later; hard-coded constants in v1.

- A `fixedTimes` occurrence more than 12 hours past due, with no event, is written as a

  `missed` DoseEvent by a daily sweep so history is complete.

- The user can always log a past dose with a corrected `givenAt` ("log it late", §6.1a).

- **Scope of a corrected `givenAt`: the last 24 hours only.** The picker offers no date field and

  no Today/Yesterday toggle; `givenAt` is constrained to `[now − 24 h, now]`. A dose remembered

  more than 24 hours ago is corrected from history instead. Rationale: nearly every late entry is

  recent ("I gave it an hour ago and forgot to tap"); a date control would tax all of those

  to serve a rare case.

---

## 5. Sharing a household

Everything belongs to one household; a user belongs to exactly one household at a time.

**Permissions: none.** Every member has identical rights — add pets, edit courses, log doses,

update stock, invite others. There is no owner and no read-only role. The safeguard is not

permission but attribution: every write records `actorId`, and the event log shows it.

**Identity and display name.** Authentication is magic link, so the only identity the auth

layer supplies is an email address. An email is never shown in the UI — "clover.mum@…" on a dose

row is noise, and it leaks an address to everyone in the household.

`displayName` is therefore captured explicitly, exactly once, at the first moment the app needs

a name to attribute anything to:

- **Creating a household** — after the magic link is confirmed, a one-field first-run screen:

  "What should we call you?", pre-filled with the local part of the email as an editable

  suggestion `roman@…` → "Roman"). Skippable only if the user has no household yet and is

  alone; the name is required before the first invite is issued.

- **Joining a household** — the **Your name** field sits directly above the code entry on the

  join screen, with the same email-derived suggestion and the helper "Shown against every dose

  you log. You can change it later."

Rules: 1–24 characters, required, need not be unique — two people called Ilya are the

household's problem, not the app's. Editable at any time from Household → your row → **Edit**.

Renaming updates every past event's rendering, because history stores `actorId`, not a name

string. If a user is somehow persisted without a name, render "Someone" rather than an email.

**Joining.**

1. A member opens Household → the app issues a `JoinCode`: six uppercase characters, ambiguous

   glyphs excluded (no O/0, no I/1), valid 24 hours, single use.

2. The other person installs the app, signs in with a magic link, sets their display name, and

   enters the code.

3. Before joining, they are shown what they are about to get access to (the pet list). Joining

   is confirmed explicitly, not on the last keystroke.

4. The code is consumed. Only one code is live per household at a time; issuing a new one

   revokes the previous.

**Leaving and removing.** Any member can leave; any member can remove another. A removed or

departed user's `DoseEvent` rows keep their `actorId` and their name still renders in history —

history is never rewritten. A household cannot be left empty; the last member leaving deletes it

after an explicit confirmation.

**Attribution in the UI.** Who gave a dose is shown in two places and nowhere else:

- The event log, as a trailing "by Marta" on every dose and course event.

- A given dose row on Today, where the logged time becomes `7:12 · Marta`.

No avatars on the dashboard, no activity feed, no notifications when someone else logs. The

point is answering "has this already been given?", not watching each other.

**Conflicts.** Two people logging the same dose within the grace window produce one

`DoseEvent`. Re-submitting the *identical* occurrence is a double-tap and is rejected

client-side with "Already given by Marta at 07:12" — that dose is already on record and the row

already says so. Elsewhere, last-write-wins per entity (§9) is sufficient.

**Nothing refuses a dose.** Every other guard on logging is a heuristic — a dose landing within

the grace window of a *different* occurrence, or within `EARLY_GIVE_FLOOR_MIN` of any dose on the

course — and a heuristic **asks**, showing what it collided with and offering to record the dose

anyway. This holds for every state a row can be in and every way to log one: Give, Skip, "log at

a different time", **Start course**. It is the same reasoning §3b-i's cap already follows: a

carer told by a vet to give another dose must be able to, and a dose the app refused is a dose

that got given and never recorded — strictly worse than a recorded exception.

**Sync.** Sharing requires a server, which makes §9's "design for a later server sync" a v1

requirement rather than a hedge: the local store stays the source of truth for reads, with a

background push/pull per household. The app must stay fully usable offline and reconcile on

reconnect.

## 6. Screens

Structure and layout are already built in `ui_kits/petmeds-app/`. Behaviour follows.

**Navigation.** The tab bar stays at three destinations — Today, Pets, Supplies. The screens

added for sharing and history are reached from within them, not by a fourth tab:

- **Pet history** — from Pet detail → **See all history** (§6.4).

- **Household** — from the Pets screen, a row below the roster reading "Household · 3 people"

  (§6.5). Sharing is a property of the household you already see, so it lives with the pets

  rather than behind a settings gear.

- **Join a household**, **first-run name** and **Your name** are modal full screens (§6.5, §6.9).

### 6.1 Today (default screen)

- Header: "Good morning / afternoon / evening" (cut at 12:00 and 18:00) with a factual

  subtitle: `N doses left today`, or `Everything given today` at zero. The overdue count moves

  to the day progress line below, so the header never repeats it.

- **Day progress**, directly under the header, is the glanceable answer to "how much of today is

  done": `<given> of <total> given today` set large and tabular, a trailing note (`M overdue`,

  else `next HH:MM`, else `all done`), and a segmented track of one pip per scheduled dose —

  sage for given, berry for the overdue remainder, hairline for the rest. Counts span all pets.

  Pips make the day countable rather than estimated; above 14 doses the track degrades to a

  continuous bar. Exactly one of these per screen — per-pet progress stays in the pet card's

  `N of M today` slot.

- Overdue banner when M &gt; 0: count, plus the single earliest overdue dose, and a **Log**

  action that logs exactly that dose.

- One card per pet, ordered: pets with overdue doses → pets with pending doses (earliest next

  due first) → pets fully done (collapsed, greyed).

- Card body lists that pet's **pending** doses only; given doses are reflected in the

  `X of Y today` counter.

- **Give** logs the dose at the current time. The row animates to its given state in place.

  The tap must not navigate. Undo is available for 5 seconds via a toast.

- Long-press (or the row's overflow, `⋯`) opens: *Log at a different time* (§6.1a),

  *Skip this dose*, *Open course*. The overflow is hidden once the dose is `given`.

- Tapping the card body (not a button) opens the Pet detail screen.

- Below the list: a dashed "coming up" row for the next notable event within 7 days (a course

  ending, a weekly treatment).

- Empty state: "Nothing due today." plus the next due time.

### 6.1a Log at a different time

A bottom sheet over Today, for a dose that was given before it was logged. It treats the entry

as a memory task rather than a clock task: the fast paths are "how long ago" and "at its

scheduled time", and an exact time is the fallback.

- Header: medication, pet, `scheduled HH:MM · <schedule summary>`, and a close control.

- The chosen time is the sheet's headline, set large and tabular, with `today · <N> ago`

  beside it. It turns berry if the value is in the future.

- **Relative offsets** as a chip row: *Just now*, *15 min*, *30 min*, *1 h*, *2 h*. One is

  selected on open; the default is 30 minutes ago.

- **At its scheduled time** as its own full-width row, showing the scheduled clock time, with

  the helper "Given on time, logged afterwards". This is the commonest case and must be one tap.

- **Or set it exactly**: a `− 5 min` / value / `+ 5 min` stepper. `+ 5 min` disables at `now`.

- A helper line under the stepper carries the active constraint: "A dose cannot be logged in the

  future." at the cap, a day-check warning more than 12 h before the scheduled time, otherwise

  "Anything from the last 24 h. Earlier doses are added from history."

- **Consequence block**, stated before committing, because the chain shift (§3b) is the one

  thing a corrected time actually changes:

  - `fromLastDose` — accent dot, "Next dose moves to HH:MM", and a line explaining that the

    course counts from the last dose so the whole chain follows the entered time, naming the

    delta against the planned time when there is one.

  - `fixedTimes` — quiet dashed treatment, "Next dose stays at HH:MM", and a note that history

    will read "Given N min late".

- Footer: full-width ink **Log at HH:MM**, disabled for a future time, above a ghost

  **Skip this dose instead** that hands off to the skip flow.

- Confirming writes a `given` DoseEvent with `givenAt` set to the chosen time (not `now`), and

  reschedules the course per §3b. Undo behaves as in §6.1.

### 6.2 Pets

- Roster of non-archived pets: avatar, name, species, age, and badges for active courses.

- Tap opens Pet detail. Header **+** opens Add medication with no pet preselected.

- Empty state: "No pets yet" with an **Add a pet** action.

### 6.3 Pet detail

- Identity block: avatar, name, species · age · weight.

- **Schedule** — today's occurrences with their states, read-only.

- **Courses** — every active/paused course: name, dose, schedule summary

  `2× daily · 08:00, 20:00` or `every 8h · from last dose`), and progress

  `day 3 of 7` or `ongoing`). Tap opens course edit: pause, resume, stop, edit schedule.

- **Recent** — the last 10 events, newest first, with time, status and who. **See all history**

  opens §6.4.

- Actions: **Add medication**, and in an overflow: edit pet, archive pet.

### 6.4 Pet history

The full event log for one pet. Its job is answering "has this already been given?", so it opens

on today and reads newest first.

- Filter chips: **All** / **Doses** / **Courses**.

- A summary strip: given, skipped and missed counts over the visible range.

- Events grouped by day, newest day first, with a section label per day ("Today · Sun 9 Aug").

- Each row: time (tabular), a status dot, the medication name, a factual detail line, and a

  trailing "by &lt;name&gt;".

- Status dots: green given, grey skipped, berry missed, terracotta course change.

- Detail lines state what actually happened, including deviations:

  "Given 40 min late · chain shifted", "Skipped · refused syringe", "Missed · scheduled 08:00",

  "Course started · 2× daily for 7 days", "Interval changed · every 12h to 2× daily".

- Paginate backwards with **Load earlier**; 30 days per page.

- Export the visible range as plain text or CSV for a vet.

**What is logged:** every DoseEvent (given, skipped, missed) and every course lifecycle change

(started, paused, resumed, stopped, schedule or dose edited). Stock updates and household joins

are recorded in the data but **not** shown here.

### 6.5 Household

- **People** — every member: name, and either "You · joined 12 Jun" or a light activity line

  ("Logged 4 doses this week"). Overflow on each other member: remove from household.

- **Invite** — the live join code as six large characters, its expiry and single-use status,

  **Copy code** and **New code** (which revokes the old one).

- A plain note that everyone has the same access and every action is recorded with a name.

- **Your name** — an **Edit** action on your own row opens a full screen: your avatar and join

  date, the name field with a 24-character counter, a live "how it will look" preview of a log

  row rendered with the new name, and a line naming the signed-in email with the reassurance

  that it is never shown to anyone. Confirmed with a full-width ink **Save name**. The helper

  text states that the change is retroactive, since history stores `actorId`.

- **Leave household** at the bottom, secondary styling, with a confirmation.

- **Join a household** is a separate entry screen: six code boxes, a preview of the pets being

  joined, and an explicit **Join household** confirm.

### 6.6 Supplies

- Sort switch: **By urgency** (default) / **By pet**.

- **Buy now** group: every medication whose projected cover runs out inside the horizon

  (§8), each with stock on hand, a coverage meter, the run-out date and the quantity needed.

- **Stocked** group: everything else, with weeks of cover.

- **Add to list** toggles a medication onto the shopping list.

- Bottom bar: **Shopping list · N items** → a plain, shareable list (name, quantity needed,

  which pets), copyable as text.

- **Update stock** flow: for each medication, set units on hand or add a purchased pack.

  Writes a `StockAdjustment`, never a direct edit. This is the only thing that changes stock.

- For drops and suspensions, allow a coarse figure instead of a number — `full`, `about half`,

  `nearly out`, `empty` — stored as a fraction of `packSize`. Precision here is false comfort.

### 6.7 Add / edit medication

Single form, in this order:

1. **For** — pet picker (avatars). Required.

2. **Medication** — free text with autocomplete over existing medications. Picking an existing

   one reuses its stock; typing a new name creates one.

3. **Dose** — amount + unit ("0.4" + "ml"), and optional instructions ("after food").

4. **How it is scheduled** — `From last dose` / `At set times`.

5. **Interval** (4/6/8/12/24h) or **How often** (once daily, 2×, 3×, weekly) plus the times.

5a. **Daily maximum** — interval courses only, and **optional**: `No maximum` / `2` / `3` /

   `4` / `5` / `6`, as chips under the interval. **`No maximum` is selected by default** — a cap is

   something the user opts into, never a value the app assumes on their behalf (§3b-i). Hidden

   entirely for `At set times`. The form is savable without touching this control.

6. **For how long** — 7 days / 14 days / Ongoing / custom end date.

7. **Reminders** — for fixed times, the notification times; for interval courses, an

   explanation that the next dose is counted from the moment one is logged, and — when a maximum

   is set — that nothing more is due after the cap but a dose can still be given and recorded.

8. **Save medication** (full-width ink bar).

Validation: pet, medication name, dose amount and schedule are required. Everything else

optional. Saving an interval course does not create a due dose until the first log.

### 6.8 Add / edit pet

Name (required), species, birthdate, weight. Tint is assigned automatically.

### 6.9 First run

After the magic link is confirmed and before anything else, one screen: **What should we call

you?**, a single name field pre-filled with the local part of the email, and two ways forward —

**Start a household** or **I have a join code** (which continues to §6.5's join screen).

No onboarding carousel, no permission prompts before they are needed.

---

## 7. Notifications

- Local notifications only in v1 (Web Notifications API + service worker; degrade silently

  where unsupported).

- `fixedTimes`: one notification per occurrence, at the scheduled time.

- `fromLastDose`: one notification when `lastGivenAt + intervalHours` is reached, unless the

  course is capped for the day (§3b-i) — a capped course notifies nothing until tomorrow.

- One re-alert after the grace window, then stop. Never more than two per dose.

- Notification copy is factual: "Clover · Metacam 0.4 ml due now".

- Actions on the notification: **Give**, **Snooze 30 min**.

---

## 8. Supply projection

For each medication:

```

dailyUse   = Σ over active courses using it of (doses per day × doseAmount)

             fromLastDose courses count as 24 / intervalHours doses per day,

             or min(24 / intervalHours, maxPerDay) when a maximum is set

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

## 9. Data, persistence, sync

- Local-first. IndexedDB is the source of truth; the UI must work fully offline.

- Append-only tables `DoseEvent`, `StockAdjustment`) are never updated in place; corrections

  are new rows referencing the original.

- Every entity carries `createdAt` / `updatedAt` and a `deletedAt` soft-delete.

- Export/import the whole household as a single JSON file (v1 backup story).

- Design for a later server sync: stable UUIDs generated client-side, last-write-wins per

  entity, and no logic that depends on server-assigned ids.

---

## 10. Non-functional requirements

- **Mobile-first**, 360–430px design width; usable one-handed. Every tap target ≥ 44px.

- Cold start to an interactive Today screen under 1.5s on a mid-range phone.

- Installable PWA: manifest, icons, offline shell.

- Accessibility: every control has an accessible name; state is never colour-only (the

  overdue card carries the word "Overdue", not just a berry tint); respects

  `prefers-reduced-motion` by dropping the press-scale and cross-fade.

- No analytics or third-party tracking in v1.

- Time-dependent logic must be injectable (a `now()` provider) so it is testable.

### 10a. Language and formatting

**Ukrainian is the default language. English is secondary.** A first-run user sees Ukrainian

without choosing it; English is available and switchable from Settings, and the choice persists

per device. Neither language is a machine translation of the other at runtime — both are

authored, and every string ships in both.

- **No user-facing string is hard-coded in a component.** Every one resolves through the

  translation layer, including validation messages, empty states, notification copy, accessible

  names, and text the user never sees rendered but a screen reader speaks.

- **The scheduling engine returns data, never prose.** `describeSchedule`, `courseProgress` and

  `summariseDay` currently emit finished English strings (`2× daily · 08:00, 20:00`,

  `day 3 of 7`). Under localization they must return structured values and the interface layer

  formats them. The engine stays pure and language-agnostic; §11's slice-3 contract is unchanged

  in spirit — it still owns all time logic, it just stops owning wording.

- **Pluralization is a rule, not a suffix.** Ukrainian has one/few/many forms where English has

  one/other, so counts (`N doses left today`, `Household · N people`, `1 animal`) must resolve

  through real plural rules per language. A string built by appending "s" is a defect in both

  languages.

- **Dates and weekday names localize. Times do not.** Times stay 24-hour with a leading zero

  (`08:00`, `14:10`) in both languages — §3b requires real clock times including minutes, and

  24-hour is already the Ukrainian norm. Dates follow the locale (`Wed 12 Aug` / `ср, 12 серп.`).

- **Dose amounts never localize.** §1 is absolute: doses are stored and displayed exactly as

  entered, with no conversion, rounding or normalising. A dose entered `0.4` renders `0.4` in

  Ukrainian too — the decimal separator is part of what the user typed, not a formatting choice.

  Unit strings (`ml`, `mg`, `tab`) are likewise entered by the user and are not translated.

- **Medication names, pet names and user-entered notes are never translated.** They are data.

- **Nothing is truncated to fit.** Ukrainian runs longer than English; a layout that only works

  at English width is not finished. The 360–430px constraint applies in both languages.

- The document language must be declared correctly for assistive technology, and must change

  when the user switches language.

---

## 11. Suggested work slices

Each slice is independently assignable and ends in something testable.

1. **Foundations** — project scaffold, design tokens wired from `styles.css`, the component

   library from `components/`, routing shell with the three-tab navigation.

2. **Data layer** — schema, IndexedDB repositories, append-only ledgers, the `now()` provider,

   JSON export/import.

3. **Scheduling engine** — occurrence generation for both schedule kinds, state computation

   (§4), the daily missed-dose sweep. Pure functions, heavily unit-tested; no UI.

4. **Pets &amp; courses CRUD** — Add/edit pet, Add/edit medication, course lifecycle

   (pause/resume/stop), Pet detail.

5. **Today screen** — card ordering, one-tap logging with undo, late/skip flows (§6.1a), banner,

   empty state.

6. **Supplies** — projection maths (§8), the two groups, stock updates, shopping list, share.

7. **Event log** — the per-pet history screen (§6.4): filters, day grouping, summary counts,

   backward pagination, text/CSV export. Depends on slices 2 and 3 only; no sharing needed.

8. **Identity &amp; household** — magic-link sign-in, first run and display name (§6.9), the

   household/user/join-code model, code issue and redemption, member list, leave and remove,

   and `actorId` stamped on every write.

9. **Sync** — background push/pull per household, offline reconciliation, the duplicate-dose

   guard (§5). Slice 8 must land first; the app is fully functional single-user without this.

10. **Notifications** — service worker, scheduling for both kinds, notification actions.

11. **PWA &amp; polish** — install manifest, offline shell, reduced-motion, accessibility audit.

12. **Localization** — the translation layer, Ukrainian and English message catalogues, plural

    rules, locale-aware dates, the language switch in Settings, and the engine refactor that

    moves wording out of `describeSchedule` / `courseProgress` / `summariseDay` (§10a). Touches

    every screen, so it lands last; every earlier slice must be merged first.

**Slice contracts.**

- Slice 3 exposes `getOccurrences(date)` and `getDoseState(occurrence, now)` and owns all time

  logic; slices 5, 7 and 10 consume it and must not reimplement it.

- Slice 2 owns every write; no other slice touches IndexedDB directly. It also exposes the

  current `actorId`, stubbed to a single local user until slice 8 lands, so nothing else needs

  to know whether sharing exists yet.

- Attribution renders through one helper `displayNameFor(actorId)`) returning "Someone" for an

  unknown id — so slices 5 and 7 can ship attribution before slice 8 exists.

---

## 12. Test cases worth writing first

- A `fromLastDose` course logged 90 minutes late moves the next due time by 90 minutes.

- A `fixedTimes` course logged late does **not** move the following dose.

- "At its scheduled time" writes `givenAt` equal to the occurrence's due time, so a

  `fromLastDose` chain stays on its planned grid and the event reads as on time.

- The corrected-time picker cannot produce a `givenAt` in the future or more than 24 hours in the past.

- A dose scheduled 23:00 and logged 00:20 counts against the previous day.

- Pausing a course removes it from Today but leaves its history intact.

- Logging then undoing a dose leaves history exactly as before, and never touches stock.

- Logging any number of doses leaves `stockUnits` unchanged.

- Two pets sharing one medication both draw down the same stock.

- A medication with only weekly courses reports weeks, not days, of cover.

- Nothing is due for an interval course that has never been started.

- An interval course with **no** maximum set behaves exactly as before: no pill, no `capped`

  state, and a fourth dose in one day is logged without comment.

- An `every 8h, max 3 per day` course logged at 06:00, 14:00 and 22:00 has nothing due at 06:00

  the next morning until the interval from 22:00 has also elapsed.

- **Give anyway** past the cap writes one `given` event flagged `overMax` and does not advance

  the chain past midnight.

- A capped course never appears in the overdue count or the overdue banner.

- Two members logging the same dose within the grace window produce exactly one DoseEvent.

- A removed member's name still renders on their historical events.

- Renaming a member updates their name on every past event.

- No email address is rendered anywhere in the UI.

- A join code cannot be redeemed twice, after expiry, or after a newer code was issued.

- The event log shows a course pause even though pausing produces no DoseEvent.

- Offline logs from two devices reconcile without duplicating or losing events.

- A first-run user with no stored preference sees Ukrainian.

- Switching language re-renders every screen and survives a reload.

- No user-facing string renders in the wrong language after a switch, including notification

  copy, validation messages and accessible names.

- A count renders with the correct Ukrainian plural form for 1, 2, 5 and 21.

- A dose entered as `0.4` renders as `0.4` in both languages, never `0,4`.

- Every screen holds its layout at 360px in Ukrainian with nothing truncated or overflowing.

