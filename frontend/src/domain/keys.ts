import type { IsoDateTime } from "./types";

/**
 * Canonical occurrenceKey format — `${courseId}|${scheduledFor ?? "-"}`.
 * This is the idempotence key for the missed-dose sweep and is indexed by
 * the data worker; every construction site in the app must build it through
 * this function so the shape can never drift between call sites.
 */
export function occurrenceKeyFor(courseId: string, scheduledFor: IsoDateTime | null): string {
  return `${courseId}|${scheduledFor ?? "-"}`;
}
