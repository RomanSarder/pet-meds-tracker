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
  /**
   * Optional: given the row values a press is ABOUT to commit, returns the
   * gap-warning prose that would show for them (same text `CourseFormPage`
   * puts in its warning `Card`), or `null` when none applies. When present,
   * `step` folds this into the SAME announcement as the time change — see
   * the comment on `announcement` below for why it must be the same
   * utterance rather than a second one. `CourseFormPage` is the only owner
   * of "the previous schedule"/"dose events"/etc a gap warning needs, so
   * this editor stays a pure view that merely asks for prose, never
   * computing a warning itself.
   */
  previewWarning?: (nextTimes: LocalTime[]) => string | null;
}

export function TimesEditor({
  times,
  originalTimes,
  onChange,
  previewWarning,
}: TimesEditorProps): ReactElement {
  const { t } = useTranslator();
  // The editor's ONE AND ONLY live region (rendered once, below) — never one
  // per row. N per-row regions would each announce independently, queueing N
  // overlapping utterances for a single tap; see the identical reasoning on
  // `LogAtTimeSheet.tsx`'s headline (~line 341). Every row's press writes
  // through this single piece of state instead.
  //
  // INVARIANT HELD HERE: not "one element with aria-live" (that's just how
  // the invariant is implemented) but ONE UTTERANCE PER INTERACTION — one
  // `setAnnouncement` call per press, full stop. That is why `step` below
  // computes a single combined string (time change, plus a gap warning when
  // one applies) and calls `setAnnouncement` exactly once, rather than
  // calling it once for the time and again for the warning — two calls
  // would still be one DOM node, but would still queue two utterances for
  // one tap, which is the thing actually being avoided.
  const [announcement, setAnnouncement] = useState("");

  function step(index: number, deltaMin: number) {
    const current = times[index];
    const nextTime = stepTime(current, deltaMin);
    if (nextTime === current) return; // at a clamp; the button should be disabled already
    const nextTimes = times.map((value, i) => (i === index ? nextTime : value));
    onChange(nextTimes);
    const timeAnnouncement = t("courses.times.announce", { index: index + 1, time: nextTime });
    // a11y fix: a screen-reader user pressing a stepper into the too-soon
    // zone previously heard only the time confirmation, never that a
    // warning (least of all the `tooSoonToLog` band — "these two doses
    // cannot both be logged") now applies below. `previewWarning` is asked
    // about `nextTimes` (the value this press is committing to), not
    // `times` (the value before it), since the warning always describes
    // where the press is landing.
    const warningAnnouncement = previewWarning?.(nextTimes) ?? null;
    setAnnouncement(
      warningAnnouncement ? `${timeAnnouncement}. ${warningAnnouncement}` : timeAnnouncement,
    );
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
