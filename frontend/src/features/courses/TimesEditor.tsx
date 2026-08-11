// The −/+ stepper grid for a `fixedTimes` course's `times` array (SPEC's
// "shift a dose time earlier" feature). Feature-local, not a `components/ds`
// primitive: the DS kit is frozen for this wave and has no time input. Built
// from existing DS primitives only (`Button`), following the exact stepper
// idiom `features/today/LogAtTimeSheet.tsx` already established — this
// should read as a sibling of that file, not a new dialect.
//
// PURELY A VIEW. All arithmetic (`stepTime`, clamping) comes from
// `scheduleEditModel.ts`; this file resolves copy through the catalogue and
// lays out DOM. It never sorts or reorders `times` — see the comment above
// the row map below for why that matters.
import { useState, type ReactElement } from "react";
import { Button } from "@/components/ds";
import type { LocalTime } from "@/domain";
import { useTranslator } from "@/i18n";
import { SCHEDULE_STEP_MIN, stepTime } from "./scheduleEditModel";

export interface TimesEditorProps {
  /** One row per entry, rendered in this exact array order. */
  times: LocalTime[];
  /**
   * The baseline each row is compared against for the quiet "was HH:MM"
   * caption — same length and order as `times`. A row whose current value
   * differs from `originalTimes[i]` shows the caption; a row that has not
   * been touched this session does not.
   */
  originalTimes: LocalTime[];
  onChange: (next: LocalTime[]) => void;
}

export function TimesEditor({ times, originalTimes, onChange }: TimesEditorProps): ReactElement {
  const { t } = useTranslator();
  // The editor's ONE AND ONLY live region (rendered once, below) — never one
  // per row. N per-row regions would each announce independently, queueing N
  // overlapping utterances for a single tap; see the identical reasoning on
  // `LogAtTimeSheet.tsx`'s headline (~line 341). Every row's press writes
  // through this single piece of state instead.
  const [announcement, setAnnouncement] = useState("");

  function step(index: number, deltaMin: number) {
    const current = times[index];
    const nextTime = stepTime(current, deltaMin);
    if (nextTime === current) return; // at a clamp; the button should be disabled already
    onChange(times.map((value, i) => (i === index ? nextTime : value)));
    setAnnouncement(t("courses.times.announce", { index: index + 1, time: nextTime }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
        {t("courses.times.label")}
      </span>

      {/*
        ONE ROW PER `times` ENTRY, IN ARRAY ORDER — `times.map`, never
        `.sort()`ed or re-keyed by value. `gapWarningFor` and the wider
        occurrence engine pair a previous schedule's slots against a next
        schedule's slots POSITIONALLY (index 0 against index 0, and so on);
        sorting the rows here would silently change which persisted slot an
        edited value lands on without any visible error.
      */}
      {times.map((time, index) => {
        const original = originalTimes[index];
        const changed = original !== undefined && original !== time;
        const canEarlier = stepTime(time, -SCHEDULE_STEP_MIN) !== time;
        const canLater = stepTime(time, SCHEDULE_STEP_MIN) !== time;
        return (
          <div key={index} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Button
                type="button"
                variant="secondary"
                size="md"
                style={{ flex: 1 }}
                disabled={!canEarlier}
                aria-label={t("courses.times.earlier", { minutes: SCHEDULE_STEP_MIN, index: index + 1 })}
                onClick={() => step(index, -SCHEDULE_STEP_MIN)}
              >
                −
              </Button>
              {/* The value box: same 96×44 tabular-nums treatment as
                  `LogAtTimeSheet.tsx:452-469`'s stepper. */}
              <div
                style={{
                  flex: "0 0 96px",
                  height: 44,
                  borderRadius: "var(--radius-md)",
                  background: "var(--surface-sunk)",
                  border: "1px solid var(--line)",
                  fontSize: 18,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--ink-1)",
                }}
              >
                {time}
              </div>
              <Button
                type="button"
                variant="secondary"
                size="md"
                style={{ flex: 1 }}
                disabled={!canLater}
                aria-label={t("courses.times.later", { minutes: SCHEDULE_STEP_MIN, index: index + 1 })}
                onClick={() => step(index, SCHEDULE_STEP_MIN)}
              >
                +
              </Button>
            </div>
            {changed ? (
              <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
                {t("courses.times.was", { time: original })}
              </span>
            ) : null}
          </div>
        );
      })}

      {/* Visually hidden, same clip-rect idiom `CourseFormPage.tsx` already
          uses for its pets-loading placeholder — stable position, no `key`,
          so React mutates this node's text on each press rather than
          replacing it, which is what makes the polite announcement fire. */}
      <span
        aria-live="polite"
        aria-atomic="true"
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
        {announcement}
      </span>
    </div>
  );
}
