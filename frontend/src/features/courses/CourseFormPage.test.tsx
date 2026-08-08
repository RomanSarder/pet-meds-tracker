import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { fixtures } from "@/domain";
import { getOccurrences, type EngineContext } from "@/engine";
import { createMemoryRepo } from "@/data";
import { CourseFormView } from "./CourseFormPage";

// Fixture ids are not exported from domain/fixtures.ts (only the `fixtures`
// object is), so — same convention as engine.test.ts — every id used below is
// derived by finding the matching row, not imported as a constant.
const CLOVER = fixtures.pets.find((p) => p.name === "Clover")!;
const METACAM = fixtures.medications.find((m) => m.name === "Metacam")!;
/** startDate 2026-08-06, endDate 2026-08-12, fixedTimes 08:00/20:00, status active. */
const COURSE_CLOVER_METACAM = fixtures.courses.find(
  (c) => c.petId === CLOVER.id && c.medicationId === METACAM.id,
)!;
const TODAY = "2026-08-08"; // local day of FIXTURE_NOW (08:00 BST)

type User = ReturnType<typeof userEvent.setup>;

function renderCreateForm(initialPetId?: string) {
  return renderWithProviders(<CourseFormView initialPetId={initialPetId} />);
}

async function selectPet(user: User, name: string) {
  const button = screen.getByText(name).closest("button");
  if (!button) throw new Error(`pet button for "${name}" not found`);
  await user.click(button);
}

async function typeMedication(user: User, name: string) {
  await user.type(screen.getByLabelText("Medication"), name);
}

async function typeDose(user: User, amount: string, unit: string) {
  await user.type(screen.getByLabelText("Dose amount"), amount);
  await user.type(screen.getByLabelText("Unit"), unit);
}

async function clickChip(user: User, label: string) {
  await user.click(screen.getByRole("button", { name: label }));
}

async function clickSave(user: User) {
  await user.click(screen.getByRole("button", { name: "Save medication" }));
}

describe("saving a course of each schedule kind persists the exact Schedule object", () => {
  it("fromLastDose: Every 4h", async () => {
    const { repo } = renderCreateForm();
    const user = userEvent.setup();
    await screen.findByText("Clover");
    await selectPet(user, "Clover");
    await typeMedication(user, "Kind Test FromLastDose");
    await typeDose(user, "0.4", "ml");
    await clickChip(user, "Every 4h");
    await clickSave(user);

    const created = await waitFor(async () => {
      const courses = await repo.listCourses({ petId: CLOVER.id });
      const match = courses.find((c) => c.doseAmount === 0.4 && c.schedule.kind === "fromLastDose");
      expect(match).toBeDefined();
      return match!;
    });
    expect(created.schedule).toEqual({ kind: "fromLastDose", intervalHours: 4 });
  });

  it("fixedTimes: Once daily", async () => {
    const { repo } = renderCreateForm();
    const user = userEvent.setup();
    await screen.findByText("Clover");
    await selectPet(user, "Clover");
    await typeMedication(user, "Kind Test Once");
    await typeDose(user, "1", "tab");
    await clickChip(user, "At set times");
    await clickChip(user, "Once daily");
    await clickSave(user);

    const created = await waitFor(async () => {
      const courses = await repo.listCourses({ petId: CLOVER.id });
      const match = courses.find((c) => c.doseAmount === 1 && c.doseUnit === "tab");
      expect(match).toBeDefined();
      return match!;
    });
    expect(created.schedule).toEqual({ kind: "fixedTimes", times: ["09:00"] });
  });

  it("fixedTimes: 2x daily (the kit's own default)", async () => {
    const { repo } = renderCreateForm();
    const user = userEvent.setup();
    await screen.findByText("Clover");
    await selectPet(user, "Clover");
    await typeMedication(user, "Kind Test Twice");
    await typeDose(user, "2", "tab");
    await clickChip(user, "At set times");
    await clickSave(user);

    const created = await waitFor(async () => {
      const courses = await repo.listCourses({ petId: CLOVER.id });
      const match = courses.find((c) => c.doseAmount === 2 && c.doseUnit === "tab");
      expect(match).toBeDefined();
      return match!;
    });
    expect(created.schedule).toEqual({ kind: "fixedTimes", times: ["08:00", "20:00"] });
  });

  it("fixedTimes: 3x daily", async () => {
    const { repo } = renderCreateForm();
    const user = userEvent.setup();
    await screen.findByText("Clover");
    await selectPet(user, "Clover");
    await typeMedication(user, "Kind Test Thrice");
    await typeDose(user, "3", "tab");
    await clickChip(user, "At set times");
    await clickChip(user, "3× daily");
    await clickSave(user);

    const created = await waitFor(async () => {
      const courses = await repo.listCourses({ petId: CLOVER.id });
      const match = courses.find((c) => c.doseAmount === 3 && c.doseUnit === "tab");
      expect(match).toBeDefined();
      return match!;
    });
    expect(created.schedule).toEqual({ kind: "fixedTimes", times: ["08:00", "14:00", "20:00"] });
  });

  it("Weekly: fixedTimes 08:00 with daysOfWeek [6] (ISO Saturday, not JS getDay's Friday)", async () => {
    const { repo } = renderCreateForm();
    const user = userEvent.setup();
    await screen.findByText("Clover");
    await selectPet(user, "Clover");
    await typeMedication(user, "Kind Test Weekly");
    await typeDose(user, "4", "tab");
    await clickChip(user, "At set times");
    await clickChip(user, "Weekly");
    await clickSave(user);

    const created = await waitFor(async () => {
      const courses = await repo.listCourses({ petId: CLOVER.id });
      const match = courses.find((c) => c.doseAmount === 4 && c.doseUnit === "tab");
      expect(match).toBeDefined();
      return match!;
    });
    expect(created.schedule).toEqual({ kind: "fixedTimes", times: ["08:00"], daysOfWeek: [6] });
    expect(Object.keys(created.schedule)).not.toContain("anchorTime");
    expect(Object.keys(created.schedule)).not.toContain("everyNDays");
  });
});

describe("medication name reuse", () => {
  it("typing an existing medication name reuses that medication rather than duplicating it", async () => {
    const { repo } = renderCreateForm();
    const user = userEvent.setup();
    await screen.findByText("Clover");
    await selectPet(user, "Clover");
    await typeMedication(user, "Metacam");
    await typeDose(user, "0.6", "ml");
    await clickSave(user);

    const created = await waitFor(async () => {
      const courses = await repo.listCourses({ petId: CLOVER.id });
      const match = courses.find((c) => c.doseAmount === 0.6);
      expect(match).toBeDefined();
      return match!;
    });

    const metacams = (await repo.listMedications()).filter((m) => m.name === "Metacam");
    expect(metacams).toHaveLength(1);
    expect(created.medicationId).toBe(METACAM.id);
  });

  it("typing a genuinely new medication name creates exactly one new medication", async () => {
    const { repo } = renderCreateForm();
    const user = userEvent.setup();
    const before = await repo.listMedications();
    await screen.findByText("Clover");
    await selectPet(user, "Clover");
    await typeMedication(user, "Zzzoletril Brand New");
    await typeDose(user, "1", "tab");
    await clickSave(user);

    await waitFor(async () => {
      const after = await repo.listMedications();
      expect(after.length).toBe(before.length + 1);
    });
    const after = await repo.listMedications();
    expect(after.find((m) => m.name === "Zzzoletril Brand New")).toBeDefined();
  });
});

describe("validation blocks save", () => {
  it("no pet selected -> 'Choose a pet', no course created", async () => {
    const { repo } = renderCreateForm();
    const user = userEvent.setup();
    const before = await repo.listCourses();
    await screen.findByText("Clover");
    await typeMedication(user, "Something");
    await typeDose(user, "1", "ml");
    await clickSave(user);

    expect(await screen.findByText("Choose a pet")).toBeInTheDocument();
    expect(await repo.listCourses()).toHaveLength(before.length);
  });

  it("empty medication name -> 'Enter a medication name', no course created", async () => {
    const { repo } = renderCreateForm();
    const user = userEvent.setup();
    const before = await repo.listCourses();
    await screen.findByText("Clover");
    await selectPet(user, "Clover");
    await typeDose(user, "1", "ml");
    await clickSave(user);

    expect(await screen.findByText("Enter a medication name")).toBeInTheDocument();
    expect(await repo.listCourses()).toHaveLength(before.length);
  });

  it("empty dose amount -> 'Enter a dose amount', no course created", async () => {
    const { repo } = renderCreateForm();
    const user = userEvent.setup();
    const before = await repo.listCourses();
    await screen.findByText("Clover");
    await selectPet(user, "Clover");
    await typeMedication(user, "Something");
    await user.type(screen.getByLabelText("Unit"), "ml");
    await clickSave(user);

    expect(await screen.findByText("Enter a dose amount")).toBeInTheDocument();
    expect(await repo.listCourses()).toHaveLength(before.length);
  });

  it("Custom duration with no end date -> 'Pick an end date', no course created", async () => {
    const { repo } = renderCreateForm();
    const user = userEvent.setup();
    const before = await repo.listCourses();
    await screen.findByText("Clover");
    await selectPet(user, "Clover");
    await typeMedication(user, "Something");
    await typeDose(user, "1", "ml");
    await clickChip(user, "Custom");
    await clickSave(user);

    expect(await screen.findByText("Pick an end date")).toBeInTheDocument();
    expect(await repo.listCourses()).toHaveLength(before.length);
  });

  // SPEC §5.5 also lists a missing schedule as a validation case, but both
  // chip groups always carry a default (fromLastDose "Every 8h" is this
  // component's initial mode; fixedTimes "2× daily" is the default once
  // "At set times" is chosen) — so a schedule is always present and that
  // validation branch can never fire. Rather than add an artificial
  // "no schedule" state to make it reachable, this test pins the two
  // defaults that make it unreachable.
  it("a schedule is always present, so save is never blocked on a missing one", async () => {
    // No chip group touched: the initial mode is "From last dose", so the
    // persisted schedule is the Every 8h fromLastDose default.
    const first = renderCreateForm();
    const user1 = userEvent.setup();
    await screen.findByText("Clover");
    await selectPet(user1, "Clover");
    await typeMedication(user1, "Default Schedule From Last Dose");
    await typeDose(user1, "1", "ml");
    await clickSave(user1);
    const createdA = await waitFor(async () => {
      const courses = await first.repo.listCourses({ petId: CLOVER.id });
      const match = courses.find((c) => c.medicationId !== METACAM.id && c.doseAmount === 1);
      expect(match).toBeDefined();
      return match!;
    });
    expect(createdA.schedule).toEqual({ kind: "fromLastDose", intervalHours: 8 });
    first.unmount();

    // Mode switched to "At set times" but the frequency chips left
    // untouched: the persisted schedule is the 2× daily fixedTimes default.
    const second = renderCreateForm();
    const user2 = userEvent.setup();
    await screen.findByText("Clover");
    await selectPet(user2, "Clover");
    await typeMedication(user2, "Default Schedule Fixed Times");
    await typeDose(user2, "1", "ml");
    await clickChip(user2, "At set times");
    await clickSave(user2);
    const createdB = await waitFor(async () => {
      const courses = await second.repo.listCourses({ petId: CLOVER.id });
      const match = courses.find((c) => c.medicationId !== METACAM.id && c.doseAmount === 1);
      expect(match).toBeDefined();
      return match!;
    });
    expect(createdB.schedule).toEqual({ kind: "fixedTimes", times: ["08:00", "20:00"] });
  });
});

describe("endDate persists per duration choice", () => {
  it("7 days from the fixture day stores 2026-08-14", async () => {
    const { repo } = renderCreateForm();
    const user = userEvent.setup();
    await screen.findByText("Clover");
    await selectPet(user, "Clover");
    await typeMedication(user, "Duration Test 7d");
    await typeDose(user, "1", "ml");
    // "7 days" is already the default duration choice.
    await clickSave(user);

    const created = await waitFor(async () => {
      const courses = await repo.listCourses({ petId: CLOVER.id });
      const match = courses.find((c) => c.doseAmount === 1);
      expect(match).toBeDefined();
      return match!;
    });
    expect(created.startDate).toBe(TODAY);
    expect(created.endDate).toBe("2026-08-14");
  });

  it("Ongoing stores null", async () => {
    const { repo } = renderCreateForm();
    const user = userEvent.setup();
    await screen.findByText("Clover");
    await selectPet(user, "Clover");
    await typeMedication(user, "Duration Test Ongoing");
    await typeDose(user, "2", "ml");
    await clickChip(user, "Ongoing");
    await clickSave(user);

    const created = await waitFor(async () => {
      const courses = await repo.listCourses({ petId: CLOVER.id });
      const match = courses.find((c) => c.doseAmount === 2);
      expect(match).toBeDefined();
      return match!;
    });
    expect(created.endDate).toBeNull();
  });
});

describe("SPEC §11 case 4 — pausing", () => {
  it("suppresses new occurrences for the paused course without touching its dose history", async () => {
    const { repo } = renderWithProviders(<CourseFormView courseId={COURSE_CLOVER_METACAM.id} />);
    const user = userEvent.setup();

    async function ctx(): Promise<EngineContext> {
      return { courses: await repo.listCourses(), events: await repo.listDoseEvents({}) };
    }

    const before = getOccurrences(TODAY, await ctx());
    const pausedCourseBefore = before.filter((o) => o.courseId === COURSE_CLOVER_METACAM.id);
    const otherBefore = before.filter((o) => o.courseId !== COURSE_CLOVER_METACAM.id);
    expect(pausedCourseBefore.length).toBeGreaterThan(0);
    expect(otherBefore.length).toBeGreaterThan(0);

    const eventsBefore = await repo.listDoseEvents({ courseId: COURSE_CLOVER_METACAM.id });

    await screen.findByRole("button", { name: "Pause" });
    await user.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(async () => {
      const updated = await repo.getCourse(COURSE_CLOVER_METACAM.id);
      expect(updated?.status).toBe("paused");
    });

    const after = getOccurrences(TODAY, await ctx());
    const pausedCourseAfter = after.filter((o) => o.courseId === COURSE_CLOVER_METACAM.id);
    const otherAfter = after.filter((o) => o.courseId !== COURSE_CLOVER_METACAM.id);
    expect(pausedCourseAfter).toHaveLength(0);
    expect(otherAfter.map((o) => o.key).sort()).toEqual(otherBefore.map((o) => o.key).sort());

    const eventsAfter = await repo.listDoseEvents({ courseId: COURSE_CLOVER_METACAM.id });
    expect(eventsAfter).toHaveLength(eventsBefore.length);
    expect(eventsAfter.map((e) => e.id).sort()).toEqual(eventsBefore.map((e) => e.id).sort());
  });
});

describe("course lifecycle: resume and stop", () => {
  it("Resume sets status: active and a non-null resumedAt; the call site passes only {id, status}", async () => {
    const repo = createMemoryRepo();
    await repo.setCourseStatus(COURSE_CLOVER_METACAM.id, "paused");
    const spy = vi.spyOn(repo, "setCourseStatus");
    renderWithProviders(<CourseFormView courseId={COURSE_CLOVER_METACAM.id} />, { repo });
    const user = userEvent.setup();

    await screen.findByRole("button", { name: "Resume" });
    await user.click(screen.getByRole("button", { name: "Resume" }));

    await waitFor(async () => {
      const updated = await repo.getCourse(COURSE_CLOVER_METACAM.id);
      expect(updated?.status).toBe("active");
    });
    const updated = await repo.getCourse(COURSE_CLOVER_METACAM.id);
    expect(updated?.resumedAt).not.toBeNull();
    expect(spy).toHaveBeenCalledWith(COURSE_CLOVER_METACAM.id, "active");
  });

  it("Stop sets status: stopped; the call site passes only {id, status}", async () => {
    const repo = createMemoryRepo();
    const spy = vi.spyOn(repo, "setCourseStatus");
    renderWithProviders(<CourseFormView courseId={COURSE_CLOVER_METACAM.id} />, { repo });
    const user = userEvent.setup();

    await screen.findByRole("button", { name: "Stop" });
    await user.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(async () => {
      const updated = await repo.getCourse(COURSE_CLOVER_METACAM.id);
      expect(updated?.status).toBe("stopped");
    });
    expect(spy).toHaveBeenCalledWith(COURSE_CLOVER_METACAM.id, "stopped");
    // NOTE: the brief (B-course-form.md, "COURSE LIFECYCLE") states that
    // `stopped` setting `endDate = today` happens inside the repository, so
    // the call site above deliberately passes only {id, status} and this
    // test does not set endDate itself. But `setCourseStatus` in
    // `frontend/src/data/memoryRepo.ts` (frozen, outside this unit's
    // exclusive surface) only ever assigns `resumedAt` on a paused->active
    // transition — it never touches `endDate` on any transition. That half
    // of the contract cannot be observed here; the fixture's original
    // endDate ("2026-08-12") is left untouched by Stop. Reported as a
    // pre-existing gap in memoryRepo.ts rather than worked around in the UI.
  });
});

describe("edit mode prefill", () => {
  it("prefills dose amount, mode and the pressed frequency chip from the existing course", async () => {
    renderWithProviders(<CourseFormView courseId={COURSE_CLOVER_METACAM.id} />);
    const doseInput = await screen.findByLabelText("Dose amount");
    await waitFor(() => expect(doseInput).toHaveValue("0.4"));
    // Mode = "At set times" is asserted through the section's conditional
    // label rather than aria-pressed: the mode control is rendered through
    // the frozen `SegmentedControl` DS component, which does not expose a
    // per-option aria-pressed hook (only the Chips this file renders
    // directly, like the frequency row below, carry one).
    expect(screen.getByText("How often")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2× daily" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("accessibility", () => {
  it("every input is reachable by its label", async () => {
    renderCreateForm();
    await screen.findByText("Clover");
    expect(screen.getByLabelText("Medication")).toBeInTheDocument();
    expect(screen.getByLabelText("Dose amount")).toBeInTheDocument();
    expect(screen.getByLabelText("Unit")).toBeInTheDocument();
    expect(screen.getByLabelText("Instructions")).toBeInTheDocument();
  });

  it("pet buttons and the interval/frequency chips carry aria-pressed", async () => {
    renderCreateForm();
    await screen.findByText("Clover");
    const cloverButton = screen.getByText("Clover").closest("button")!;
    expect(cloverButton).toHaveAttribute("aria-pressed");
    expect(screen.getByRole("button", { name: "Every 8h" })).toHaveAttribute("aria-pressed", "true");
  });

  it("save and close controls have accessible names", async () => {
    renderCreateForm();
    await screen.findByText("Clover");
    expect(screen.getByRole("button", { name: "Save medication" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
