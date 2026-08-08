import { describe, it, expect } from "vitest";
import { occurrenceKeyFor } from "./keys";

describe("occurrenceKeyFor", () => {
  it("joins courseId and scheduledFor with a pipe when scheduledFor is set", () => {
    expect(occurrenceKeyFor("course-1", "2026-08-06T07:00:00.000Z")).toBe(
      "course-1|2026-08-06T07:00:00.000Z",
    );
  });

  it("falls back to \"-\" when scheduledFor is null", () => {
    expect(occurrenceKeyFor("course-1", null)).toBe("course-1|-");
  });
});
