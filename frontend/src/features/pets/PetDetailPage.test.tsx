import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import { cloneFixtures, FIXTURE_NOW, fixtures, localDayKey, type DoseEvent } from "@/domain";
import { courseProgress, describeSchedule } from "@/engine";
import { DoseRow } from "@/components/ds";
import { ageLabel } from "./age";
import { doseRowPropsFor } from "./doseRow";
import { courseLabel, joinMeta, speciesLabel, weightLabel } from "./format";
import { PetDetailView } from "./PetDetailPage";

const TODAY = localDayKey(new Date(FIXTURE_NOW));

function clover() {
  return fixtures.pets.find((p) => p.name === "Clover")!;
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
      speciesLabel(pet.species),
      ageLabel(pet.birthdate, TODAY),
      weightLabel(pet.weightGrams),
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
    const expectedMeta = joinMeta([speciesLabel(pet.species), null, weightLabel(pet.weightGrams)]);
    const metaEl = screen.getByText(expectedMeta);
    expect(metaEl.textContent).not.toMatch(/·\s*·/);
    expect(metaEl.textContent?.trim().startsWith("·")).toBe(false);
    expect(metaEl.textContent?.trim().endsWith("·")).toBe(false);
  });

  it("renders the Schedule card read-only, with the occurrence count trailing the label", async () => {
    const pet = clover();
    renderWithProviders(<PetDetailView petId={pet.id} />);

    // Clover has one active fixedTimes course with two configured times
    // (08:00, 20:00) and one active fromLastDose course (which the stub
    // `getOccurrences` never generates occurrences for) — two occurrences today.
    expect(await screen.findByText("2 today")).toBeInTheDocument();
    const giveButtons = screen.getAllByText("Give");
    expect(giveButtons).toHaveLength(2);
    // The Courses section below wraps each card `role="button"` for
    // navigation; the Schedule rows must not be nested inside one of those —
    // proof that this page added no click handler of its own to a row.
    giveButtons.forEach((btn) => {
      expect(btn.closest('[role="button"]')).toBeNull();
    });
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
      const label = courseLabel(medication.name, course.doseAmount, course.doseUnit);
      // The medication label also appears in the Schedule section's rows
      // above, so scope the rest of the assertion to this course's own
      // card — found via the `aria-label` the page gives it for navigation.
      const card = screen.getByRole("button", { name: `Open ${label}` });
      expect(within(card).getByText(label)).toBeInTheDocument();
      expect(within(card).getByText(describeSchedule(course.schedule))).toBeInTheDocument();
      expect(within(card).getByText(courseProgress(course, TODAY))).toBeInTheDocument();
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

    // Clover's three dose events, newest `loggedAt` first: Metacam given
    // (Aug 7 18:58), Metoclopramide given (Aug 6 22:00), Metacam skipped
    // (Aug 6 07:05) — see fixtures.ts.
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Metacam");
    expect(rows[0].textContent).not.toContain("Skipped");
    expect(rows[2].textContent).toContain("Metacam");
    expect(rows[2].textContent).toContain("Skipped");
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

  it("archives the pet via the overflow menu, leaving its courses and dose history untouched", async () => {
    const pet = clover();
    const { repo } = renderWithProviders(<PetDetailView petId={pet.id} />);
    const user = userEvent.setup();

    await screen.findByText(pet.name);

    const beforeCourses = await repo.listCourses({ petId: pet.id });
    const courseIds = beforeCourses.map((c) => c.id);
    const beforeEvents = await repo.listDoseEvents({ courseIds });

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Archive pet" }));

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
});
