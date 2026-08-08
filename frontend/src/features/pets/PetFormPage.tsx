// Add / edit pet (SPEC §5.6). The only screen in the slice with no kit
// source — chrome and rhythm are transcribed from
// <SCRATCH>/kit/AddMedicationScreen.jsx per B-pet-form.md, not invented here.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Button, SegmentedControl } from "@/components/ds";
import type { Species } from "@/domain";
import { Field } from "@/features/forms/Field";
import { speciesLabel } from "./format";
import { useCreatePet, usePet, useUpdatePet } from "./hooks";

const SPECIES_ORDER: Species[] = ["rabbit", "guinea_pig", "cat", "dog", "other"];
const SPECIES_OPTIONS = SPECIES_ORDER.map((s) => ({ value: s, label: speciesLabel(s) }));

interface FormState {
  name: string;
  species: Species;
  /** "" means unset; otherwise the raw "YYYY-MM-DD" from the date input. */
  birthdate: string;
  /** "" means unset; otherwise the raw kg string the user typed. */
  weightKg: string;
}

const EMPTY_FORM: FormState = { name: "", species: "rabbit", birthdate: "", weightKg: "" };

const NAME_INPUT_ID = "pet-form-name";

/** Route adapter: reads the URL, renders the view. Not tested directly. */
export function PetFormPage() {
  const { petId } = useParams({ strict: false });
  return <PetFormView petId={petId} />;
}

/** All the behaviour. This is what the tests render. */
export function PetFormView({ petId }: { petId?: string }) {
  const isEdit = !!petId;
  const navigate = useNavigate();
  const petQuery = usePet(petId);
  const createPet = useCreatePet();
  const updatePet = useUpdatePet();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [nameError, setNameError] = useState<string | null>(null);
  const [weightError, setWeightError] = useState<string | null>(null);

  // Initialise from the loaded pet exactly once, so a background refetch (or
  // the query settling after the user has already started typing) never
  // clobbers their input.
  const initialised = useRef(false);
  useEffect(() => {
    if (!isEdit || initialised.current || !petQuery.data) return;
    initialised.current = true;
    const pet = petQuery.data;
    setForm({
      name: pet.name,
      species: pet.species,
      birthdate: pet.birthdate ?? "",
      weightKg: pet.weightGrams !== null ? String(pet.weightGrams / 1000) : "",
    });
  }, [isEdit, petQuery.data]);

  function goToCloseDestination() {
    if (isEdit) {
      navigate({ to: "/pets/$petId", params: { petId: petId as string } });
    } else {
      navigate({ to: "/pets" });
    }
  }

  // No native <form> element wraps the body (the kit itself is plain divs +
  // a Button onClick, per AddMedicationScreen.jsx) — deliberately, since a
  // <form> would make the DS's `Chip` buttons (no explicit `type`, used by
  // the species `SegmentedControl`) implicitly submit-on-click.
  async function handleSubmit() {
    const trimmedName = form.name.trim();
    const nameInvalid = trimmedName.length === 0;
    setNameError(nameInvalid ? "Enter a name" : null);

    let weightGrams: number | null = null;
    let weightInvalid = false;
    const trimmedWeight = form.weightKg.trim();
    if (trimmedWeight.length > 0) {
      const kg = Number(trimmedWeight);
      if (!Number.isFinite(kg) || kg <= 0) {
        weightInvalid = true;
      } else {
        weightGrams = Math.round(kg * 1000);
      }
    }
    setWeightError(weightInvalid ? "Enter a weight in kilograms" : null);

    if (nameInvalid || weightInvalid) {
      if (nameInvalid) document.getElementById(NAME_INPUT_ID)?.focus();
      return;
    }

    const birthdate = form.birthdate.length > 0 ? form.birthdate : null;

    try {
      if (isEdit) {
        await updatePet.mutateAsync({
          id: petId as string,
          patch: { name: trimmedName, species: form.species, birthdate, weightGrams },
        });
        navigate({ to: "/pets/$petId", params: { petId: petId as string } });
      } else {
        await createPet.mutateAsync({
          name: trimmedName,
          species: form.species,
          birthdate,
          weightGrams,
        });
        navigate({ to: "/pets" });
      }
    } catch {
      // No error UI is specified for a failed save (SPEC §5.6 / B-pet-form.md);
      // the user simply stays on the form.
    }
  }

  const title = isEdit ? "Edit pet" : "Add a pet";
  // Render nothing but the header until the pet query resolves in edit mode.
  const showForm = !isEdit || petQuery.data != null;

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
        <span style={{ fontSize: 22, fontWeight: 800, color: "var(--ink-1)" }}>{title}</span>
        <button
          type="button"
          onClick={goToCloseDestination}
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
      {showForm ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
            <Field
              id={NAME_INPUT_ID}
              label="Name"
              placeholder="e.g. Clover"
              value={form.name}
              onChange={(e) => {
                setForm((f) => ({ ...f, name: e.target.value }));
                if (nameError) setNameError(null);
              }}
              error={nameError}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>Species</span>
              <div style={{ overflowX: "auto" }}>
                <SegmentedControl
                  options={SPECIES_OPTIONS}
                  value={form.species}
                  onChange={(value) => setForm((f) => ({ ...f, species: value as Species }))}
                />
              </div>
            </div>
            <Field
              label="Birthdate"
              type="date"
              value={form.birthdate}
              onChange={(e) => setForm((f) => ({ ...f, birthdate: e.target.value }))}
            />
            <Field
              label="Weight (kg)"
              type="number"
              inputMode="decimal"
              placeholder="e.g. 1.9"
              value={form.weightKg}
              onChange={(e) => {
                setForm((f) => ({ ...f, weightKg: e.target.value }));
                if (weightError) setWeightError(null);
              }}
              error={weightError}
            />
          </div>
          <div
            style={{
              padding: "12px 22px 22px",
              borderTop: "1px solid var(--line)",
              background: "var(--surface)",
            }}
          >
            <Button type="button" variant="ink" size="lg" block onClick={handleSubmit}>
              Save pet
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
