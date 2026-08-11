// The scheduling engine — public barrel. Implementations live in
// occurrences.ts (generation), state.ts (dose state + day summary), sweep.ts
// (missed-dose / course-finish candidates) and describe.ts (formatting).
// This file's export list is frozen: other branches compile against
// `import { … } from "@/engine"`, so no name here may be added, removed,
// renamed or widened without coordinating across those branches.
//
// WIDENED (coordinated, not a silent break): `EngineContext` now carries a
// required `courseEvents: CourseEvent[]`, and `nextDueAt` takes a new
// `courseEvents` parameter ahead of `after` — both needed so a forward-only
// `fixedTimes` schedule edit (SPEC §3c) can be reconstructed from the
// CourseEvent ledger instead of orphaning past occurrences. Every call site
// outside `frontend/src/engine/` must be updated to pass it; `npm run
// typecheck` finds them all. `scheduleTimelineFor`, the helper that reads
// the ledger, is intentionally NOT added here — it stays private to
// occurrences.ts and is exercised only through `getOccurrences`.
export { getOccurrences } from "./occurrences";
export { getDoseState, summariseDay } from "./state";
export { nextDueAt, findMissedOccurrences, findCoursesToFinish } from "./sweep";
export { describeSchedule, courseProgress } from "./describe";
export type {
  DoseState,
  Occurrence,
  EngineContext,
  ScheduleSegment,
  ScheduleDescription,
  CourseProgress,
} from "./engine.types";
