// SPEC §5.3 — Pet detail: today's schedule, active/paused courses, recent
// log, and an overflow menu for edit/archive. Transcribed from
// `<SCRATCH>/kit/PetDetailScreen.jsx` (CONTRACT.md §1); the only additions
// are the ones CONTRACT.md §4 and this slice's brief spell out explicitly.
import { useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Badge, Button, Card, IconButton, PetAvatar, SectionLabel } from "@/components/ds";
import { localDayKey, now } from "@/domain";
import { courseProgress, describeSchedule, getDoseState, getOccurrences } from "@/engine";
import { useCourses, useDoseEvents, useMedications } from "@/features/courses/hooks";
import { ageLabel } from "./age";
import { doseRowPropsFor } from "./doseRow";
import { courseLabel, eventWhenLabel, joinMeta, speciesLabel, weightLabel } from "./format";
import { usePet, useSetPetArchived } from "./hooks";
import { ScheduleRow } from "./ScheduleRow";

/** Route adapter: reads the URL, renders the view. Not tested directly. */
export function PetDetailPage() {
  const { petId } = useParams({ strict: false });
  return petId ? <PetDetailView petId={petId} /> : null;
}

/** All the behaviour. This is what the tests render. */
export function PetDetailView({ petId }: { petId: string }) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const nowDate = now();
  const today = localDayKey(nowDate);

  const pet = usePet(petId);
  const courses = useCourses({ petId, status: ["active", "paused"] });
  const medications = useMedications();
  // Passing the course ids straight through means the filter yields nothing
  // (an empty `courseIds` array) until `courses.data` resolves, rather than
  // firing an unfiltered query in the meantime.
  const courseIds = courses.data?.map((c) => c.id) ?? [];
  const events = useDoseEvents({ courseIds, limit: 10, newestFirst: true });
  const setPetArchived = useSetPetArchived();

  if (!pet.data) return null;

  const activeCourses = courses.data ?? [];
  const medicationList = medications.data ?? [];
  const recentEvents = events.data ?? [];

  // `getOccurrences` decides which courses generate occurrences (it skips
  // non-`active` ones) — the context below hands it this pet's courses and
  // events; the pet filter after the call is CONTRACT.md's belt-and-braces.
  const occurrences = getOccurrences(today, {
    courses: activeCourses,
    events: recentEvents,
  }).filter((o) => o.petId === petId);

  function medicationName(medicationId: string): string {
    return medicationList.find((m) => m.id === medicationId)?.name ?? "";
  }

  function handleArchive() {
    setPetArchived.mutate(
      { id: petId, archived: true },
      { onSuccess: () => navigate({ to: "/pets" }) },
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 22px 12px" }}>
        <button
          onClick={() => navigate({ to: "/pets" })}
          aria-label="Back"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 22,
            color: "var(--ink-2)",
            padding: 0,
          }}
        >
          ‹
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-2)" }}>Pets</span>
        <IconButton
          icon="ellipsis"
          variant="plain"
          label="More actions"
          size={44}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          style={{ marginLeft: "auto" }}
        />
      </div>

      {menuOpen ? (
        <Card
          role="menu"
          style={{ margin: "0 22px 12px", display: "flex", flexDirection: "column", gap: 10 }}
        >
          <Button
            role="menuitem"
            variant="ghost"
            size="md"
            block
            onClick={() => navigate({ to: "/pets/$petId/edit", params: { petId } })}
          >
            Edit pet
          </Button>
          <Button role="menuitem" variant="ghost" size="md" block onClick={handleArchive}>
            Archive pet
          </Button>
        </Card>
      ) : null}

      <div style={{ padding: "0 22px 16px", display: "flex", alignItems: "center", gap: 14 }}>
        <PetAvatar name={pet.data.name} tint={pet.data.tint} size={64} />
        <div>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--ink-1)" }}>
            {pet.data.name}
          </div>
          <div style={{ fontSize: 14, color: "var(--ink-3)", marginTop: 2 }}>
            {joinMeta([
              speciesLabel(pet.data.species),
              ageLabel(pet.data.birthdate, today),
              weightLabel(pet.data.weightGrams),
            ])}
          </div>
        </div>
      </div>

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
        <SectionLabel trailing={`${occurrences.length} today`}>Schedule</SectionLabel>
        <Card>
          {occurrences.map((o, i) => {
            const course = activeCourses.find((c) => c.id === o.courseId);
            const state = getDoseState(o, nowDate);
            const rowProps = doseRowPropsFor({
              occurrence: o,
              state,
              medicationName: medicationName(o.medicationId),
              instructions: o.instructions,
              progress: course ? courseProgress(course, today) : "",
            });
            // Read-only (SPEC §5.3): no `onGive`, and never the DS `DoseRow`
            // itself — it hard-codes a "Give" `Button` for every non-`given`
            // state regardless of whether a handler is passed, which reads as
            // a false affordance here (SPEC §9). `ScheduleRow` is the
            // locally-composed, always-inert replacement: same layout and
            // tokens as `DoseRow`, but every state (including `notStarted`,
            // whose SPEC §3b "Start course" action belongs to Today, which
            // already owns it) renders as information only.
            return (
              <ScheduleRow
                key={o.key}
                state={state}
                medication={rowProps.medication}
                detail={rowProps.detail}
                time={rowProps.time}
                divider={i > 0}
              />
            );
          })}
        </Card>

        <SectionLabel>Courses</SectionLabel>
        {activeCourses.map((c) => {
          const label = courseLabel(medicationName(c.medicationId), c.doseAmount, c.doseUnit);
          return (
            <Card
              key={c.id}
              role="button"
              tabIndex={0}
              aria-label={`Open ${label}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                cursor: "pointer",
              }}
              onClick={() => navigate({ to: "/courses/$courseId", params: { courseId: c.id } })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate({ to: "/courses/$courseId", params: { courseId: c.id } });
                }
              }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-1)" }}>{label}</div>
                <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
                  {describeSchedule(c.schedule)}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {c.status === "paused" ? <Badge tone="neutral">Paused</Badge> : null}
                <Badge tone={c.endDate ? "accent" : "neutral"}>{courseProgress(c, today)}</Badge>
              </div>
            </Card>
          );
        })}

        <SectionLabel>Recent</SectionLabel>
        <Card tone="quiet" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {recentEvents.map((e) => {
            const course = activeCourses.find((c) => c.id === e.courseId);
            const label = course
              ? courseLabel(medicationName(course.medicationId), course.doseAmount, course.doseUnit)
              : "";
            const suffix = e.status === "skipped" ? " · Skipped" : e.status === "missed" ? " · Missed" : "";
            return (
              <div
                key={e.id}
                style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "var(--ink-2)" }}
              >
                <span>
                  {label}
                  {suffix}
                </span>
                <span style={{ color: "var(--ink-3)", fontSize: 13 }}>
                  {eventWhenLabel(new Date(e.givenAt), today)}
                </span>
              </div>
            );
          })}
        </Card>

        <Button
          variant="ink"
          size="lg"
          block
          icon="plus"
          onClick={() => navigate({ to: "/courses/new", search: { petId } })}
        >
          Add medication
        </Button>
      </div>
    </div>
  );
}
