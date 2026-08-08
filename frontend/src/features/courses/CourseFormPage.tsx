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
import type { CourseStatus, LocalDate } from "@/domain";
import { differenceInLocalDays, localDayKey, now } from "@/domain";
import { useCourse, useMedications, useSaveCourse, useSetCourseStatus, useUpdateCourse } from "./hooks";
import {
  DURATION_CHOICES,
  FREQUENCY_CHOICES,
  INTERVAL_CHOICES,
  MODE_CHOICES,
  choicesForSchedule,
  endDateForDurationChoice,
  scheduleForFrequencyChoice,
  scheduleForIntervalChoice,
  timesForFrequencyChoice,
  type DurationChoice,
  type FrequencyChoice,
  type IntervalChoice,
  type ModeChoice,
} from "./scheduleChoice";

const STATUS_WORDS: Record<CourseStatus, string> = {
  active: "Active",
  paused: "Paused",
  finished: "Finished",
  stopped: "Stopped",
};

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
    if (!petId) next.pet = "Choose a pet";
    if (!medicationName.trim()) next.medication = "Enter a medication name";
    const amountNum = Number(doseAmount);
    if (!doseAmount.trim() || !Number.isFinite(amountNum) || amountNum <= 0) {
      next.dose = "Enter a dose amount";
    }
    if (duration === "Custom" && !customEndDate) {
      next.endDate = "Pick an end date";
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

  async function handleSave() {
    if (!validate()) return;
    const schedule =
      mode === "From last dose"
        ? scheduleForIntervalChoice(intervalChoice)
        : scheduleForFrequencyChoice(frequency);
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
        <span style={{ fontSize: 22, fontWeight: 800, color: "var(--ink-1)" }}>New medication</span>
        <button
          onClick={handleClose}
          aria-label="Close"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 20,
            color: "var(--ink-3)",
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
          <SectionLabel rule={false}>For</SectionLabel>
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
          {errors.pet ? <div style={{ fontSize: 13, color: "var(--alert)" }}>{errors.pet}</div> : null}
        </div>

        <Field
          label="Medication"
          placeholder="e.g. Metacam"
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
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
            Pet and medication can&apos;t be changed after a course is created.
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 10 }}>
          <Field
            label="Dose amount"
            placeholder="e.g. 0.4"
            inputMode="decimal"
            style={{ flex: 1 }}
            value={doseAmount}
            onChange={(e) => setDoseAmount(e.target.value)}
            error={errors.dose}
          />
          <Field
            label="Unit"
            placeholder="e.g. ml"
            style={{ width: 110 }}
            value={doseUnit}
            onChange={(e) => setDoseUnit(e.target.value)}
          />
        </div>
        <Field
          label="Instructions"
          placeholder="e.g. after food"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>How it is scheduled</span>
          <SegmentedControl
            options={[...MODE_CHOICES]}
            value={mode}
            onChange={(v) => setMode(v as ModeChoice)}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
            {mode === "From last dose" ? "Interval" : "How often"}
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {intervalOrFrequencyChoices.map((o) => {
              const selected = mode === "From last dose" ? intervalChoice === o : frequency === o;
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
                    }
                  }}
                >
                  {o}
                </Chip>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>For how long</span>
          <SegmentedControl
            options={[...DURATION_CHOICES]}
            value={duration}
            onChange={(v) => setDuration(v as DurationChoice)}
          />
          {duration === "Custom" ? (
            <Field
              label="End date"
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              error={errors.endDate}
            />
          ) : null}
        </div>

        <Card tone="quiet" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>Reminders</span>
          {mode === "From last dose" ? (
            <div style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5 }}>
              The next dose is counted from the moment you log one — {intervalChoice.toLowerCase()}.
              Nothing is due until the first dose is logged.
            </div>
          ) : (
            timesForFrequencyChoice(frequency).map((t) => (
              <div
                key={t}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 15,
                  color: "var(--ink-1)",
                }}
              >
                <span>{t}</span>
              </div>
            ))
          )}
        </Card>

        {isEdit && existingCourse ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SectionLabel>Course</SectionLabel>
            <Card style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-2)" }}>
                {STATUS_WORDS[existingCourse.status]}
              </span>
              {existingCourse.status === "active" ? (
                <>
                  <Button
                    size="md"
                    onClick={() => setCourseStatus.mutate({ id: existingCourse.id, status: "paused" })}
                  >
                    Pause
                  </Button>
                  <Button
                    size="md"
                    variant="secondary"
                    onClick={() => setCourseStatus.mutate({ id: existingCourse.id, status: "stopped" })}
                  >
                    Stop
                  </Button>
                </>
              ) : null}
              {existingCourse.status === "paused" ? (
                <>
                  <Button
                    size="md"
                    onClick={() => setCourseStatus.mutate({ id: existingCourse.id, status: "active" })}
                  >
                    Resume
                  </Button>
                  <Button
                    size="md"
                    variant="secondary"
                    onClick={() => setCourseStatus.mutate({ id: existingCourse.id, status: "stopped" })}
                  >
                    Stop
                  </Button>
                </>
              ) : null}
            </Card>
          </div>
        ) : null}
      </div>
      <div style={{ padding: "12px 22px 22px", borderTop: "1px solid var(--line)", background: "var(--surface)" }}>
        <Button variant="ink" size="lg" block disabled={saving} onClick={() => void handleSave()}>
          Save medication
        </Button>
      </div>
    </div>
  );
}
