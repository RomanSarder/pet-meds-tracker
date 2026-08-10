import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { useRouterState } from "@tanstack/react-router";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import {
  cloneFixtures,
  FIXTURE_NOW,
  fixtures,
  localDayKey,
  occurrenceKeyFor,
  type Course,
  type DoseEvent,
} from "@/domain";
import { courseProgress, describeSchedule } from "@/engine";
import { renderCourseProgress, renderSchedule } from "@/i18n/schedule";
import { createTranslator } from "@/i18n";
import { DoseRow } from "@/components/ds";
import { ageLabel } from "./age";
import { doseRowPropsFor } from "./doseRow";
import { courseLabel, joinMeta, speciesLabel, weightLabel } from "./format";
import { PetDetailView } from "./PetDetailPage";

const TODAY = localDayKey(new Date(FIXTURE_NOW));
const enTr = createTranslator("en");

function clover() {
  return fixtures.pets.find((p) => p.name === "Clover")!;
}

function biscuit() {
  return fixtures.pets.find((p) => p.name === "Biscuit")!;
}

describe("PetDetailView", () => {
  // The router underlying `renderWithProviders` resolves its first match
  // asynchronously (see renderWithProviders.test.tsx), so the first query in
  // every test below is a `findBy*`, not a `getBy*`.

  it("shows the pet's name and a species · age · weight meta line", async () => {
    const pet = clover();
    renderWithProviders(<PetDetailView petId={pet.id} />);

    expect(await screen.findByText(pet.name)).toBeInTheDocument();
    const expectedMeta = joinMeta([
      speciesLabel(pet.species, enTr),
      ageLabel(pet.birthdate, TODAY, enTr),
      weightLabel(pet.weightGrams, enTr),
    ]);
    expect(screen.getByText(expectedMeta)).toBeInTheDocument();
  });

  it("drops the age clause without a doubled or dangling separator when birthdate is null", async () => {
    const custom = cloneFixtures();
    const pet = custom.pets.find((p) => p.name === "Clover")!;
    pet.birthdate = null;
    const repo = createMemoryRepo(custom);

    renderWithProviders(<PetDetailView petId={pet.id} />, { repo });

    expect(await screen.findByText(pet.name)).toBeInTheDocument();
    const expectedMeta = joinMeta([speciesLabel(pet.species, enTr), null, weightLabel(pet.weightGrams, enTr)]);
    const metaEl = screen.getByText(expectedMeta);
    expect(metaEl.textContent).not.toMatch(/·\s*·/);
    expect(metaEl.textContent?.trim().startsWith("·")).toBe(false);
    expect(metaEl.textContent?.trim().endsWith("·")).toBe(false);
  });

  it("renders the Schedule card read-only, with the occurrence count trailing the label", async () => {
    const pet = clover();
    renderWithProviders(<PetDetailView petId={pet.id} />);

    // Clover has one active fixedTimes course with two configured times
    // (08:00, 20:00, "due" and "later" respectively at FIXTURE_NOW) and one
    // active fromLastDose course whose next due falls on a different day —
    // two occurrences today, neither with a matching DoseEvent.
    const scheduleLabel = await screen.findByText("Schedule");
    expect(await screen.findByText("2 today")).toBeInTheDocument();
    const scheduleCard = scheduleLabel.closest("div")!.nextElementSibling as HTMLElement;

    // SPEC §5.3: the Schedule block is read-only — no "Give" text, and no
    // interactive control of any kind, even though both occurrences here are
    // actionable states (due/later) that the DS `DoseRow` would otherwise
    // render with a clickable "Give" button.
    expect(within(scheduleCard).queryByText("Give")).not.toBeInTheDocument();
    expect(scheduleCard.querySelector("button")).toBeNull();
    expect(scheduleCard.querySelector("[role='button']")).toBeNull();

    // "due" and "later" show their due time as plain text (SPEC §4).
    expect(within(scheduleCard).getByText("08:00")).toBeInTheDocument();
    expect(within(scheduleCard).getByText("20:00")).toBeInTheDocument();
  });

  it("renders every dose state in the Schedule block as read-only text, with no interactive control anywhere in it", async () => {
    // Builds one occurrence of each of the six states Pet detail can show
    // today (given, skipped, overdue, due, later, notStarted) on top of
    // Clover's existing fixture courses, so a single render proves the whole
    // block — not just one state at a time — never contains a button. A
    // text-only assertion would not have caught the original defect (the DS
    // `DoseRow` always renders a real `<button>`, regardless of its label),
    // so this test also asserts on `querySelectorAll("button")` directly.
    const custom = cloneFixtures();
    const pet = custom.pets.find((p) => p.name === "Clover")!;
    const medicationId = custom.medications[0].id;

    function course(id: string, schedule: Course["schedule"]): Course {
      return {
        id,
        petId: pet.id,
        medicationId,
        doseAmount: 1,
        doseUnit: "ml",
        instructions: null,
        schedule,
        startDate: "2026-08-01",
        endDate: null,
        status: "active",
        notes: null,
        resumedAt: null,
        createdAt: "2026-08-01T08:00:00.000Z",
        updatedAt: "2026-08-01T08:00:00.000Z",
        deletedAt: null,
      };
    }

    const givenCourseId = "test-course-given";
    const skippedCourseId = "test-course-skipped";
    const overdueCourseId = "test-course-overdue";
    const notStartedCourseId = "test-course-not-started";

    // FIXTURE_NOW is 2026-08-08T07:00:00.000Z = 08:00 BST.
    const givenScheduledFor = "2026-08-08T05:00:00.000Z"; // 06:00 BST
    const skippedScheduledFor = "2026-08-08T05:30:00.000Z"; // 06:30 BST

    custom.courses = [
      // Clover's existing Metacam course (08:00/20:00 fixedTimes, no event
      // today) already supplies "due" and "later" — reused as-is.
      ...custom.courses,
      course(givenCourseId, { kind: "fixedTimes", times: ["06:00"] }),
      course(skippedCourseId, { kind: "fixedTimes", times: ["06:30"] }),
      // 04:00 BST: more than the 60-minute fixedTimes grace window before
      // FIXTURE_NOW (08:00 BST), with no DoseEvent — "overdue".
      course(overdueCourseId, { kind: "fixedTimes", times: ["04:00"] }),
      course(notStartedCourseId, { kind: "fromLastDose", intervalHours: 8 }),
    ];

    function event(courseId: string, scheduledFor: string, status: DoseEvent["status"]): DoseEvent {
      return {
        id: `test-event-${courseId}`,
        courseId,
        scheduledFor,
        status,
        loggedAt: scheduledFor,
        givenAt: scheduledFor,
        amount: 1,
        note: null,
        occurrenceKey: occurrenceKeyFor(courseId, scheduledFor),
        supersedesId: null,
        actorId: "test-actor-id",
        createdAt: scheduledFor,
        updatedAt: scheduledFor,
        deletedAt: null,
      };
    }

    custom.doseEvents = [
      ...custom.doseEvents,
      event(givenCourseId, givenScheduledFor, "given"),
      event(skippedCourseId, skippedScheduledFor, "skipped"),
    ];

    const repo = createMemoryRepo(custom);
    renderWithProviders(<PetDetailView petId={pet.id} />, { repo });

    const scheduleLabel = await screen.findByText("Schedule");
    const scheduleCard = scheduleLabel.closest("div")!.nextElementSibling as HTMLElement;
    await waitFor(() => expect(within(scheduleCard).getByText("Not started")).toBeInTheDocument());

    // Not a single interactive control anywhere in the block, across every state.
    expect(scheduleCard.querySelectorAll("button")).toHaveLength(0);
    expect(scheduleCard.querySelectorAll("[role='button']")).toHaveLength(0);
    expect(within(scheduleCard).queryByText("Give")).not.toBeInTheDocument();

    // given: 55% opacity, strikethrough, its LOGGED time as text (SPEC §4:
    // "the logged time" — `doseRow.ts` now reads `occurrence.event.givenAt`,
    // not `occurrence.dueAt`; this fixture's `givenAt` equals `scheduledFor`
    // 06:00, so the rendered value is unchanged even though its source is).
    const givenTime = within(scheduleCard).getByText("06:00");
    const givenRow = givenTime.closest("div")!.parentElement as HTMLElement;
    expect(givenRow.style.opacity).toBe("0.55");
    const givenName = within(givenRow).getByText(/Metacam/);
    expect(givenName.style.textDecoration).toBe("line-through");

    // skipped: 55% opacity, "Skipped" in place of the time, no strikethrough.
    const skippedText = within(scheduleCard).getByText("Skipped");
    const skippedRow = skippedText.closest("div")!.parentElement as HTMLElement;
    expect(skippedRow.style.opacity).toBe("0.55");
    const skippedName = within(skippedRow).getByText(/Metacam/);
    expect(skippedName.style.textDecoration).not.toBe("line-through");

    // overdue: carries the literal word "Overdue" — not colour alone (SPEC §9).
    expect(within(scheduleCard).getByText("Overdue")).toBeInTheDocument();

    // due / later: their due time as plain text.
    expect(within(scheduleCard).getByText("08:00")).toBeInTheDocument();
    expect(within(scheduleCard).getByText("20:00")).toBeInTheDocument();

    // notStarted: literal "Not started" text.
    expect(within(scheduleCard).getByText("Not started")).toBeInTheDocument();
  });

  // Deliberate Ukrainian coverage of SPEC §4/§9's three dose-state words this
  // screen renders as literal text (never colour alone): "Прострочено"
  // (Overdue — via ScheduleRow.tsx's own `pets.schedule.overdue` lookup,
  // never doseRow.ts), "Пропущено" (Skipped) and "Не розпочато" (Not
  // started). A lighter fixture than the English six-state test above:
  // just the three states this wave has not pinned in Ukrainian anywhere
  // else in the suite.
  it("renders Overdue, Skipped and Not started as literal Ukrainian words in the read-only Schedule block", async () => {
    const custom = cloneFixtures();
    const pet = custom.pets.find((p) => p.name === "Clover")!;
    const medicationId = custom.medications[0].id;

    function course(id: string, schedule: Course["schedule"]): Course {
      return {
        id,
        petId: pet.id,
        medicationId,
        doseAmount: 1,
        doseUnit: "ml",
        instructions: null,
        schedule,
        startDate: "2026-08-01",
        endDate: null,
        status: "active",
        notes: null,
        resumedAt: null,
        createdAt: "2026-08-01T08:00:00.000Z",
        updatedAt: "2026-08-01T08:00:00.000Z",
        deletedAt: null,
      };
    }

    const skippedCourseId = "test-course-uk-skipped";
    const overdueCourseId = "test-course-uk-overdue";
    const notStartedCourseId = "test-course-uk-not-started";
    const skippedScheduledFor = "2026-08-08T05:30:00.000Z"; // 06:30 BST

    custom.courses = [
      course(skippedCourseId, { kind: "fixedTimes", times: ["06:30"] }),
      // 04:00 BST: more than the 60-minute fixedTimes grace window before
      // FIXTURE_NOW (08:00 BST), with no DoseEvent — "overdue".
      course(overdueCourseId, { kind: "fixedTimes", times: ["04:00"] }),
      course(notStartedCourseId, { kind: "fromLastDose", intervalHours: 8 }),
    ];
    custom.doseEvents = [
      ...custom.doseEvents,
      {
        id: `test-event-${skippedCourseId}`,
        courseId: skippedCourseId,
        scheduledFor: skippedScheduledFor,
        status: "skipped",
        loggedAt: skippedScheduledFor,
        givenAt: skippedScheduledFor,
        amount: 1,
        note: null,
        occurrenceKey: occurrenceKeyFor(skippedCourseId, skippedScheduledFor),
        supersedesId: null,
        actorId: "test-actor-id",
        createdAt: skippedScheduledFor,
        updatedAt: skippedScheduledFor,
        deletedAt: null,
      },
    ];

    const repo = createMemoryRepo(custom);
    renderWithProviders(<PetDetailView petId={pet.id} />, { repo, locale: "uk" });

    const scheduleLabel = await screen.findByText("Розклад");
    const scheduleCard = scheduleLabel.closest("div")!.nextElementSibling as HTMLElement;

    await waitFor(() => expect(within(scheduleCard).getByText("Прострочено")).toBeInTheDocument());
    expect(within(scheduleCard).getByText("Пропущено")).toBeInTheDocument();
    expect(within(scheduleCard).getByText("Не розпочато")).toBeInTheDocument();
    // No English state word left in the block.
    expect(within(scheduleCard).queryByText("Overdue")).not.toBeInTheDocument();
    expect(within(scheduleCard).queryByText("Skipped")).not.toBeInTheDocument();
    expect(within(scheduleCard).queryByText("Not started")).not.toBeInTheDocument();
  });

  // Fix 4b (SPEC §4 "the logged time") + the DEFECT 4 investigation: a dose
  // given late must show when it was actually given, and — because
  // `struckThrough`/`overdue` derive from one shared `state` in
  // `ScheduleRow.tsx` — a `given` row can never carry "Прострочено" once the
  // courses/events queries have settled (Fix 4a rules out the pre-data-flash
  // that made it look like it briefly could).
  it("shows a dose given late with its LOGGED time trailing (not the scheduled time), still struck through, and never the word Прострочено", async () => {
    const custom = cloneFixtures();
    const pet = custom.pets.find((p) => p.name === "Clover")!;
    const medicationId = custom.medications[0].id; // "Metacam"

    const lateCourseId = "test-course-uk-given-late";
    const scheduledFor = "2026-08-08T07:00:00.000Z"; // 08:00 BST, today
    const givenAt = "2026-08-08T15:25:00.000Z"; // 16:25 BST — ~8h25m late

    custom.courses = [
      ...custom.courses,
      {
        id: lateCourseId,
        petId: pet.id,
        medicationId,
        doseAmount: 0.5,
        doseUnit: "ml",
        instructions: null,
        schedule: { kind: "fixedTimes", times: ["08:00"] },
        startDate: "2026-08-01",
        endDate: null,
        status: "active",
        notes: null,
        resumedAt: null,
        createdAt: "2026-08-01T08:00:00.000Z",
        updatedAt: "2026-08-01T08:00:00.000Z",
        deletedAt: null,
      },
    ];
    custom.doseEvents = [
      ...custom.doseEvents,
      {
        id: `test-event-${lateCourseId}`,
        courseId: lateCourseId,
        scheduledFor,
        status: "given",
        loggedAt: givenAt,
        givenAt,
        amount: 0.5,
        note: null,
        occurrenceKey: occurrenceKeyFor(lateCourseId, scheduledFor),
        supersedesId: null,
        actorId: "test-actor-id",
        createdAt: givenAt,
        updatedAt: givenAt,
        deletedAt: null,
      },
    ];

    const repo = createMemoryRepo(custom);
    renderWithProviders(<PetDetailView petId={pet.id} />, { repo, locale: "uk" });

    const scheduleLabel = await screen.findByText("Розклад");
    const scheduleCard = scheduleLabel.closest("div")!.nextElementSibling as HTMLElement;

    // SPEC §4: trailing slot is the LOGGED time (16:25), not the scheduled
    // one (08:00) — `formatHHMM(occurrence.event.givenAt)`, not
    // `formatHHMM(occurrence.dueAt)`.
    const loggedTime = await within(scheduleCard).findByText("16:25");
    const row = loggedTime.closest("div")!.parentElement as HTMLElement;
    expect(row.style.opacity).toBe("0.55");
    const medicationName = within(row).getByText(/Metacam/);
    expect(medicationName.style.textDecoration).toBe("line-through");

    // The pre-data-flash defect this investigation ruled out: once settled,
    // this given-late row must never carry "Прострочено" — struckThrough and
    // overdue are structurally mutually exclusive in `ScheduleRow.tsx`.
    expect(within(scheduleCard).queryByText("Прострочено")).not.toBeInTheDocument();
  });

  it("shows a never-started fromLastDose course as read-only 'Not started' text, with no button of any label", async () => {
    // COURSE_BISCUIT_METOCLOPRAMIDE (fixtures.ts) is fromLastDose with no
    // `given` DoseEvent at all, so `getDoseState` reports "notStarted" for
    // it (SPEC §3b) every day it's requested. Pet detail's Schedule block
    // is read-only (SPEC §5.3); the "Start course" action SPEC §3b wants
    // belongs to Today, which already owns it — so this row must show
    // neither the DS `DoseRow`'s hard-coded "Give" nor a duplicate "Start
    // course" button, only plain text.
    const pet = biscuit();
    renderWithProviders(<PetDetailView petId={pet.id} />);

    const scheduleLabel = await screen.findByText("Schedule");
    const scheduleCard = scheduleLabel.closest("div")!.nextElementSibling as HTMLElement;

    // Biscuit's other occurrence today (Ivermectin) is already given, so no
    // "Give"/"Start course" text — nor any `<button>` at all — should appear
    // anywhere in the Schedule card.
    expect(within(scheduleCard).queryByText("Give")).not.toBeInTheDocument();
    expect(within(scheduleCard).queryByText("Start course")).not.toBeInTheDocument();
    expect(scheduleCard.querySelector("button")).toBeNull();

    const notStartedText = within(scheduleCard).getByText("Not started");
    expect(notStartedText).toBeInTheDocument();
  });

  it("renders the skipped state as 55% opacity with 'Skipped' in place of the clock time", () => {
    // Deliberately NOT routed through `getDoseState` — it is a stub on this
    // branch that always returns "upcoming". `doseRowPropsFor` is exercised
    // directly with state: "skipped" instead.
    const props = doseRowPropsFor({
      occurrence: {
        key: "course-1|2026-08-08T07:00:00.000Z",
        courseId: "course-1",
        petId: clover().id,
        medicationId: "med-1",
        kind: "fixedTimes",
        day: TODAY,
        dueAt: new Date("2026-08-08T07:00:00.000Z"),
        graceMinutes: 60,
        doseAmount: 0.4,
        doseUnit: "ml",
        instructions: null,
        event: null,
      },
      state: "skipped",
      medicationName: "Metacam",
      instructions: null,
      progress: "Day 2 of 7",
      tr: enTr,
    });

    const { container } = render(<DoseRow {...props} />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.style.opacity).toBe("0.55");
    expect(screen.getByText("Skipped")).toBeInTheDocument();
  });

  it("renders each active/paused course with its medication, schedule and progress", async () => {
    const pet = clover();
    renderWithProviders(<PetDetailView petId={pet.id} />);

    expect(await screen.findByText("Courses")).toBeInTheDocument();
    const cloverCourses = fixtures.courses.filter(
      (c) => c.petId === pet.id && (c.status === "active" || c.status === "paused"),
    );
    expect(cloverCourses.length).toBeGreaterThan(0);
    for (const course of cloverCourses) {
      const medication = fixtures.medications.find((m) => m.id === course.medicationId)!;
      const label = courseLabel(medication.name, course.doseAmount, course.doseUnit, enTr);
      // The medication label also appears in the Schedule section's rows
      // above, so scope the rest of the assertion to this course's own
      // card — found via the `aria-label` the page gives it for navigation.
      const card = screen.getByRole("button", { name: `Open ${label}` });
      expect(within(card).getByText(label)).toBeInTheDocument();
      expect(within(card).getByText(renderSchedule(describeSchedule(course.schedule), enTr))).toBeInTheDocument();
      expect(within(card).getByText(renderCourseProgress(courseProgress(course, TODAY), enTr))).toBeInTheDocument();
    }
  });

  it("marks a paused course with the word 'Paused'", async () => {
    const custom = cloneFixtures();
    const pet = custom.pets.find((p) => p.name === "Clover")!;
    const course = custom.courses.find((c) => c.petId === pet.id && c.schedule.kind === "fromLastDose")!;
    course.status = "paused";
    const repo = createMemoryRepo(custom);

    renderWithProviders(<PetDetailView petId={pet.id} />, { repo });

    expect(await screen.findByText("Paused")).toBeInTheDocument();
  });

  it("shows Recent events newest first, marking a non-given event with its status word", async () => {
    const pet = clover();
    renderWithProviders(<PetDetailView petId={pet.id} />);

    const recentLabel = await screen.findByText("Recent");
    const recentCard = recentLabel.closest("div")!.nextElementSibling as HTMLElement;
    const rows = Array.from(recentCard.children) as HTMLElement[];

    // Recent now renders the same widened event-log model History (§6.4)
    // uses (SPEC §6.3), so Clover's three dose events are joined by each of
    // her two active courses' own "started" lifecycle entry. Newest `at`
    // first: Metacam given (Aug 7 19:00), Metoclopramide given (Aug 6 22:00),
    // Metacam course started (Aug 6 08:00), Metacam skipped (Aug 6 07:00),
    // Metoclopramide course started (Aug 1 08:00) — see fixtures.ts.
    expect(rows).toHaveLength(5);
    expect(rows[0].textContent).toContain("Metacam");
    expect(rows[0].textContent).not.toContain("Skipped");
    expect(rows[3].textContent).toContain("Metacam");
    expect(rows[3].textContent).toContain("Skipped");
  });

  it("caps the Recent list at 10 events", async () => {
    const custom = cloneFixtures();
    const pet = custom.pets.find((p) => p.name === "Clover")!;
    const metacamCourse = custom.courses.find(
      (c) => c.petId === pet.id && c.schedule.kind === "fixedTimes",
    )!;

    const extra: DoseEvent[] = [];
    for (let i = 0; i < 12; i += 1) {
      const loggedAt = new Date(Date.UTC(2026, 6, 1, 8, i, 0)).toISOString();
      extra.push({
        id: `extra-${i}`,
        courseId: metacamCourse.id,
        scheduledFor: null,
        status: "given",
        loggedAt,
        givenAt: loggedAt,
        amount: metacamCourse.doseAmount,
        note: null,
        occurrenceKey: `${metacamCourse.id}|extra-${i}`,
        supersedesId: null,
        actorId: "test-actor-id",
        createdAt: loggedAt,
        updatedAt: loggedAt,
        deletedAt: null,
      });
    }
    custom.doseEvents.push(...extra);
    const repo = createMemoryRepo(custom);

    renderWithProviders(<PetDetailView petId={pet.id} />, { repo });

    const recentLabel = await screen.findByText("Recent");
    const recentCard = recentLabel.closest("div")!.nextElementSibling as HTMLElement;
    expect(recentCard.children).toHaveLength(10);
  });

  it("shows who logged each Recent event, resolved through displayNameFor rather than a raw id", async () => {
    const pet = clover();
    renderWithProviders(<PetDetailView petId={pet.id} />);

    const recentLabel = await screen.findByText("Recent");
    const recentCard = recentLabel.closest("div")!.nextElementSibling as HTMLElement;

    // Every one of Clover's Recent entries is attributed to Roman (fixtures.ts).
    const roman = fixtures.users.find((u) => u.displayName === "Roman")!;
    const rows = Array.from(recentCard.children) as HTMLElement[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.textContent).toContain(`by ${roman.displayName}`);
    }
  });

  it("shows a course pause in Recent even though pausing writes no DoseEvent", async () => {
    const custom = cloneFixtures();
    const pet = custom.pets.find((p) => p.name === "Clover")!;
    const course = custom.courses.find(
      (c) => c.petId === pet.id && c.schedule.kind === "fixedTimes",
    )!;
    const repo = createMemoryRepo(custom);
    const eventsBeforePause = await repo.listDoseEvents({ courseIds: [course.id] });
    // Seeded through the repo's real write path (CONTRACT.md §3.1), so the
    // resulting CourseEvent is exactly what production writes on a pause.
    await repo.setCourseStatus(course.id, "paused");

    renderWithProviders(<PetDetailView petId={pet.id} />, { repo });

    const recentLabel = await screen.findByText("Recent");
    const recentCard = recentLabel.closest("div")!.nextElementSibling as HTMLElement;
    expect(await within(recentCard).findByText(/Course paused/)).toBeInTheDocument();

    // The pause itself never wrote a DoseEvent.
    const eventsAfterPause = await repo.listDoseEvents({ courseIds: [course.id] });
    expect(eventsAfterPause).toHaveLength(eventsBeforePause.length);
  });

  it("offers a 'See all history' affordance that navigates to the pet's history route", async () => {
    function LocationProbe() {
      const pathname = useRouterState({ select: (s) => s.location.pathname });
      return <span data-testid="pathname">{pathname}</span>;
    }

    const pet = clover();
    // The harness router has no `/pets/$petId/history` route (see
    // renderWithProviders.tsx), so navigation intent is witnessed the same
    // way TodayPage.test.tsx does it: a `LocationProbe` mounted alongside the
    // page under test, reading `useRouterState` rather than the DOM, since the
    // catch-all route keeps the page itself mounted regardless of the path.
    renderWithProviders(
      <>
        <PetDetailView petId={pet.id} />
        <LocationProbe />
      </>,
    );
    const user = userEvent.setup();

    await screen.findByText(pet.name);
    const link = screen.getByRole("button", { name: "See all history" });
    await user.click(link);

    expect(screen.getByTestId("pathname")).toHaveTextContent(`/pets/${pet.id}/history`);
  });

  it("archives the pet via the overflow menu, leaving its courses and dose history untouched", async () => {
    const pet = clover();
    const { repo } = renderWithProviders(<PetDetailView petId={pet.id} />);
    const user = userEvent.setup();

    await screen.findByText(pet.name);

    const beforeCourses = await repo.listCourses({ petId: pet.id });
    const courseIds = beforeCourses.map((c) => c.id);
    const beforeEvents = await repo.listDoseEvents({ courseIds });

    // The menu is a Base UI `Menu` (portalled), so its items mount
    // asynchronously after the trigger click — `findByRole`, not `getByRole`.
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive pet" }));

    await waitFor(async () => {
      const pets = await repo.listPets();
      expect(pets.find((p) => p.id === pet.id)).toBeUndefined();
    });

    const archivedPets = await repo.listPets({ includeArchived: true });
    expect(archivedPets.find((p) => p.id === pet.id)?.archived).toBe(true);

    const afterCourses = await repo.listCourses({ petId: pet.id });
    expect(afterCourses).toHaveLength(beforeCourses.length);

    const afterEvents = await repo.listDoseEvents({ courseIds });
    expect(afterEvents).toHaveLength(beforeEvents.length);
  });

  it("closes the overflow menu on Escape and returns focus to its trigger (accessibility fix — was inescapable by keyboard)", async () => {
    const pet = clover();
    renderWithProviders(<PetDetailView petId={pet.id} />);
    const user = userEvent.setup();
    await screen.findByText(pet.name);

    const trigger = screen.getByRole("button", { name: "More actions" });
    await user.click(trigger);
    await screen.findByRole("menuitem", { name: "Edit pet" });

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("dismisses the overflow menu on a click outside it", async () => {
    const pet = clover();
    renderWithProviders(<PetDetailView petId={pet.id} />);
    const user = userEvent.setup();
    await screen.findByText(pet.name);

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await screen.findByRole("menuitem", { name: "Edit pet" });

    await user.click(screen.getByText(pet.name));

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("gives the back button an accessible name", async () => {
    const pet = clover();
    renderWithProviders(<PetDetailView petId={pet.id} />);
    await screen.findByText(pet.name);

    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });
});
