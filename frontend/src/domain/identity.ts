// SPEC §11 / §5: all attribution renders through `displayNameFor` so an
// unknown, removed or blank-named actor never shows up as a raw id or an
// email address.
import { UNKNOWN_ACTOR_NAME } from "./constants";
import type { User } from "./types";

/**
 * SPEC §11 / §5. Attribution renders through this one helper. Returns
 * `UNKNOWN_ACTOR_NAME` ("Someone") for an unknown id, a soft-deleted user, or a user whose
 * `displayName` is empty or whitespace — SPEC §5: "render 'Someone' rather than an email".
 * It never reads `User.email`.
 */
export function displayNameFor(actorId: string, users: readonly User[]): string {
  // `aliasIds` covers a member whose local "self" id changed after some
  // events were already stamped with the now-stale one — see `User.aliasIds`'s
  // doc comment. A real, CURRENT id is always looked for across the whole
  // list first, and only falls back to an alias match when no user's own id
  // matches — so a real id always wins, regardless of array order, even if
  // some alias list were ever to (harmlessly) overlap it.
  const user =
    users.find((u) => u.id === actorId) ?? users.find((u) => (u.aliasIds ?? []).includes(actorId));
  if (!user) {
    return UNKNOWN_ACTOR_NAME;
  }
  const trimmed = user.displayName.trim();
  return trimmed.length > 0 ? trimmed : UNKNOWN_ACTOR_NAME;
}

/** Binds a member list once so call sites read as `name(actorId)`. Same semantics. */
export function displayNameLookup(users: readonly User[]): (actorId: string) => string {
  return (actorId: string) => displayNameFor(actorId, users);
}
