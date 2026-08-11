// Add/edit medication — SPEC §5.5's course form — plus the course lifecycle
// actions (SPEC §3c). Despite the SPEC section title this screen writes a
// `Course`, not a `Medication`: medication stock is edited only in Supplies
// (slice 6), never here. Transcribed from
// `<SCRATCH>/kit/AddMedicationScreen.jsx` per CONTRACT.md §1, with exactly
// the deviations CONTRACT.md §4 items 1-3 specify.
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Button, Card, Chip, PetAvatar, SectionLabel, SegmentedControl } from "@/components/ds";
import { Field } from "@/features/forms/Field";
import { usePets } from "@/features/pets/hooks";
import { amountLabel } from "@/features/pets/format";
import type { CourseStatus, LocalDate, LocalTime, Schedule } from "@/domain";
import { differenceInLocalDays, localDayKey, now } from "@/domain";
import { useTranslator } from "@/i18n";
import type { Translator } from "@/i18n";
import { gapWarningFor } from "./scheduleEditModel";
import { TimesEditor } from "./TimesEditor";
import {
  useCourse,
  useDoseEvents,
  useMedications,
  useSaveCourse,
  useSetCourseStatus,
  useUpdateCourse,
} from "./hooks";
import {
  DURATION_CHOICES,
  FREQUENCY_CHOICES,
  INTERVAL_CHOICES,
  MODE_CHOICES,
  choicesForSchedule,
  durationChoiceLabel,
  endDateForDurationChoice,
  frequencyChoiceLabel,
  intervalChoiceHours,
  intervalChoiceLabel,
  isPresetSchedule,
  modeChoiceLabel,
  scheduleForFrequencyChoice,
  scheduleForIntervalChoice,
  timesForFrequencyChoice,
  type DurationChoice,
  type FrequencyChoice,
  type IntervalChoice,
  type ModeChoice,
} from "./scheduleChoice";

/** The `fixedTimes` member of `Schedule` — the type `customTimesBase` holds. */
type FixedTimesSchedule = Extract<Schedule, { kind: "fixedTimes" }>;

/** A whole-minute duration into `{hours, minutes}`, for `history.detail.lateDuration`
 * — same small helper as `features/today/LogAtTimeSheet.tsx` (not exported there,
 * so not importable; duplicated rather than promoted, per that file's own convention). */
function toHoursMinutes(totalMinutes: number): { hours: number; minutes: number } {
  const abs = Math.abs(totalMinutes);
  return { hours: Math.floor(abs / 60), minutes: abs % 60 };
}

/** `CourseStatus` word, shown on the course-lifecycle card. Not exported —
 * the four `pets.courseStatus.*` catalogue entries are shared with Pet
 * detail's "Paused" badge (see `i18n/catalogue/pets.ts`). */
function courseStatusLabel(status: CourseStatus, tr: Translator): string {
  switch (status) {
    case "active":
      return tr.t("pets.courseStatus.active");
    case "paused":
      return tr.t("pets.courseStatus.paused");
    case "finished":
      return tr.t("pets.courseStatus.finished");
    case "stopped":
      return tr.t("pets.courseStatus.stopped");
  }
}

interface FormErrors {
  pet?: string;
  medication?: string;
  dose?: string;
  endDate?: string;
}

/** Route adapter: reads the URL, renders the view. Not tested directly. */
export function CourseFormPage() {
  const { courseId } = useParams({ strict: false });
  const search = useSearch({ strict: false }) as { petId?: string };
  return <CourseFormView courseId={courseId} initialPetId={search.petId} />;
}

/** All the behaviour. This is what the tests render. */
export function CourseFormView({
  courseId,
  initialPetId,
}: {
  courseId?: string;
  initialPetId?: string;
}) {
  const navigate = useNavigate();
  const tr = useTranslator();
  const isEdit = !!courseId;
  const medicationListId = useId();

  const petsQuery = usePets();
  const pets = petsQuery.data ?? [];
  const medicationsQuery = useMedications();
  const medications = medicationsQuery.data ?? [];
  const courseQuery = useCourse(courseId);
  const existingCourse = courseQuery.data;

  const saveCourse = useSaveCourse();
  const updateCourse = useUpdateCourse();
  const setCourseStatus = useSetCourseStatus();

  const [petId, setPetId] = useState<string | undefined>(initialPetId);
  const [medicationName, setMedicationName] = useState("");
  const [doseAmount, setDoseAmount] = useState("");
  const [doseUnit, setDoseUnit] = useState("");
  const [instructions, setInstructions] = useState("");
  const [mode, setMode] = useState<ModeChoice>("From last dose");
  const [intervalChoice, setIntervalChoice] = useState<IntervalChoice>("Every 8h");
  const [frequency, setFrequency] = useState<FrequencyChoice>("2× daily");
  const [duration, setDuration] = useState<DurationChoice>("7 days");
  const [customEndDate, setCustomEndDate] = useState("");
  const [startDate, setStartDate] = useState<LocalDate>(() =>
    courseId ? "" : localDayKey(now()),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  // `null` = the frequency chip governs `times`. Non-null once either (a) the
  // prefill finds an existing `fixedTimes` schedule that no preset matches
  // (`isPresetSchedule` false), or (b) the first stepper press in
  // `TimesEditor` seeds it from the currently-selected preset. Pressing any
  // frequency chip, or switching `mode`, resets `times` to that preset
  // wholesale and clears this back to `null` — see the chip/mode handlers
  // below. `customTimesBase` carries the ORIGINAL schedule `customTimes` was
  // seeded from (so `daysOfWeek`/`everyNDays` survive a save even though
  // this UI cannot produce them) and is kept in lockstep with `customTimes`:
  // non-null exactly when `customTimes` is non-null.
  const [customTimes, setCustomTimes] = useState<LocalTime[] | null>(null);
  const [customTimesBase, setCustomTimesBase] = useState<FixedTimesSchedule | null>(null);

  // Edit mode prefill — runs once, as soon as both the course and the
  // medication list have loaded (the medication name isn't on Course itself,
  // only medicationId, so both queries are needed to resolve it).
  const prefilled = useRef(false);
  useEffect(() => {
    if (!isEdit || !existingCourse || medicationsQuery.data === undefined) return;
    if (prefilled.current) return;
    prefilled.current = true;

    setPetId(existingCourse.petId);
    const med = medicationsQuery.data.find((m) => m.id === existingCourse.medicationId);
    setMedicationName(med?.name ?? "");
    setDoseAmount(amountLabel(existingCourse.doseAmount));
    setDoseUnit(existingCourse.doseUnit);
    setInstructions(existingCourse.instructions ?? "");
    setStartDate(existingCourse.startDate);

    const choices = choicesForSchedule(existingCourse.schedule);
    setMode(choices.mode);
    setIntervalChoice(choices.interval);
    setFrequency(choices.frequency);

    // The bug this state exists to fix: `choicesForSchedule` above is a
    // best-effort "nearest chip for display" lookup — for an existing
    // `fixedTimes` schedule that does not exactly match any of the four
    // presets (a course nudged by this very feature, or synced in with
    // custom times), it silently snaps to the nearest one, and until now
    // `handleSave` re-derived `schedule` from the chips unconditionally, so
    // saving after touching only e.g. the dose amount would rewrite the
    // schedule from that snapped preset. Here the exact original is kept
    // instead, so the chips are cosmetic and the save path stays faithful.
    if (existingCourse.schedule.kind === "fixedTimes" && !isPresetSchedule(existingCourse.schedule)) {
      setCustomTimes(existingCourse.schedule.times);
      setCustomTimesBase(existingCourse.schedule);
    } else {
      setCustomTimes(null);
      setCustomTimesBase(null);
    }

    if (existingCourse.endDate === null) {
      setDuration("Ongoing");
      setCustomEndDate("");
    } else {
      const span = differenceInLocalDays(existingCourse.endDate, existingCourse.startDate) + 1;
      if (span === 7) {
        setDuration("7 days");
      } else if (span === 14) {
        setDuration("14 days");
      } else {
        setDuration("Custom");
        setCustomEndDate(existingCourse.endDate);
      }
    }
  }, [isEdit, existingCourse, medicationsQuery.data]);

  function validate(): boolean {
    const next: FormErrors = {};
    if (!petId) next.pet = tr.t("courses.petError");
    if (!medicationName.trim()) next.medication = tr.t("courses.medicationError");
    const amountNum = Number(doseAmount);
    if (!doseAmount.trim() || !Number.isFinite(amountNum) || amountNum <= 0) {
      next.dose = tr.t("courses.doseError");
    }
    if (duration === "Custom" && !customEndDate) {
      next.endDate = tr.t("courses.endDateError");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goToPetOrRoster(destinationPetId: string | undefined) {
    if (destinationPetId) {
      navigate({ to: "/pets/$petId", params: { petId: destinationPetId } });
    } else {
      navigate({ to: "/pets" });
    }
  }

  /**
   * The one place `Schedule` is derived from form state — used both to
   * persist on Save and to preview the gap warning, so the two can never
   * disagree about what would be saved.
   *
   * The `customTimes !== null` branch spreads `customTimesBase` rather than
   * building a bare `{ kind: "fixedTimes", times: customTimes }`: that
   * preserves `daysOfWeek` (Weekly's `[6]`) and `everyNDays`, neither of
   * which this UI can produce, but either of which a synced-in course may
   * already carry — dropping them here would silently delete e.g. a
   * Saturday-only constraint the very next time the course is saved.
   */
  function computeSchedule(): Schedule {
    if (mode === "From last dose") return scheduleForIntervalChoice(intervalChoice);
    if (customTimes !== null && customTimesBase !== null) {
      return { ...customTimesBase, kind: "fixedTimes", times: customTimes };
    }
    return scheduleForFrequencyChoice(frequency);
  }

  async function handleSave() {
    if (!validate()) return;
    const schedule = computeSchedule();
    const amountNum = Number(doseAmount);
    const trimmedInstructions = instructions.trim() ? instructions.trim() : null;

    if (isEdit && courseId) {
      const endDate = endDateForDurationChoice(
        duration,
        startDate,
        duration === "Custom" ? customEndDate : null,
      );
      const saved = await updateCourse.mutateAsync({
        id: courseId,
        patch: {
          doseAmount: amountNum,
          doseUnit,
          instructions: trimmedInstructions,
          schedule,
          startDate,
          endDate,
        },
      });
      goToPetOrRoster(saved.petId);
      return;
    }

    if (!petId) return; // validated above
    const effectiveStartDate = startDate || localDayKey(now());
    const endDate = endDateForDurationChoice(
      duration,
      effectiveStartDate,
      duration === "Custom" ? customEndDate : null,
    );
    const saved = await saveCourse.mutateAsync({
      petId,
      medicationName: medicationName.trim(),
      doseAmount: amountNum,
      doseUnit,
      instructions: trimmedInstructions,
      schedule,
      startDate: effectiveStartDate,
      endDate,
    });
    goToPetOrRoster(saved.petId);
  }

  function handleClose() {
    goToPetOrRoster(petId);
  }

  const intervalOrFrequencyChoices = mode === "From last dose" ? INTERVAL_CHOICES : FREQUENCY_CHOICES;
  const saving = saveCourse.isPending || updateCourse.isPending;

  // Live times a `fixedTimes` row set actually shows: the custom edit while
  // one is in progress, else whatever the frequency chip presets.
  const fixedTimesValues = customTimes ?? timesForFrequencyChoice(frequency);
  const fixedTimesOriginals =
    customTimesBase !== null ? customTimesBase.times : fixedTimesValues;

  // The gap warning (SPEC: warn, never block) only has a "previous" schedule
  // to compare against once there IS an existing, persisted course — a
  // brand-new course being created has nothing to have shifted "earlier"
  // from yet.
  const doseEventsQuery = useDoseEvents(existingCourse ? { courseId: existingCourse.id } : {});
  const gapWarning =
    isEdit && existingCourse && mode === "At set times"
      ? gapWarningFor({
          next: computeSchedule(),
          previous: existingCourse.schedule,
          events: doseEventsQuery.data ?? [],
          courseId: existingCourse.id,
          now: now(),
        })
      : null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 22px 16px",
        }}
      >
        <span style={{ fontSize: 22, fontWeight: 800, color: "var(--ink-1)" }}>
          {tr.t("courses.newMedicationTitle")}
        </span>
        <button
          onClick={handleClose}
          aria-label={tr.t("pets.close")}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 20,
            color: "var(--ink-3)",
            // SPEC §10: >= 44x44 hit area. The glyph itself (measured ~15 x
            // 30px before this fix) stays the same size — only the box grows,
            // via an explicit 44x44 box centred on the glyph and pulled back
            // with a negative margin (half of each dimension's growth) so
            // neither the glyph's position nor the header's height/width
            // shifts. `position: relative` + `zIndex: 1` keeps the enlarged
            // box clickable across its full area even where it now overlaps
            // any free space toward the title on its left.
            width: 44,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "-7px -14.5px",
            position: "relative",
            zIndex: 1,
          }}
        >
          ✕
        </button>
      </div>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 22px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionLabel rule={false}>{tr.t("courses.for")}</SectionLabel>
          {petsQuery.isPending ? (
            <div role="status" aria-busy="true" style={{ display: "flex", gap: 10, overflowX: "auto" }}>
              <span
                style={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: "hidden",
                  clip: "rect(0, 0, 0, 0)",
                  whiteSpace: "nowrap",
                  border: 0,
                }}
              >
                {tr.t("courses.loadingPets")}
              </span>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <div style={{ borderRadius: 999, padding: 3, border: "2px solid transparent" }}>
                    <PetAvatar name="" tint={1} size={48} muted />
                  </div>
                  <div
                    style={{
                      width: 32,
                      height: 13,
                      borderRadius: 4,
                      background: "var(--surface-sunk)",
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, overflowX: "auto" }}>
              {pets.map((p) => {
                const selected = petId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      if (!isEdit) setPetId(p.id);
                    }}
                    disabled={isEdit}
                    aria-pressed={selected}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: isEdit ? "default" : "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      padding: 0,
                      opacity: isEdit ? 0.4 : 1,
                    }}
                  >
                    <div
                      style={{
                        borderRadius: 999,
                        padding: 3,
                        border: selected ? "2px solid var(--accent)" : "2px solid transparent",
                      }}
                    >
                      <PetAvatar name={p.name} tint={p.tint} size={48} muted={!selected} />
                    </div>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: selected ? "var(--ink-1)" : "var(--ink-3)",
                      }}
                    >
                      {p.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {errors.pet ? <div style={{ fontSize: 13, color: "var(--alert)" }}>{errors.pet}</div> : null}
        </div>

        <Field
          label={tr.t("courses.medicationLabel")}
          placeholder={tr.t("courses.medicationPlaceholder")}
          list={medicationListId}
          value={medicationName}
          onChange={(e) => setMedicationName(e.target.value)}
          error={errors.medication}
          disabled={isEdit}
        />
        <datalist id={medicationListId}>
          {medications.map((m) => (
            <option key={m.id} value={m.name} />
          ))}
        </datalist>
        {isEdit ? (
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{tr.t("courses.lockedNote")}</div>
        ) : null}

        <div style={{ display: "flex", gap: 10 }}>
          <Field
            label={tr.t("courses.doseAmountLabel")}
            placeholder={tr.t("courses.doseAmountPlaceholder")}
            inputMode="decimal"
            style={{ flex: 1 }}
            value={doseAmount}
            onChange={(e) => setDoseAmount(e.target.value)}
            error={errors.dose}
          />
          <Field
            label={tr.t("courses.unitLabel")}
            placeholder={tr.t("courses.unitPlaceholder")}
            style={{ width: 110 }}
            value={doseUnit}
            onChange={(e) => setDoseUnit(e.target.value)}
          />
        </div>
        <Field
          label={tr.t("courses.instructionsLabel")}
          placeholder={tr.t("courses.instructionsPlaceholder")}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
            {tr.t("courses.howScheduled")}
          </span>
          <SegmentedControl
            options={MODE_CHOICES.map((c) => ({ value: c, label: modeChoiceLabel(c, tr) }))}
            value={mode}
            onChange={(v) => {
              setMode(v as ModeChoice);
              // A stale `times` array from the OLD mode's chip set must not
              // survive a switch — e.g. a 3-slot custom edit surviving a
              // switch to a 2-slot preset. See the frequency-chip handler
              // just below for the identical reset on a chip press.
              setCustomTimes(null);
              setCustomTimesBase(null);
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
            {mode === "From last dose" ? tr.t("courses.intervalLabel") : tr.t("courses.howOften")}
            {mode === "At set times" && customTimes !== null ? (
              // SPEC §9: a pressed chip that no longer describes the data
              // would be a lie, so once `times` has been custom-edited NO
              // frequency chip below shows `aria-pressed="true"` — this note
              // takes over as the description of what's actually saved.
              <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>
                {" "}
                · {tr.t("courses.times.customNote")}
              </span>
            ) : null}
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {intervalOrFrequencyChoices.map((o) => {
              const selected =
                mode === "From last dose"
                  ? intervalChoice === o
                  : customTimes === null && frequency === o;
              const label =
                mode === "From last dose"
                  ? intervalChoiceLabel(o as IntervalChoice, tr)
                  : frequencyChoiceLabel(o as FrequencyChoice, tr);
              return (
                <Chip
                  key={o}
                  selected={selected}
                  aria-pressed={selected}
                  onClick={() => {
                    if (mode === "From last dose") {
                      setIntervalChoice(o as IntervalChoice);
                    } else {
                      setFrequency(o as FrequencyChoice);
                      // Pressing a preset replaces `times` wholesale — see
                      // the mode handler above for the same reset.
                      setCustomTimes(null);
                      setCustomTimesBase(null);
                    }
                  }}
                >
                  {label}
                </Chip>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
            {tr.t("courses.forHowLong")}
          </span>
          <SegmentedControl
            options={DURATION_CHOICES.map((c) => ({ value: c, label: durationChoiceLabel(c, tr) }))}
            value={duration}
            onChange={(v) => setDuration(v as DurationChoice)}
          />
          {duration === "Custom" ? (
            <Field
              label={tr.t("courses.endDateLabel")}
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              error={errors.endDate}
            />
          ) : null}
        </div>

        {mode === "From last dose" ? (
          <Card tone="quiet" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
              {tr.t("courses.reminders")}
            </span>
            <div style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5 }}>
              {tr.t("courses.reminders.fromLastDose", { hours: intervalChoiceHours(intervalChoice) })}
            </div>
          </Card>
        ) : (
          <Card tone="quiet" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* `TimesEditor` renders its own `courses.times.label` heading, so
                no separate "Reminders" label is repeated here. */}
            <TimesEditor
              times={fixedTimesValues}
              originalTimes={fixedTimesOriginals}
              onChange={(next) => {
                setCustomTimes(next);
                // Seed the base ONLY on the first custom edit — a later press
                // must keep referring back to the ORIGINAL preset/prefill,
                // not the previous press's already-edited value, or a second
                // press would have nothing stable left to diff the "was
                // HH:MM" caption against.
                setCustomTimesBase((base) => {
                  if (base !== null) return base;
                  const preset = scheduleForFrequencyChoice(frequency);
                  return preset.kind === "fixedTimes" ? preset : base;
                });
              }}
            />
          </Card>
        )}

        {gapWarning ? (
          <Card
            tone="quiet"
            style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
          >
            <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1.4 }}>
              ⚠
            </span>
            <span style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
              {gapWarning.kind === "tooSoonToLog"
                ? tr.t("courses.gapWarning.tooSoonToLog", {
                    gap: tr.t("history.detail.lateDuration", toHoursMinutes(gapWarning.gapMinutes)),
                  })
                : gapWarning.sinceTime !== null
                  ? tr.t("courses.gapWarning.tooSoon", {
                      gap: tr.t("history.detail.lateDuration", toHoursMinutes(gapWarning.gapMinutes)),
                      time: gapWarning.sinceTime,
                      expected: tr.t(
                        "history.detail.lateDuration",
                        toHoursMinutes(gapWarning.expectedMinutes),
                      ),
                    })
                  : tr.t("courses.gapWarning.tooSoonInterval", {
                      gap: tr.t("history.detail.lateDuration", toHoursMinutes(gapWarning.gapMinutes)),
                      expected: tr.t(
                        "history.detail.lateDuration",
                        toHoursMinutes(gapWarning.expectedMinutes),
                      ),
                    })}
            </span>
          </Card>
        ) : null}

        {isEdit && existingCourse ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SectionLabel>{tr.t("courses.courseSection")}</SectionLabel>
            <Card style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-2)" }}>
                {courseStatusLabel(existingCourse.status, tr)}
              </span>
              {existingCourse.status === "active" ? (
                <>
                  <Button
                    size="md"
                    onClick={() => setCourseStatus.mutate({ id: existingCourse.id, status: "paused" })}
                  >
                    {tr.t("courses.pause")}
                  </Button>
                  <Button
                    size="md"
                    variant="secondary"
                    onClick={() => setCourseStatus.mutate({ id: existingCourse.id, status: "stopped" })}
                  >
                    {tr.t("courses.stop")}
                  </Button>
                </>
              ) : null}
              {existingCourse.status === "paused" ? (
                <>
                  <Button
                    size="md"
                    onClick={() => setCourseStatus.mutate({ id: existingCourse.id, status: "active" })}
                  >
                    {tr.t("courses.resume")}
                  </Button>
                  <Button
                    size="md"
                    variant="secondary"
                    onClick={() => setCourseStatus.mutate({ id: existingCourse.id, status: "stopped" })}
                  >
                    {tr.t("courses.stop")}
                  </Button>
                </>
              ) : null}
            </Card>
          </div>
        ) : null}
      </div>
      <div style={{ padding: "12px 22px 22px", borderTop: "1px solid var(--line)", background: "var(--surface)" }}>
        <Button variant="ink" size="lg" block disabled={saving} onClick={() => void handleSave()}>
          {tr.t("courses.saveMedication")}
        </Button>
      </div>
    </div>
  );
}
