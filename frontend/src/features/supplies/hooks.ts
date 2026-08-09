// React Query hooks over the supplies slice of `Repo`. See
// CONTRACT-supplies.md's `features/supplies/hooks.ts` section — the house
// pattern is `features/pets/hooks.ts`.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Course, Medication, Pet, StockAdjustment } from "@/domain";
import { qk } from "@/domain";
import { getRepo } from "@/data";

/** Local key; domain/queryKeys.ts is frozen and has no stock-adjustment key. */
export const stockAdjustmentsKey = ["stockAdjustments"] as const;

/** Query options for every repo-backed query, per features/pets/hooks.ts's QUERY_OPTS. */
const QUERY_OPTS = { staleTime: 0, retry: false, refetchOnWindowFocus: true } as const;

export function useSupplyData(): {
  medications: Medication[];
  courses: Course[];
  pets: Pet[];
  adjustments: StockAdjustment[];
  isLoading: boolean;
  error: Error | null;
} {
  const medicationsQuery = useQuery({
    queryKey: qk.medications(),
    queryFn: () => getRepo().listMedications(),
    ...QUERY_OPTS,
  });
  const coursesQuery = useQuery({
    queryKey: qk.courses(),
    queryFn: () => getRepo().listCourses(),
    ...QUERY_OPTS,
  });
  const petsQuery = useQuery({
    queryKey: qk.pets(),
    queryFn: () => getRepo().listPets(),
    ...QUERY_OPTS,
  });
  const adjustmentsQuery = useQuery({
    queryKey: stockAdjustmentsKey,
    queryFn: () => getRepo().listStockAdjustments(),
    ...QUERY_OPTS,
  });

  const queries = [medicationsQuery, coursesQuery, petsQuery, adjustmentsQuery];
  const errored = queries.find((q) => q.error);

  return {
    medications: medicationsQuery.data ?? [],
    courses: coursesQuery.data ?? [],
    pets: petsQuery.data ?? [],
    adjustments: adjustmentsQuery.data ?? [],
    isLoading: queries.some((q) => q.isLoading),
    error: (errored?.error as Error | undefined) ?? null,
  };
}

export function useSetStockOnHand(): UseMutationResult<
  StockAdjustment,
  Error,
  { medicationId: string; units: number; note?: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    // Never pass `actorId` — the repo stamps it itself.
    mutationFn: ({ medicationId, units, note }) =>
      getRepo().setStockOnHand(medicationId, units, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.medications() });
      queryClient.invalidateQueries({ queryKey: stockAdjustmentsKey });
    },
  });
}

export function useAddPack(): UseMutationResult<
  StockAdjustment,
  Error,
  { medicationId: string; deltaUnits: number; note?: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    // Never pass `actorId` — the repo stamps it itself.
    mutationFn: ({ medicationId, deltaUnits, note }) =>
      getRepo().adjustStock({ medicationId, deltaUnits, reason: "purchase", note }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.medications() });
      queryClient.invalidateQueries({ queryKey: stockAdjustmentsKey });
    },
  });
}
