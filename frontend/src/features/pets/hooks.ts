// React Query hooks over the pets slice of `Repo`. See CONTRACT.md §3.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Pet } from "@/domain";
import { qk } from "@/domain";
import { getRepo, type Repo } from "@/data";

export type CreatePetInput = Parameters<Repo["createPet"]>[0];
export type UpdatePetPatch = Parameters<Repo["updatePet"]>[1];

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

export function usePets(opts?: { includeArchived?: boolean }): UseQueryResult<Pet[], Error> {
  return useQuery({
    queryKey: qk.pets(),
    queryFn: () => getRepo().listPets(opts),
    ...QUERY_OPTS,
  });
}

export function usePet(id: string | undefined): UseQueryResult<Pet | null, Error> {
  return useQuery({
    queryKey: qk.pet(id ?? ""),
    queryFn: () => getRepo().getPet(id as string),
    enabled: !!id,
    ...QUERY_OPTS,
  });
}

export function useCreatePet(): UseMutationResult<Pet, Error, CreatePetInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePetInput) => getRepo().createPet(input),
    onSuccess: (pet) => {
      queryClient.invalidateQueries({ queryKey: PREFIX.pets });
      queryClient.invalidateQueries({ queryKey: qk.pet(pet.id) });
    },
  });
}

export function useUpdatePet(): UseMutationResult<
  Pet,
  Error,
  { id: string; patch: UpdatePetPatch }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => getRepo().updatePet(id, patch),
    onSuccess: (pet) => {
      queryClient.invalidateQueries({ queryKey: PREFIX.pets });
      queryClient.invalidateQueries({ queryKey: qk.pet(pet.id) });
    },
  });
}

export function useSetPetArchived(): UseMutationResult<
  Pet,
  Error,
  { id: string; archived: boolean }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }) => getRepo().setPetArchived(id, archived),
    onSuccess: (pet) => {
      queryClient.invalidateQueries({ queryKey: PREFIX.pets });
      queryClient.invalidateQueries({ queryKey: qk.pet(pet.id) });
    },
  });
}
