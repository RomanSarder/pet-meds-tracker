// One `qk` factory so cross-feature cache invalidation needs no cross-feature
// ownership. Every key is a readonly tuple (`as const`) so TanStack Query v5
// accepts it directly as a QueryKey.
import type { CourseStatus, IsoDateTime, LocalDate } from "./types";

export interface CourseFilter {
  petId?: string;
  medicationId?: string;
  status?: CourseStatus[];
}

export interface EventFilter {
  courseId?: string;
  courseIds?: string[];
  from?: IsoDateTime;
  to?: IsoDateTime;
  limit?: number;
  newestFirst?: boolean;
}

export const qk = {
  session: () => ["session"] as const,
  pets: () => ["pets"] as const,
  pet: (id: string) => ["pets", id] as const,
  medications: () => ["medications"] as const,
  courses: (filter?: CourseFilter) => ["courses", filter] as const,
  course: (id: string) => ["courses", id] as const,
  events: (filter: EventFilter) => ["events", filter] as const,
  courseEvents: (filter: EventFilter) => ["courseEvents", filter] as const,
  today: (day: LocalDate) => ["today", day] as const,
  // SPEC §5 sharing (slice 8). Every key below is prefixed ["household"], so one
  // invalidation of `qk.household()` refreshes the row, the members, self and the
  // live join code together.
  household: () => ["household"] as const,
  householdRow: () => ["household", "row"] as const,
  householdMembers: (opts?: { includeRemoved?: boolean }) =>
    ["household", "members", opts] as const,
  householdSelf: () => ["household", "self"] as const,
  /** The server-side roster refresh (`useRefreshMembers`), not a member list itself. */
  householdRoster: () => ["household", "roster"] as const,
  householdLiveCode: () => ["household", "liveCode"] as const,
  householdJoinPreview: (code: string) => ["household", "joinPreview", code] as const,
};
