// `describeSchedule`/`courseProgress` return STRUCTURE, not prose
// (I18N-DESIGN.md §3), so these tests assert the descriptor. The English
// wording these functions used to emit is pinned one layer out, in
// `src/i18n/schedule.test.ts`.
import { describe, expect, it } from "vitest";
import { fixtures } from "@/domain";
import { courseProgress, describeSchedule } from "./index";

describe("describeSchedule", () => {
  it("describes a fixedTimes schedule", () => {
    const description = describeSchedule({ kind: "fixedTimes", times: ["08:00", "20:00"] });
    expect(description).toEqual({
      segments: [
        { kind: "timesPerDay", times: 2 },
        { kind: "times", times: ["08:00", "20:00"] },
      ],
    });
  });

  it("describes a fixedTimes schedule with daysOfWeek and everyNDays", () => {
    const description = describeSchedule({
      kind: "fixedTimes",
      times: ["07:00"],
      daysOfWeek: [6],
      everyNDays: 2,
    });
    expect(description).toEqual({
      segments: [
        { kind: "weekly" },
        { kind: "weekday", isoWeekday: 6 },
        { kind: "everyNDays", days: 2 },
        { kind: "times", times: ["07:00"] },
      ],
    });
  });

  it("describes a fromLastDose schedule and carries the 'from last dose' segment", () => {
    const description = describeSchedule({ kind: "fromLastDose", intervalHours: 8 });
    expect(description).toEqual({
      segments: [{ kind: "everyHours", hours: 8 }, { kind: "fromLastDose" }],
    });
  });

  it("sorts daysOfWeek ascending and emits several days as one `weekdays` segment", () => {
    const description = describeSchedule({
      kind: "fixedTimes",
      times: ["08:00"],
      daysOfWeek: [4, 1],
    });
    expect(description).toEqual({
      segments: [
        { kind: "weekdays", isoWeekdays: [1, 4] },
        { kind: "times", times: ["08:00"] },
      ],
    });
  });

  it("emits no user-facing prose — every segment carries data only", () => {
    const description = describeSchedule({
      kind: "fromLastDose",
      intervalHours: 8,
      anchorTime: "08:00",
    });
    expect(description).toEqual({
      segments: [
        { kind: "everyHours", hours: 8 },
        { kind: "fromLastDose" },
        { kind: "firstDose", time: "08:00" },
      ],
    });
  });
});

describe("courseProgress", () => {
  it("reports day-of-total for a fixedTimes course with an endDate", () => {
    // COURSE_CLOVER_METACAM: startDate 2026-08-06, endDate 2026-08-12.
    const course = fixtures.courses[0];
    expect(course.schedule.kind).toBe("fixedTimes");
    expect(courseProgress(course, "2026-08-08")).toEqual({
      kind: "dayOfTotal",
      day: 3,
      total: 7,
    });
  });

  it("reports 'ongoing' for fromLastDose courses (no DoseEvent[] in this signature)", () => {
    const course = fixtures.courses.find((c) => c.schedule.kind === "fromLastDose")!;
    expect(courseProgress(course, "2026-08-08")).toEqual({ kind: "ongoing" });
  });
});
