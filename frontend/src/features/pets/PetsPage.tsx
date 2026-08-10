// SPEC §5.2 — Pets roster. Transcribed from
// <SCRATCH>/kit/PetsScreen.jsx; only the data source changes. See
// CONTRACT.md §1/§4 and briefs-w3/B-pets-roster.md for the exact mapping.
import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Badge, Button, Card, EmptyState, Icon, PetAvatar, ScreenHeader } from "@/components/ds";
import { describeSchedule } from "@/engine";
import { renderSchedule } from "@/i18n/schedule";
import { createTranslator } from "@/i18n";
import type { Course, Medication } from "@/domain";
import { localDayKey, now } from "@/domain";
import { ageLabel } from "./age";
import { courseLabel, joinMeta, speciesLabel } from "./format";
import { usePets } from "./hooks";
import { useCourses, useMedications } from "../courses/hooks";
import { useMembers } from "../household/hooks";

const enTr = createTranslator("en");

export function PetsPage() {
  const navigate = useNavigate();
  const today = localDayKey(now());

  const petsQuery = usePets();
  const coursesQuery = useCourses({ status: ["active"] });
  const medicationsQuery = useMedications();
  const membersQuery = useMembers();

  const pets = petsQuery.data ?? [];
  const courses = coursesQuery.data ?? [];
  const medications = medicationsQuery.data ?? [];
  const memberCount = membersQuery.data?.length ?? 0;
  const memberCountLabel = memberCount === 1 ? "1 person" : `${memberCount} people`;

  const medicationsById = useMemo(() => {
    const map = new Map<string, Medication>();
    for (const m of medications) map.set(m.id, m);
    return map;
  }, [medications]);

  const coursesByPetId = useMemo(() => {
    const map = new Map<string, Course[]>();
    for (const c of courses) {
      const list = map.get(c.petId);
      if (list) {
        list.push(c);
      } else {
        map.set(c.petId, [c]);
      }
    }
    return map;
  }, [courses]);

  function openPet(petId: string) {
    navigate({ to: "/pets/$petId", params: { petId } });
  }

  function addPet() {
    navigate({ to: "/pets/new" });
  }

  function openHousehold() {
    navigate({ to: "/household" });
  }

  const householdRow = (
    <Card
      onClick={openHousehold}
      role="button"
      tabIndex={0}
      aria-label={`Household, ${memberCountLabel}`}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          openHousehold();
        } else if (e.key === " ") {
          e.preventDefault();
          openHousehold();
        }
      }}
      style={{
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        minHeight: "var(--tap-min)",
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-1)" }}>
        {`Household · ${memberCountLabel}`}
      </span>
      <span style={{ fontSize: 20, color: "var(--ink-3)" }}>›</span>
    </Card>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <ScreenHeader
        title="Pets"
        subtitle={`${pets.length} ${pets.length === 1 ? "animal" : "animals"} · ${courses.length} active ${courses.length === 1 ? "course" : "courses"}`}
        action="plus"
        actionLabel="Add a course"
        onAction={() => navigate({ to: "/courses/new" })}
      />
      {petsQuery.isLoading ? null : pets.length === 0 ? (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <EmptyState
            icon="paw-print"
            title="No pets yet"
            action={
              <Button variant="ink" size="lg" onClick={() => navigate({ to: "/pets/new" })}>
                Add a pet
              </Button>
            }
          />
          <div style={{ padding: "0 22px 22px" }}>{householdRow}</div>
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0 22px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {pets.map((pet) => {
            const petCourses = coursesByPetId.get(pet.id) ?? [];
            return (
              <Card
                key={pet.id}
                onClick={() => openPet(pet.id)}
                role="button"
                tabIndex={0}
                aria-label={`Open ${pet.name}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    openPet(pet.id);
                  } else if (e.key === " ") {
                    e.preventDefault();
                    openPet(pet.id);
                  }
                }}
                style={{
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <PetAvatar name={pet.name} tint={pet.tint} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink-1)" }}>
                      {pet.name}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
                      {joinMeta([speciesLabel(pet.species), ageLabel(pet.birthdate, today)])}
                    </div>
                  </div>
                  <span style={{ fontSize: 20, color: "var(--ink-3)" }}>›</span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {petCourses.length ? (
                    petCourses.map((c) => {
                      const med = medicationsById.get(c.medicationId);
                      return (
                        <Badge key={c.id} tone={c.endDate ? "accent" : "neutral"}>
                          {`${courseLabel(med?.name ?? "", c.doseAmount, c.doseUnit)} · ${renderSchedule(describeSchedule(c.schedule), enTr)}`}
                        </Badge>
                      );
                    })
                  ) : (
                    <span style={{ fontSize: 13, color: "var(--ink-3)" }}>No active medication</span>
                  )}
                </div>
              </Card>
            );
          })}
          <Card
            tone="dashed"
            onClick={addPet}
            role="button"
            tabIndex={0}
            aria-label="Add a pet"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                addPet();
              } else if (e.key === " ") {
                e.preventDefault();
                addPet();
              }
            }}
            style={{
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              minHeight: "var(--tap-min)",
              color: "var(--ink-3)",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            <Icon name="plus" size={18} />
            <span>Add a pet</span>
          </Card>
          {householdRow}
        </div>
      )}
    </div>
  );
}
