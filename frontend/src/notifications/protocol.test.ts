// The page/worker message contract: runtime validation of a `postMessage`
// payload (never trust it, even though `sw.js` only ever sends well-formed
// ones), and the cold-start URL encoding that round-trips a `DoseRef`
// through `clients.openWindow` and back.
import { describe, expect, it } from "vitest";
import {
  ACTION_PARAM,
  AMOUNT_PARAM,
  buildActionUrl,
  COURSE_PARAM,
  isActionMessage,
  MSG_ACTION,
  parseActionUrl,
  SCHEDULED_PARAM,
} from "./protocol";
import type { DoseRef } from "./types";

const FIXED_TIMES_DOSE: DoseRef = {
  occurrenceKey: "course-1|2026-08-08T07:00:00.000Z",
  courseId: "course-1",
  scheduledFor: "2026-08-08T07:00:00.000Z",
  amount: 0.4,
};

const FROM_LAST_DOSE_DOSE: DoseRef = {
  occurrenceKey: "course-2|-",
  courseId: "course-2",
  scheduledFor: null,
  amount: 0.5,
};

describe("isActionMessage", () => {
  it("accepts a well-formed message", () => {
    expect(
      isActionMessage({ type: MSG_ACTION, action: "give", dose: FIXED_TIMES_DOSE }),
    ).toBe(true);
    expect(
      isActionMessage({ type: MSG_ACTION, action: "snooze", dose: FROM_LAST_DOSE_DOSE }),
    ).toBe(true);
  });

  it("rejects null", () => {
    expect(isActionMessage(null)).toBe(false);
  });

  it("rejects a string", () => {
    expect(isActionMessage("petmeds/action")).toBe(false);
  });

  it("rejects a wrong type", () => {
    expect(isActionMessage({ type: "petmeds/show", action: "give", dose: FIXED_TIMES_DOSE })).toBe(
      false,
    );
  });

  it("rejects a missing dose", () => {
    expect(isActionMessage({ type: MSG_ACTION, action: "give" })).toBe(false);
  });

  it("rejects a blank dose", () => {
    expect(
      isActionMessage({
        type: MSG_ACTION,
        action: "give",
        dose: { occurrenceKey: "", courseId: "", scheduledFor: null, amount: 0.4 },
      }),
    ).toBe(false);
  });

  it("rejects a non-numeric amount", () => {
    expect(
      isActionMessage({
        type: MSG_ACTION,
        action: "give",
        dose: { ...FIXED_TIMES_DOSE, amount: "0.4" },
      }),
    ).toBe(false);
  });

  it("rejects an unknown action", () => {
    expect(isActionMessage({ type: MSG_ACTION, action: "dismiss", dose: FIXED_TIMES_DOSE })).toBe(
      false,
    );
  });
});

describe("buildActionUrl / parseActionUrl", () => {
  it("round-trips a fixedTimes dose with an ISO scheduledFor", () => {
    const url = buildActionUrl("https://example.com", "give", FIXED_TIMES_DOSE);
    const parsed = parseActionUrl(new URL(url).search);
    expect(parsed).toEqual({ action: "give", dose: FIXED_TIMES_DOSE });
  });

  it("round-trips a fromLastDose dose, encoding null scheduledFor as \"-\"", () => {
    const url = buildActionUrl("https://example.com", "snooze", FROM_LAST_DOSE_DOSE);
    const parsedUrl = new URL(url);
    expect(parsedUrl.searchParams.get(SCHEDULED_PARAM)).toBe("-");
    const parsed = parseActionUrl(parsedUrl.search);
    expect(parsed).toEqual({ action: "snooze", dose: FROM_LAST_DOSE_DOSE });
  });

  it("returns null for an empty search", () => {
    expect(parseActionUrl("")).toBeNull();
  });

  it("returns null for a foreign query string", () => {
    expect(parseActionUrl("?utm_source=newsletter&ref=abc")).toBeNull();
  });

  it("returns null when the action is missing or unknown", () => {
    expect(
      parseActionUrl(`?${COURSE_PARAM}=course-1&${SCHEDULED_PARAM}=-&${AMOUNT_PARAM}=0.4`),
    ).toBeNull();
    expect(
      parseActionUrl(
        `?${ACTION_PARAM}=dismiss&${COURSE_PARAM}=course-1&${SCHEDULED_PARAM}=-&${AMOUNT_PARAM}=0.4`,
      ),
    ).toBeNull();
  });

  it("returns null when courseId is missing or blank", () => {
    expect(
      parseActionUrl(`?${ACTION_PARAM}=give&${SCHEDULED_PARAM}=-&${AMOUNT_PARAM}=0.4`),
    ).toBeNull();
    expect(
      parseActionUrl(
        `?${ACTION_PARAM}=give&${COURSE_PARAM}=&${SCHEDULED_PARAM}=-&${AMOUNT_PARAM}=0.4`,
      ),
    ).toBeNull();
  });

  it("returns null when scheduledFor is missing or not \"-\" nor a parseable date", () => {
    expect(
      parseActionUrl(`?${ACTION_PARAM}=give&${COURSE_PARAM}=course-1&${AMOUNT_PARAM}=0.4`),
    ).toBeNull();
    expect(
      parseActionUrl(
        `?${ACTION_PARAM}=give&${COURSE_PARAM}=course-1&${SCHEDULED_PARAM}=not-a-date&${AMOUNT_PARAM}=0.4`,
      ),
    ).toBeNull();
  });

  it("returns null when amount is missing or non-numeric", () => {
    expect(
      parseActionUrl(`?${ACTION_PARAM}=give&${COURSE_PARAM}=course-1&${SCHEDULED_PARAM}=-`),
    ).toBeNull();
    expect(
      parseActionUrl(
        `?${ACTION_PARAM}=give&${COURSE_PARAM}=course-1&${SCHEDULED_PARAM}=-&${AMOUNT_PARAM}=abc`,
      ),
    ).toBeNull();
  });

  it("never throws on a malformed search string", () => {
    expect(() => parseActionUrl("not even a query string %%%")).not.toThrow();
    expect(parseActionUrl("not even a query string %%%")).toBeDefined();
  });
});
