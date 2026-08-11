// React Query hooks over the household slice of `Repo`, plus the signed-in
// session. Every household, onboarding and Pets-screen surface in slice 8 reads
// through these — no screen calls `getRepo()` directly, so the day W9 swaps a
// local read for a server round trip, it changes this file and nothing else.
//
// SPEC §9 / COMMON-W2 §3: the local store is the source of truth for reads. The
// backend endpoints in `backend/src/household/` are the same contract on the
// server side; wiring the background push/pull between them is slice 9's job.
import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { HouseholdStateDto, JoinCodeDto, SessionUser } from "@pet-tracker/shared";
import type { Household, JoinCode, Pet, User } from "@/domain";
import { DEFAULT_SELF_DISPLAY_NAME, DISPLAY_NAME_MAX, JOIN_CODE_LENGTH, now, qk } from "@/domain";
import { getRepo } from "@/data";
import { apiClient, ApiError } from "@/shared/api";
import { JoinCodeRejectedError, evaluateJoinCode, type JoinCodeRejection } from "./joinCode";

// Household query keys live in the shared `qk` factory in `@/domain`, appended at
// the end of that object — cross-feature cache invalidation must not need
// cross-feature ownership, and history (W6) invalidates the same prefix when a
// rename has to re-render past events.

const QUERY_OPTS = { staleTime: 0, retry: false, refetchOnWindowFocus: true } as const;

// Prefix-only invalidation keys, derived from the factories so a prefix can
// never drift. Renaming is retroactive (SPEC §5), so it must refresh every
// surface that renders a name through `displayNameFor` — history and Today
// included, which is why those two prefixes are here.
const PREFIX = {
  household: qk.household(),
  // Narrower than `household` on purpose — `useRefreshMembers` invalidates
  // this one and must not invalidate the roster query it is itself driven by.
  members: qk.householdMembers().slice(0, 2),
  events: qk.events({}).slice(0, 1),
  today: qk.today("1970-01-01").slice(0, 1),
} as const;

// --- queries -------------------------------------------------------------

/** The local household row. SPEC §2: `name` may be null; render "Home". */
export function useHousehold(): UseQueryResult<Household, Error> {
  return useQuery({
    queryKey: qk.householdRow(),
    queryFn: () => getRepo().getCurrentHousehold(),
    ...QUERY_OPTS,
  });
}

/**
 * Live members. Removed members are excluded here — SPEC §5 keeps their history
 * but they are no longer in the household. History resolves their name through
 * `useAllMembers()` instead.
 *
 * Stays a pure local read (SPEC §9, and the no-network-on-render invariant
 * `sync/__tests__/offlineRender.test.tsx` pins). Members reach this store from
 * the server through `useRefreshMembers` below, never by this hook awaiting a
 * round trip on the render path.
 */
export function useMembers(): UseQueryResult<User[], Error> {
  return useQuery({
    queryKey: qk.householdMembers(),
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
    queryKey: qk.householdMembers({ includeRemoved: true }),
    queryFn: () => getRepo().listUsers({ includeRemoved: true }),
    ...QUERY_OPTS,
  });
}

/**
 * Members are the one part of the household this device cannot learn on its
 * own. `SyncPayload` carries six tables and `users` is not among them (see
 * `packages/shared/src/sync.ts`), so nobody who joins ever reaches this
 * device's local store through the sync cycle — which is why the People list
 * sat at one person forever no matter who redeemed a code.
 *
 * This closes that gap the narrow way: the screen whose subject IS the roster
 * mounts this, the server's list is mirrored into the local store, and the
 * member queries above are invalidated only when something actually changed.
 * The read source stays local, so nothing here can blank a screen that was
 * already rendering — a failed refresh leaves the previous roster standing.
 *
 * The durable fix is `users` becoming a synced table like the other six, which
 * needs a `sync_seq` column on `users` and a soft-delete flag; until then this
 * is the only path by which a second member exists on this device at all.
 */
export function useRefreshMembers(): void {
  const queryClient = useQueryClient();
  const { data: changed } = useQuery({
    queryKey: qk.householdRoster(),
    queryFn: refreshMembersFromServer,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (changed) {
      // Deliberately the members prefix and not `PREFIX.household`, which
      // covers this very query — invalidating that would refetch the roster,
      // which would invalidate again.
      queryClient.invalidateQueries({ queryKey: PREFIX.members });
    }
  }, [changed, queryClient]);
}

/** Resolves to true when the local store gained or changed a member row. */
async function refreshMembersFromServer(): Promise<boolean> {
  let state: HouseholdStateDto;
  try {
    state = await apiClient<HouseholdStateDto>("/household");
  } catch {
    // Offline, no session yet, or no server-side household at all (the
    // first-run window before `POST /household`). None of those are worth
    // surfacing — the local roster is still the right thing to show.
    return false;
  }
  return mirrorMembers(state);
}

/**
 * Writes `state.members` into the local user store.
 *
 * Skips the member row that IS this device. `users.id` on the server is the
 * auth identity minted against an email address, while the local self row is a
 * device-minted uuid (see `idbRepo`'s `currentActorId`) — and it is the local
 * one every `actorId` in the ledger points at. Mirroring the server's row for
 * self would show you twice rather than reconciling anything.
 *
 * Additive only. A member missing from the server list is left alone rather
 * than soft-deleted: removal has its own explicit path (`useRemoveMember`), and
 * a local row the server does not know is just as likely to be a name restored
 * from a backup, which SPEC §12 needs kept so their past events still render a
 * name.
 */
async function mirrorMembers(state: HouseholdStateDto): Promise<boolean> {
  // The DTO is defensively shape-checked rather than trusted: this runs on a
  // response that may be a 200 from something other than this endpoint (a
  // captive-portal login page, a stale service worker), and a roster that
  // throws here would take the People list down with it.
  if (!state || !Array.isArray(state.members)) {
    return false;
  }

  const repo = getRepo();
  const householdId = await repo.currentHouseholdId();
  const self = await repo.getCurrentUser();
  const existing = await repo.listUsers({ includeRemoved: true });
  const byId = new Map(existing.map((u) => [u.id, u]));
  const ts = now().toISOString();
  let changed = false;

  for (const member of state.members) {
    if (member.id === state.self?.id || member.id === self.id) {
      continue;
    }
    const local = byId.get(member.id);
    if (local?.isSelf) {
      continue;
    }
    // Skip the write when nothing the server owns has changed, so a poll on
    // every window focus does not churn `updatedAt` on untouched rows — and,
    // more importantly, does not report a change that would re-invalidate the
    // member queries on every focus forever.
    if (local && local.displayName === member.displayName && local.tint === member.tint) {
      continue;
    }
    await repo.upsertUser({
      id: member.id,
      householdId,
      email: null,
      displayName: member.displayName,
      tint: member.tint,
      isSelf: false,
      joinedAt: member.joinedAt,
      createdAt: local?.createdAt ?? member.joinedAt,
      updatedAt: ts,
      deletedAt: local?.deletedAt ?? null,
    });
    changed = true;
  }

  return changed;
}

/** The signed-in user's own member row. Never null — the repo mints one on demand. */
export function useSelf(): UseQueryResult<User, Error> {
  return useQuery({
    queryKey: qk.householdSelf(),
    queryFn: () => getRepo().getCurrentUser(),
    ...QUERY_OPTS,
  });
}

/** SPEC §5: at most one live code per household. Null when none is live. */
export function useLiveJoinCode(): UseQueryResult<JoinCode | null, Error> {
  return useQuery({
    queryKey: qk.householdLiveCode(),
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

/**
 * SPEC §5 step 3: the joiner is shown the pets they are about to get access
 * to *before* joining. Resolves the entered code through the exact same
 * `evaluateJoinCode` gate `useRedeemJoinCode` uses, but never mutates
 * anything. Disabled until a full-length code is typed; `null` covers both
 * "not enough characters yet" and "no usable code found", so the screen
 * falls back to the same quiet prompt either way — the refusal *reason* is
 * only ever surfaced by pressing Join (SPEC §5: "not on the last
 * keystroke"), never merely by typing.
 *
 * CONTRACT-W8.md §0: the frontend only ever talks to the local repo, which
 * models a single household. `getRepo().listPets()` therefore stands in for
 * "the pets of the household behind this code" in this slice; wiring a real
 * cross-household lookup against the server is slice 9.
 */
export function useJoinPreview(rawCode: string): UseQueryResult<Pet[] | null, Error> {
  const code = rawCode.trim().toUpperCase();
  return useQuery({
    queryKey: qk.householdJoinPreview(code),
    queryFn: async () => {
      const repo = getRepo();
      const row = await repo.getJoinCodeByCode(code);
      const verdict = evaluateJoinCode(row, now());
      if (!verdict.ok) {
        return null;
      }
      return repo.listPets();
    },
    enabled: code.length === JOIN_CODE_LENGTH,
    ...QUERY_OPTS,
  });
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
 * SPEC §5: issuing a new code revokes the previous one — enforced server-side
 * now (W8's `POST /household/codes`), since a code must be redeemable by a
 * DIFFERENT device that has no way to read this device's local `joinCodes`
 * store. The local row this mirrors the server's response into is what
 * `useLiveJoinCode`/the Invite card actually render (SPEC §9: local store is
 * the read source) — the server row is what `/household/join` checks.
 */
export function useIssueJoinCode(): UseMutationResult<JoinCode, Error, void> {
  return useHouseholdMutation(async () => {
    const dto = await apiClient<JoinCodeDto>("/household/codes", { method: "POST" });
    return getRepo().createJoinCode({ code: dto.code, expiresAt: dto.expiresAt });
  });
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
 * SPEC §9: stable, matching ids on both sides. `POST /household/join`
 * resolves to the household the code belongs to — normally a different id
 * than the solo household this device already minted for itself before
 * signing in (the local-open stub every fresh IndexedDB gets). This mirrors
 * that household's row, and this device's own member row, into the local
 * store under the SERVER's id: the mirror image of `FirstRunPage`'s
 * provisioning, which sends the LOCAL id to the server because nothing
 * existed there yet. Here the household already exists server-side, so the
 * local id is the one that has to give way.
 *
 * MUST go through `importHousehold(..., "replace")`, not `"merge"`: both
 * repos treat "which household is current" and `meta.householdId` as a pair
 * that has to move together (see `memoryRepo`'s `currentHouseholdId` — the
 * moment the two disagree it self-heals by MINTING A THIRD, random
 * household, which is worse than doing nothing). Only `"replace"` updates
 * both atomically; `"merge"` only ever inserts-or-updates rows and never
 * repoints which one is current, so it cannot switch identity at all. To
 * avoid "replace"'s normal cost — it clears every store first — this
 * round-trips every entity this device already has, unchanged, back through
 * the same call, so the net effect on everything except the household/self
 * identity is a no-op. The one honest gap: `listPets`/`listMedications`/
 * `listCourses` cannot return soft-deleted rows (no Repo method exposes
 * them), so a device with prior LOCAL tombstones for those three tables
 * loses them here — for the flow this exists for (a freshly signed-in
 * device joining a household it has never touched before), there is
 * nothing to lose.
 */
async function adoptJoinedHousehold(state: HouseholdStateDto, displayName?: string): Promise<void> {
  const repo = getRepo();
  const localHouseholdId = await repo.currentHouseholdId();
  const self = await repo.getCurrentUser();
  const ts = now().toISOString();
  const trimmedName = displayName?.trim();
  const nextDisplayName = trimmedName ? trimmedName : self.displayName;

  if (state.household.id === localHouseholdId) {
    // Already the same household locally (e.g. a retried join after a
    // previous attempt already adopted it) — nothing to re-key, only the
    // name might still need saving.
    if (nextDisplayName !== self.displayName) {
      await repo.updateUser(self.id, { displayName: nextDisplayName });
    }
    await mirrorMembers(state);
    return;
  }

  const household: Household = {
    id: state.household.id,
    name: state.household.name,
    createdAt: state.household.createdAt,
    updatedAt: ts,
    deletedAt: null,
  };
  const updatedSelf: User = {
    ...self,
    householdId: household.id,
    displayName: nextDisplayName,
    updatedAt: ts,
  };

  const [users, pets, medications, courses, doseEvents, courseEvents, stockAdjustments] = await Promise.all([
    repo.listUsers({ includeRemoved: true }),
    repo.listPets({ includeArchived: true }),
    repo.listMedications(),
    repo.listCourses(),
    repo.listDoseEvents({}),
    repo.listCourseEvents({}),
    repo.listStockAdjustments(),
  ]);
  // The people already in the household this device is joining. `state.members`
  // is the only place they are ever named — without this the joiner adopts the
  // household and still sees a roster of one, the mirror image of the inviter's
  // side. Self is excluded for the same identity reason as `mirrorMembers`: the
  // server's row for this device is the auth user, not the local actor.
  const serverMembers: User[] = state.members
    .filter((m) => m.id !== state.self.id && m.id !== self.id)
    .map((m) => ({
      id: m.id,
      householdId: household.id,
      email: null,
      displayName: m.displayName,
      tint: m.tint,
      isSelf: false,
      joinedAt: m.joinedAt,
      createdAt: m.joinedAt,
      updatedAt: ts,
      deletedAt: null,
    }));
  const serverMemberIds = new Set(serverMembers.map((u) => u.id));
  const otherUsers = users.filter((u) => u.id !== self.id && !serverMemberIds.has(u.id));

  await repo.importHousehold(
    {
      schemaVersion: (await repo.getMeta("schemaVersion")) ?? 2,
      exportedAt: ts,
      households: [household],
      users: [updatedSelf, ...serverMembers, ...otherUsers],
      pets,
      medications,
      courses,
      doseEvents,
      courseEvents,
      stockAdjustments,
    },
    "replace",
  );
}

/**
 * SPEC §5 step 4: redeem, once, against the server — `POST /household/join`
 * (W8) is the sole authority on single-use, 24h expiry, and "a newer code was
 * issued", exactly because a code must be checked against what OTHER devices
 * have done to it, which this device's local `joinCodes` store cannot see.
 * `evaluateJoinCode`/`JoinCodeRejectedError` still translate the refusal
 * reason into the same screen-facing error they always have, so
 * `JoinHouseholdPage`'s rendering of a refusal needed no change.
 */
export function useRedeemJoinCode(): UseMutationResult<
  HouseholdStateDto,
  Error,
  { code: string; displayName?: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ code: raw, displayName }: { code: string; displayName?: string }) => {
      const code = raw.trim().toUpperCase();
      let state: HouseholdStateDto;
      try {
        state = await apiClient<HouseholdStateDto>("/household/join", {
          method: "POST",
          body: JSON.stringify({ code, displayName: displayName?.trim() || undefined }),
        });
      } catch (err) {
        if (
          err instanceof ApiError &&
          err.data.error === "join_code_rejected" &&
          typeof err.data.reason === "string"
        ) {
          throw new JoinCodeRejectedError(err.data.reason as JoinCodeRejection);
        }
        // Anything else (network down, an unexpected 5xx) is a genuine
        // failure, not a redemption refusal — the caller must see it as an
        // error rather than have the join silently proceed locally.
        throw err;
      }
      await adoptJoinedHousehold(state, displayName);
      return state;
    },
    // Broader than `useHouseholdMutation`'s fixed household/events/today
    // prefixes on purpose — adopting a joined household can change the
    // household id itself (unlike every other mutation on this page), so
    // every query backed by `getRepo()` needs a refetch, not just the
    // household-shaped ones. Mirrors `SettingsPage`'s recovery after a
    // merge-mode backup restore, the other place local identity can shift
    // under a live query cache.
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
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
