// The scheduling engine — public barrel. Implementations live in
// occurrences.ts (generation), state.ts (dose state + day summary), sweep.ts
// (missed-dose / course-finish candidates) and describe.ts (formatting).
// This file's export list is frozen: other branches compile against
// `import { … } from "@/engine"`, so no name here may be added, removed,
// renamed or widened without coordinating across those branches.
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
