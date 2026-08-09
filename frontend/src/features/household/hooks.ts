// React Query hooks over the household slice of `Repo`, plus the signed-in
// session. Every household, onboarding and Pets-screen surface in slice 8 reads
// through these — no screen calls `getRepo()` directly, so the day W9 swaps a
// local read for a server round trip, it changes this file and nothing else.
//
// SPEC §9 / COMMON-W2 §3: the local store is the source of truth for reads. The
// backend endpoints in `backend/src/household/` are the same contract on the
// server side; wiring the background push/pull between them is slice 9's job.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { SessionUser } from "@pet-tracker/shared";
import type { Household, JoinCode, User } from "@/domain";
import {
  DEFAULT_SELF_DISPLAY_NAME,
  DISPLAY_NAME_MAX,
  JOIN_CODE_TTL_MS,
  generateJoinCode,
  now,
  qk,
} from "@/domain";
import { getRepo } from "@/data";
import { apiClient } from "@/shared/api";
import { JoinCodeRejectedError, evaluateJoinCode } from "./joinCode";

/**
 * Local key factory. `qk` in `@/domain` is frozen and has no household keys, so
 * these live here — every key is prefixed `["household"]` so one invalidation of
 * that prefix refreshes members, self, the household row and the live code.
 */
export const hqk = {
  all: () => ["household"] as const,
  household: () => ["household", "row"] as const,
  members: () => ["household", "members"] as const,
  self: () => ["household", "self"] as const,
  liveCode: () => ["household", "liveCode"] as const,
} as const;

const QUERY_OPTS = { staleTime: 0, retry: false, refetchOnWindowFocus: true } as const;

// Prefix-only invalidation keys, derived from the factories so a prefix can
// never drift. Renaming is retroactive (SPEC §5), so it must refresh every
// surface that renders a name through `displayNameFor` — history and Today
// included, which is why those two prefixes are here.
const PREFIX = {
  household: hqk.all(),
  events: qk.events({}).slice(0, 1),
  today: qk.today("1970-01-01").slice(0, 1),
} as const;

// --- queries -------------------------------------------------------------

/** The local household row. SPEC §2: `name` may be null; render "Home". */
export function useHousehold(): UseQueryResult<Household, Error> {
  return useQuery({
    queryKey: hqk.household(),
    queryFn: () => getRepo().getCurrentHousehold(),
    ...QUERY_OPTS,
  });
}

/**
 * Live members. Removed members are excluded here — SPEC §5 keeps their history
 * but they are no longer in the household. History resolves their name through
 * `useAllMembers()` instead.
 */
export function useMembers(): UseQueryResult<User[], Error> {
  return useQuery({
    queryKey: hqk.members(),
    queryFn: () => getRepo().listUsers(),
    ...QUERY_OPTS,
  });
}

/**
 * Every member the household has ever had, removed ones included. This is what
 * attribution must read: SPEC §12 requires a removed member's name to keep
 * rendering on their historical events.
 */
export function useAllMembers(): UseQueryResult<User[], Error> {
  return useQuery({
    queryKey: [...hqk.members(), "includeRemoved"] as const,
    queryFn: () => getRepo().listUsers({ includeRemoved: true }),
    ...QUERY_OPTS,
  });
}

/** The signed-in user's own member row. Never null — the repo mints one on demand. */
export function useSelf(): UseQueryResult<User, Error> {
  return useQuery({
    queryKey: hqk.self(),
    queryFn: () => getRepo().getCurrentUser(),
    ...QUERY_OPTS,
  });
}

/** SPEC §5: at most one live code per household. Null when none is live. */
export function useLiveJoinCode(): UseQueryResult<JoinCode | null, Error> {
  return useQuery({
    queryKey: hqk.liveCode(),
    queryFn: async () => liveJoinCode(),
    ...QUERY_OPTS,
  });
}

async function liveJoinCode(): Promise<JoinCode | null> {
  const at = now();
  const codes = await getRepo().listJoinCodes();
  const live = codes.filter((c) => evaluateJoinCode(c, at).ok);
  // Newest wins: issuing revokes the previous, so more than one live code is
  // never expected, but a tie is resolved rather than left to array order.
  live.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return live[0] ?? null;
}

/**
 * The signed-in address, from the auth layer — NOT from `User.email`, which the
 * repo leaves null. SPEC §5/§12: exactly one line in the whole UI may render
 * this (the Your-name reassurance), and it renders nothing when the session has
 * not resolved. No other component may call this hook.
 */
export function useSessionEmail(): string | null {
  const query = useQuery({
    queryKey: qk.session(),
    queryFn: () => apiClient<SessionUser>("/auth/me"),
    retry: false,
    staleTime: Infinity,
  });
  return query.data?.email ?? null;
}

// --- mutations -----------------------------------------------------------

function useHouseholdMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
): UseMutationResult<TResult, Error, TArgs> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PREFIX.household });
      queryClient.invalidateQueries({ queryKey: PREFIX.events });
      queryClient.invalidateQueries({ queryKey: PREFIX.today });
    },
  });
}

/**
 * SPEC §5: renaming is retroactive. Nothing is rewritten — history stores
 * `actorId` — so this is a single row update plus the invalidations above.
 */
export function useSetDisplayName(): UseMutationResult<User, Error, string> {
  return useHouseholdMutation(async (displayName: string) => {
    const trimmed = displayName.trim().slice(0, DISPLAY_NAME_MAX);
    const self = await getRepo().getCurrentUser();
    return getRepo().updateUser(self.id, { displayName: trimmed });
  });
}

/**
 * SPEC §5: issuing a new code revokes the previous one. The repo's
 * `createJoinCode` performs that revocation, which is why this never revokes
 * by hand first.
 */
export function useIssueJoinCode(): UseMutationResult<JoinCode, Error, void> {
  return useHouseholdMutation(async () =>
    getRepo().createJoinCode({
      code: generateJoinCode(),
      expiresAt: new Date(now().getTime() + JOIN_CODE_TTL_MS).toISOString(),
    }),
  );
}

/**
 * SPEC §5: any member can remove another. There is no permission check because
 * there are no permissions. Soft-delete only — the removed member's `actorId`
 * and name keep resolving on their past events.
 */
export function useRemoveMember(): UseMutationResult<void, Error, string> {
  return useHouseholdMutation(async (userId: string) => getRepo().removeUser(userId));
}

/**
 * SPEC §5: any member can leave. The caller is responsible for having taken an
 * explicit confirmation first, and for passing `deletesHousehold` when this is
 * the last member — see `leaveDeletesHousehold` below.
 */
export function useLeaveHousehold(): UseMutationResult<void, Error, void> {
  return useHouseholdMutation(async () => {
    const self = await getRepo().getCurrentUser();
    return getRepo().removeUser(self.id);
  });
}

/** SPEC §5: the last member leaving deletes the household. */
export function leaveDeletesHousehold(members: readonly User[]): boolean {
  return members.length <= 1;
}

/**
 * SPEC §5 step 4: redeem, once. Every refusal SPEC §5 names is decided here
 * rather than in the screen, so the screen cannot accidentally allow one.
 */
export function useRedeemJoinCode(): UseMutationResult<JoinCode, Error, string> {
  return useHouseholdMutation(async (raw: string) => {
    const code = raw.trim().toUpperCase();
    const repo = getRepo();
    const row = await repo.getJoinCodeByCode(code);
    const verdict = evaluateJoinCode(row, now());
    if (!verdict.ok || !row) {
      throw new JoinCodeRejectedError(verdict.ok ? "not_found" : verdict.reason);
    }
    const self = await repo.getCurrentUser();
    if (row.householdId === self.householdId) {
      throw new JoinCodeRejectedError("already_in_household");
    }
    return repo.markJoinCodeUsed(row.id, self.id);
  });
}

// --- pure helpers --------------------------------------------------------

/**
 * SPEC §5: the display name is "required before the first invite is issued".
 * True while the user is still carrying the placeholder the repo minted, or a
 * blank name — the two cases where nothing meaningful would be attributed.
 */
export function needsDisplayName(user: Pick<User, "displayName"> | null | undefined): boolean {
  if (!user) {
    return true;
  }
  const trimmed = user.displayName.trim();
  return trimmed.length === 0 || trimmed === DEFAULT_SELF_DISPLAY_NAME;
}
