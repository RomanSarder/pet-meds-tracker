import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { fixtures } from "@/domain";
import { getOccurrences, type EngineContext } from "@/engine";
import { createMemoryRepo, type Repo } from "@/data";
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

/**
 * A `fixedTimes` course whose `times` — `["08:00", "18:00"]` — do not match
 * ANY of `scheduleForFrequencyChoice`'s four presets (`isPresetSchedule`
 * false; `choicesForSchedule`'s best-effort nearest-chip lookup falls all
 * the way back to "Once daily"). This is the exact shape the `customTimes`
 * state exists for: a schedule the chips cannot describe, only cosmetically
 * approximate.
 */
async function createCustomTimesCourse(repo: Repo) {
  return repo.createCourse({
    petId: CLOVER.id,
    medicationId: METACAM.id,
    doseAmount: 0.4,
    doseUnit: "ml",
    instructions: null,
    schedule: { kind: "fixedTimes", times: ["08:00", "18:00"] },
    startDate: "2026-08-01",
    endDate: null,
    notes: null,
  });
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
      return {
        courses: await repo.listCourses(),
        events: await repo.listDoseEvents({}),
        courseEvents: await repo.listCourseEvents({}),
      };
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
    const stopped = await repo.getCourse(COURSE_CLOVER_METACAM.id);
    expect(stopped?.endDate).toBe(TODAY);
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

describe("pets loading state (SPEC §5.5 item 1 — the pet picker is the form's required first field)", () => {
  it("shows an accessible pending placeholder instead of an empty gap while pets are still loading", async () => {
    const repo = createMemoryRepo();
    // A promise that never resolves within the test keeps `usePets()` in its
    // `isPending` state for the whole test, exactly like the moment right
    // after a cold load before IndexedDB has answered.
    vi.spyOn(repo, "listPets").mockReturnValue(new Promise(() => {}));
    renderWithProviders(<CourseFormView />, { repo });

    const pending = await screen.findByRole("status");
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(pending).toHaveTextContent("Loading pets");

    // The real pet picker (an actual, selectable pet button) must not be
    // present yet — only the placeholder region should be.
    expect(screen.queryByText("Clover")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clover" })).not.toBeInTheDocument();
  });
});

// The "shift a course's dose times earlier" feature (SPEC's UI half of it) —
// `customTimes`/`customTimesBase` state, the `TimesEditor` it drives, and the
// inline `gapWarningFor` banner.
describe("times editor: the customTimes regression this state exists to prevent", () => {
  it("saving after changing ONLY the dose amount leaves a non-preset schedule byte-identical", async () => {
    const repo = createMemoryRepo();
    const course = await createCustomTimesCourse(repo);
    renderWithProviders(<CourseFormView courseId={course.id} />, { repo });
    const user = userEvent.setup();

    const doseInput = await screen.findByLabelText("Dose amount");
    await waitFor(() => expect(doseInput).toHaveValue("0.4"));
    await user.clear(doseInput);
    await user.type(doseInput, "0.6");
    await clickSave(user);

    const updated = await waitFor(async () => {
      const found = await repo.getCourse(course.id);
      expect(found?.doseAmount).toBe(0.6);
      return found!;
    });
    // The regression: pre-`customTimes` code recomputed `schedule` from the
    // chips unconditionally. `choicesForSchedule` cannot describe
    // `["08:00", "18:00"]` with any chip (`isPresetSchedule` false), falls
    // back to "Once daily", and the old save path would have persisted
    // `{ kind: "fixedTimes", times: ["09:00"] }` here instead.
    expect(updated.schedule).toEqual({ kind: "fixedTimes", times: ["08:00", "18:00"] });
  });
});

describe("times editor: non-preset prefill", () => {
  it("renders one row per time and leaves no frequency chip aria-pressed", async () => {
    const repo = createMemoryRepo();
    const course = await createCustomTimesCourse(repo);
    renderWithProviders(<CourseFormView courseId={course.id} />, { repo });

    await screen.findByText("08:00");
    expect(screen.getByText("18:00")).toBeInTheDocument();

    for (const label of ["Once daily", "2× daily", "3× daily", "Weekly"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "false");
    }
    expect(screen.getByText(/Custom times/)).toBeInTheDocument();
  });
});

describe("times editor: shifting a preset course's times earlier", () => {
  async function pressEarlierEightTimes(user: User) {
    const button = screen.getByRole("button", { name: "15 minutes earlier, dose 2" });
    for (let i = 0; i < 8; i++) {
      await user.click(button);
    }
  }

  it("8 presses on row 2 (20:00 -> 18:00) raises the mock's own tooSoon warning, and Save stays enabled", async () => {
    renderWithProviders(<CourseFormView courseId={COURSE_CLOVER_METACAM.id} />);
    const user = userEvent.setup();

    await screen.findByText("20:00");
    await pressEarlierEightTimes(user);

    expect(screen.getByText("18:00")).toBeInTheDocument();
    expect(screen.queryByText("20:00")).not.toBeInTheDocument();
    expect(screen.getByText("was 20:00")).toBeInTheDocument();
    expect(
      screen.getByText("Only 10 h since the 08:00 dose (this course is every 12 h)."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save medication" })).not.toBeDisabled();
  });

  it("announces the tooSoon warning in the SAME utterance as the time change (a11y: no second live region)", async () => {
    renderWithProviders(<CourseFormView courseId={COURSE_CLOVER_METACAM.id} />);
    const user = userEvent.setup();

    await screen.findByText("20:00");
    await pressEarlierEightTimes(user);

    // The visible warning `Card` and this announcement carry the SAME prose
    // (`gapWarningMessage`, shared by both) — but only this combined string,
    // prefixed with the stepper's own confirmation, is what a screen reader
    // actually hears from a press. Finding: previously nothing warning-shaped
    // was announced at all.
    expect(
      screen.getByText("Dose 2 set to 18:00. Only 10 h since the 08:00 dose (this course is every 12 h)."),
    ).toBeInTheDocument();
  });

  it(
    "the announcement escalates to the tooSoonToLog wording once presses cross under the 60-minute grace window",
    async () => {
      renderWithProviders(<CourseFormView courseId={COURSE_CLOVER_METACAM.id} />);
      const user = userEvent.setup();

      await screen.findByText("20:00");
      const earlier = screen.getByRole("button", { name: "15 minutes earlier, dose 2" });
      // 45 presses: 20:00 -> 08:45, a 45-minute gap to the 08:00 dose — inside
      // `GRACE_FIXED_MIN` (60 min, `@/domain`), the exact spacing at which
      // `logDose` throws `DuplicateDoseError` for a second dose given that
      // close to the first. This is the band the softer `tooSoon` wording
      // must not be used for.
      for (let i = 0; i < 45; i++) {
        await user.click(earlier);
      }

      expect(screen.getByText("08:45")).toBeInTheDocument();
      expect(
        screen.getByText("Dose 2 set to 08:45. Doses less than 45 min apart cannot both be logged."),
      ).toBeInTheDocument();
    },
    15000,
  );

  it("persists times: [\"08:00\", \"18:00\"] exactly on save (the round-trip regression)", async () => {
    const repo = createMemoryRepo();
    renderWithProviders(<CourseFormView courseId={COURSE_CLOVER_METACAM.id} />, { repo });
    const user = userEvent.setup();

    await screen.findByText("20:00");
    await pressEarlierEightTimes(user);
    await clickSave(user);

    const updated = await waitFor(async () => {
      const found = await repo.getCourse(COURSE_CLOVER_METACAM.id);
      expect(found?.schedule).toEqual({ kind: "fixedTimes", times: ["08:00", "18:00"] });
      return found!;
    });
    expect(updated.schedule).toEqual({ kind: "fixedTimes", times: ["08:00", "18:00"] });
  });

  it("pressing 3x daily after a custom edit replaces times wholesale and clears the custom state", async () => {
    const repo = createMemoryRepo();
    renderWithProviders(<CourseFormView courseId={COURSE_CLOVER_METACAM.id} />, { repo });
    const user = userEvent.setup();

    await screen.findByText("20:00");
    await pressEarlierEightTimes(user);
    expect(screen.getByText("18:00")).toBeInTheDocument();

    await clickChip(user, "3× daily");

    expect(screen.getByRole("button", { name: "3× daily" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("18:00")).not.toBeInTheDocument();
    expect(screen.queryByText("was 20:00")).not.toBeInTheDocument();
    expect(screen.getByText("08:00")).toBeInTheDocument();
    expect(screen.getByText("14:00")).toBeInTheDocument();
    expect(screen.getByText("20:00")).toBeInTheDocument();

    await clickSave(user);
    const updated = await waitFor(async () => {
      const found = await repo.getCourse(COURSE_CLOVER_METACAM.id);
      expect(found?.schedule).toEqual({ kind: "fixedTimes", times: ["08:00", "14:00", "20:00"] });
      return found!;
    });
    expect(updated.schedule).toEqual({ kind: "fixedTimes", times: ["08:00", "14:00", "20:00"] });
  });
});

describe("daily maximum chips (SPEC §3b-i / §6.7 step 5a)", () => {
  it("shows for 'From last dose' with 'No maximum' selected by default, and is hidden entirely for 'At set times'", async () => {
    renderCreateForm();
    const user = userEvent.setup();
    await screen.findByText("Clover");

    expect(screen.getByText("Daily maximum")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No maximum" })).toHaveAttribute("aria-pressed", "true");

    await clickChip(user, "At set times");
    expect(screen.queryByText("Daily maximum")).not.toBeInTheDocument();

    await clickChip(user, "From last dose");
    expect(screen.getByText("Daily maximum")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No maximum" })).toHaveAttribute("aria-pressed", "true");
  });

  it("is savable without touching the control, and persists a schedule with no maxPerDay key at all", async () => {
    const repo = createMemoryRepo();
    const { repo: usedRepo } = renderWithProviders(<CourseFormView />, { repo });
    const user = userEvent.setup();
    await screen.findByText("Clover");
    await selectPet(user, "Clover");
    await typeMedication(user, "No Maximum Course");
    await typeDose(user, "0.4", "ml");
    await clickSave(user);

    const created = await waitFor(async () => {
      const courses = await usedRepo.listCourses({ petId: CLOVER.id });
      const match = courses.find((c) => c.doseAmount === 0.4 && c.schedule.kind === "fromLastDose");
      expect(match).toBeDefined();
      return match!;
    });
    expect(created.schedule).toEqual({ kind: "fromLastDose", intervalHours: 8 });
    expect("maxPerDay" in created.schedule).toBe(false);
  });

  it("selecting '3' saves maxPerDay: 3, and the reminders card gains the extra sentence only once a maximum is set", async () => {
    const repo = createMemoryRepo();
    const { repo: usedRepo } = renderWithProviders(<CourseFormView />, { repo });
    const user = userEvent.setup();
    await screen.findByText("Clover");
    await selectPet(user, "Clover");
    await typeMedication(user, "Max Three Course");
    await typeDose(user, "0.4", "ml");

    expect(
      screen.queryByText(/Nothing more is due once/),
    ).not.toBeInTheDocument();

    await clickChip(user, "3");
    expect(screen.getByRole("button", { name: "3" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "No maximum" })).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByText(
        /Nothing more is due once 3 doses have been given today — you can still give and record one if needed\./,
      ),
    ).toBeInTheDocument();

    await clickSave(user);
    const created = await waitFor(async () => {
      const courses = await usedRepo.listCourses({ petId: CLOVER.id });
      const match = courses.find((c) => c.doseAmount === 0.4 && c.schedule.kind === "fromLastDose");
      expect(match).toBeDefined();
      return match!;
    });
    expect(created.schedule).toEqual({ kind: "fromLastDose", intervalHours: 8, maxPerDay: 3 });
  });

  it("edit mode prefills the pressed maximum chip from an existing capped course", async () => {
    const repo = createMemoryRepo();
    const existing = await repo.createCourse({
      petId: CLOVER.id,
      medicationId: METACAM.id,
      doseAmount: 0.4,
      doseUnit: "ml",
      instructions: null,
      schedule: { kind: "fromLastDose", intervalHours: 8, maxPerDay: 4 },
      startDate: "2026-08-01",
      endDate: null,
      notes: null,
    });

    renderWithProviders(<CourseFormView courseId={existing.id} />, { repo });
    const doseInput = await screen.findByLabelText("Dose amount");
    await waitFor(() => expect(doseInput).toHaveValue("0.4"));

    expect(screen.getByRole("button", { name: "4" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "No maximum" })).toHaveAttribute("aria-pressed", "false");
  });

  it("selecting '6' saves maxPerDay: 6 — the row reaches past the old ceiling of 4", async () => {
    const repo = createMemoryRepo();
    const { repo: usedRepo } = renderWithProviders(<CourseFormView />, { repo });
    const user = userEvent.setup();
    await screen.findByText("Clover");
    await selectPet(user, "Clover");
    await typeMedication(user, "Max Six Course");
    await typeDose(user, "0.6", "ml");

    await clickChip(user, "6");
    expect(screen.getByRole("button", { name: "6" })).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText(
        /Nothing more is due once 6 doses have been given today — you can still give and record one if needed\./,
      ),
    ).toBeInTheDocument();

    await clickSave(user);
    const created = await waitFor(async () => {
      const courses = await usedRepo.listCourses({ petId: CLOVER.id });
      const match = courses.find((c) => c.doseAmount === 0.6 && c.schedule.kind === "fromLastDose");
      expect(match).toBeDefined();
      return match!;
    });
    expect(created.schedule).toEqual({ kind: "fromLastDose", intervalHours: 8, maxPerDay: 6 });
  });

  // The regression the old 4-chip row would have caused: `nearestMaxPerDayChoice`
  // clamped everything above 4 down to "4 per day", so opening a 5-per-day course
  // and saving it silently rewrote the cap to 4.
  it("edit mode prefills '5' from a 5-per-day course and saves it back unchanged", async () => {
    const repo = createMemoryRepo();
    const existing = await repo.createCourse({
      petId: CLOVER.id,
      medicationId: METACAM.id,
      doseAmount: 0.4,
      doseUnit: "ml",
      instructions: null,
      schedule: { kind: "fromLastDose", intervalHours: 4, maxPerDay: 5 },
      startDate: "2026-08-01",
      endDate: null,
      notes: null,
    });

    renderWithProviders(<CourseFormView courseId={existing.id} />, { repo });
    const doseInput = await screen.findByLabelText("Dose amount");
    await waitFor(() => expect(doseInput).toHaveValue("0.4"));

    expect(screen.getByRole("button", { name: "5" })).toHaveAttribute("aria-pressed", "true");

    const user = userEvent.setup();
    await clickSave(user);
    await waitFor(async () => {
      const reloaded = await repo.getCourse(existing.id);
      expect(reloaded!.schedule).toEqual({ kind: "fromLastDose", intervalHours: 4, maxPerDay: 5 });
    });
  });

  it("groups the maximum chips under their own heading, so a bare numeral has an accessible context", async () => {
    const repo = createMemoryRepo();
    renderWithProviders(<CourseFormView />, { repo });
    await screen.findByText("Clover");

    const group = screen.getByRole("group", { name: "Daily maximum" });
    expect(within(group).getByRole("button", { name: "No maximum" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "6" })).toBeInTheDocument();
  });
});
