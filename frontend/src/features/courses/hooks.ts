// React Query hooks over the medications/courses/dose-events slice of `Repo`.
// See CONTRACT.md §3.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  Course,
  CourseFilter,
  CourseStatus,
  DoseEvent,
  EventFilter,
  LocalDate,
  Medication,
  Schedule,
} from "@/domain";
import { qk } from "@/domain";
import { getRepo, type Repo } from "@/data";

export type UpdateCoursePatch = Parameters<Repo["updateCourse"]>[1];

/** Query options for every repo-backed query, per CONTRACT.md §3. */
const QUERY_OPTS = { staleTime: 0, retry: false, refetchOnWindowFocus: true } as const;

// Prefix-only invalidation keys, DERIVED from `qk` so the prefix can never drift
// from the factory. `qk.courses()` itself is ["courses", undefined], which does
// not partial-match ["courses", { petId }] — only the bare prefix does.
const PREFIX = {
  pets: qk.pets(),
  medications: qk.medications(),
  courses: qk.courses().slice(0, 1),
  events: qk.events({}).slice(0, 1),
  today: qk.today("1970-01-01").slice(0, 1),
} as const;

export function useCourses(filter?: CourseFilter): UseQueryResult<Course[], Error> {
  return useQuery({
    queryKey: qk.courses(filter),
    queryFn: () => getRepo().listCourses(filter),
    ...QUERY_OPTS,
  });
}

export function useCourse(id: string | undefined): UseQueryResult<Course | null, Error> {
  return useQuery({
    queryKey: qk.course(id ?? ""),
    queryFn: () => getRepo().getCourse(id as string),
    enabled: !!id,
    ...QUERY_OPTS,
  });
}

export function useMedications(): UseQueryResult<Medication[], Error> {
  return useQuery({
    queryKey: qk.medications(),
    queryFn: () => getRepo().listMedications(),
    ...QUERY_OPTS,
  });
}

export function useDoseEvents(filter: EventFilter): UseQueryResult<DoseEvent[], Error> {
  return useQuery({
    queryKey: qk.events(filter),
    queryFn: () => getRepo().listDoseEvents(filter),
    ...QUERY_OPTS,
  });
}

export interface SaveCourseInput {
  petId: string;
  medicationName: string;
  doseAmount: number;
  doseUnit: string;
  instructions: string | null;
  schedule: Schedule;
  startDate: LocalDate;
  endDate: LocalDate | null;
}

/** findMedicationByName → reuse, else createMedication, THEN createCourse. */
export function useSaveCourse(): UseMutationResult<Course, Error, SaveCourseInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveCourseInput) => {
      const repo = getRepo();
      const existing = await repo.findMedicationByName(input.medicationName);
      // SPEC §5.5's course form offers no dosage-form picker, so "other" is
      // the honest value for a newly-created medication here rather than a guess.
      const med =
        existing ??
        (await repo.createMedication({
          name: input.medicationName,
          form: "other",
          unit: input.doseUnit,
        }));
      return repo.createCourse({
        petId: input.petId,
        medicationId: med.id,
        doseAmount: input.doseAmount,
        doseUnit: input.doseUnit,
        instructions: input.instructions,
        schedule: input.schedule,
        startDate: input.startDate,
        endDate: input.endDate,
        notes: null,
      });
    },
    onSuccess: () => {
      // Pets roster shows per-pet active course badges, so a saved course
      // must also invalidate PREFIX.pets, on top of the usual course fan-out.
      queryClient.invalidateQueries({ queryKey: PREFIX.courses });
      queryClient.invalidateQueries({ queryKey: PREFIX.today });
      queryClient.invalidateQueries({ queryKey: PREFIX.events });
      queryClient.invalidateQueries({ queryKey: PREFIX.medications });
      queryClient.invalidateQueries({ queryKey: PREFIX.pets });
    },
  });
}

export function useUpdateCourse(): UseMutationResult<
  Course,
  Error,
  { id: string; patch: UpdateCoursePatch }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => getRepo().updateCourse(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PREFIX.courses });
      queryClient.invalidateQueries({ queryKey: PREFIX.today });
      queryClient.invalidateQueries({ queryKey: PREFIX.events });
    },
  });
}

export function useSetCourseStatus(): UseMutationResult<
  Course,
  Error,
  { id: string; status: CourseStatus }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }) => getRepo().setCourseStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PREFIX.courses });
      queryClient.invalidateQueries({ queryKey: PREFIX.today });
      queryClient.invalidateQueries({ queryKey: PREFIX.events });
    },
  });
}
