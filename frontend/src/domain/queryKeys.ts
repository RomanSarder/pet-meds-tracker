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
};
