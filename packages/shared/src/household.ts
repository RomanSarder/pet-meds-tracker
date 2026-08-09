// SPEC §2 / §5 — the sharing wire contract. Both the Fastify backend and the
// React frontend compile against these types, which is the only reason the two
// sides cannot drift.
//
// TYPES ONLY. This package's `exports` map points runtime consumers at
// `./dist/index.js`, which is not built during `vite build` or `vitest run`, so
// nothing here may be a value — no enums, no consts, no functions. Behaviour
// that both sides need (join-code evaluation) is implemented once per side
// against the shared *types*, and each implementation is tested on its own side.

/** SPEC §2 Household. `name` is optional; clients render "Home" when it is null. */
export interface HouseholdDto {
  id: string;
  name: string | null;
  createdAt: string;
}

/**
 * SPEC §2 User, as seen by *other* members.
 *
 * There is deliberately no `email` field. SPEC §5/§12: an address is never shown
 * to anyone else in the household, so it never crosses the wire to them either —
 * the shape enforces it rather than the caller remembering. The signed-in user's
 * own address arrives on `SelfDto` alone.
 *
 * There is also deliberately no `role` and no `isOwner`. SPEC §5: "Every member
 * has identical rights… There is no owner and no read-only role." Do not add one.
 */
export interface MemberDto {
  id: string;
  householdId: string;
  /** SPEC §5: 1–24 characters, required, need not be unique. */
  displayName: string;
  /** Same 1–4 palette as pets, assigned on join. */
  tint: 1 | 2 | 3 | 4;
  joinedAt: string;
}

/**
 * The signed-in user's own record. The one and only shape carrying `email`, and
 * the one and only place the UI may render it — the Your-name reassurance line
 * (SPEC §6.5). `householdId` is null for a user who has signed in but not yet
 * created or joined a household (SPEC §6.9 first run).
 */
export interface SelfDto extends Omit<MemberDto, "householdId"> {
  householdId: string | null;
  email: string;
}

/** SPEC §2/§5: six uppercase chars excluding O/0/I/1, 24 h, single use, one live per household. */
export interface JoinCodeDto {
  id: string;
  householdId: string;
  code: string;
  createdBy: string;
  expiresAt: string;
  usedBy: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/**
 * SPEC §5 step 3: "Before joining, they are shown what they are about to get
 * access to (the pet list)." Returned by the preview endpoint so the joiner can
 * see the household before the explicit confirm.
 */
export interface JoinPreviewDto {
  householdId: string;
  householdName: string | null;
  memberCount: number;
  pets: JoinPreviewPetDto[];
}

export interface JoinPreviewPetDto {
  id: string;
  name: string;
  species: string;
  tint: 1 | 2 | 3 | 4;
}

/**
 * Why a join code was refused. SPEC §5 and §12 name three of these explicitly —
 * a code cannot be redeemed twice (`already_used`), after expiry (`expired`), or
 * after a newer code was issued (`revoked`, since issuing revokes the previous).
 */
export type JoinCodeRejection =
  | "not_found"
  | "already_used"
  | "expired"
  | "revoked"
  | "already_in_household";

/** Result of evaluating a code against the clock. Implemented once per side. */
export type JoinCodeVerdict = { ok: true } | { ok: false; reason: JoinCodeRejection };

/** `GET /household`, `POST /household`, `POST /household/join`. */
export interface HouseholdStateDto {
  household: HouseholdDto;
  members: MemberDto[];
  self: SelfDto;
}

/** `POST /household/codes` request body. Empty — the server mints the code. */
export type IssueJoinCodeBody = Record<string, never>;

/** `POST /household/join` request body. `displayName` sets the name in the same round trip. */
export interface RedeemJoinCodeBody {
  code: string;
  displayName?: string;
}

/** `PATCH /household/me` request body. */
export interface SetDisplayNameBody {
  displayName: string;
}

/**
 * `POST /household` request body.
 *
 * `id` is the client-generated household id (SPEC §9: stable UUIDs minted
 * client-side, no dependency on server-assigned ids). The frontend always
 * sends the id it already created locally on first DB open, so the local and
 * server rows are the same id rather than two ids needing a mapping. Optional
 * only so a caller that omits it still gets a server-assigned id.
 */
export interface CreateHouseholdBody {
  id?: string;
  name?: string;
  displayName?: string;
}

/**
 * `POST /household/leave` request body. SPEC §5: "A household cannot be left
 * empty; the last member leaving deletes it after an explicit confirmation."
 * The server refuses a last-member leave without `confirmDelete: true`.
 */
export interface LeaveHouseholdBody {
  confirmDelete?: boolean;
}

export interface LeaveHouseholdResult {
  /** True when this leave deleted the household because it was the last member. */
  householdDeleted: boolean;
}

/** 409 body when the last member tries to leave without confirming the deletion. */
export interface ConfirmationRequiredError {
  error: "confirmation_required";
  message: string;
}

/** 4xx body when a redemption is refused, so the client can render the right line. */
export interface JoinCodeRejectedError {
  error: "join_code_rejected";
  reason: JoinCodeRejection;
  message: string;
}
