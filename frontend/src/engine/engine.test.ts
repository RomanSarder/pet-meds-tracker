import { describe, expect, it } from "vitest";
import { fixtures } from "@/domain";
import { courseProgress, describeSchedule } from "./index";

describe("describeSchedule", () => {
  it("describes a fixedTimes schedule", () => {
    const text = describeSchedule({ kind: "fixedTimes", times: ["08:00", "20:00"] });
    expect(text).toContain("08:00");
    expect(text).toContain("20:00");
  });

  it("describes a fixedTimes schedule with daysOfWeek and everyNDays", () => {
    const text = describeSchedule({
      kind: "fixedTimes",
      times: ["07:00"],
      daysOfWeek: [6],
      everyNDays: 2,
    });
    expect(text).toContain("07:00");
    expect(text).toContain("Sat");
    expect(text).toContain("every 2 days");
  });

  it("describes a fromLastDose schedule and carries the phrase 'from last dose'", () => {
    const text = describeSchedule({ kind: "fromLastDose", intervalHours: 8 });
    expect(text).toContain("from last dose");
  });
});

describe("courseProgress", () => {
  it("renders SPEC's 'day N of M' style for a fixedTimes course with an endDate", () => {
    // COURSE_CLOVER_METACAM: startDate 2026-08-06, endDate 2026-08-12.
    const course = fixtures.courses[0];
    expect(course.schedule.kind).toBe("fixedTimes");
    expect(courseProgress(course, "2026-08-08")).toBe("Day 3 of 7");
  });

  it("returns a non-numeric string for fromLastDose courses (no DoseEvent[] in this signature)", () => {
    const course = fixtures.courses.find((c) => c.schedule.kind === "fromLastDose")!;
    const text = courseProgress(course, "2026-08-08");
    expect(text).not.toMatch(/^Day \d/);
    expect(text).toContain("from last dose");
  });
});
