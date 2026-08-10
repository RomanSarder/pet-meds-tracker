/**
 * Two small `localStorage` records that track client-side session state.
 *
 * Neither of these is a security boundary, and this file does not attempt to
 * make it one. The real boundary is the httpOnly session cookie, checked on
 * the server for every `/api/*` request — nothing written here ever reaches
 * that check. `localStorage` is plain text any script on this origin (and the
 * user, via devtools) can already read and edit, so a value stored here can
 * always be forged.
 *
 * Forging either value buys nothing new. `sessionEstablished` only decides
 * whether the app shell renders offline using whatever is already sitting in
 * this origin's IndexedDB — data the same forger could already open directly
 * in devtools — and the first request that actually reaches the server still
 * comes back 401 and kicks the forger back out; no server data is exposed.
 * `storeOwnerUserId` just labels which account the local store belongs to; it
 * lives in the same origin as that data, so nobody who couldn't already read
 * the data can use this value to read it differently.
 *
 * Every access below is wrapped in try/catch: Safari private browsing throws
 * on both `getItem` and `setItem`, and a storage failure here must never
 * break the app. A failed read behaves as if the value were absent.
 */

const ESTABLISHED_KEY = "petmeds.session.established";
const OWNER_KEY = "petmeds.store.ownerUserId";

/** True once /auth/me has succeeded at least once. Cleared by a 401 and by explicit sign-out. */
export function isSessionEstablished(): boolean {
  try {
    return localStorage.getItem(ESTABLISHED_KEY) === "true";
  } catch {
    return false;
  }
}

export function markSessionEstablished(): void {
  try {
    localStorage.setItem(ESTABLISHED_KEY, "true");
  } catch {
    // Safari private mode, storage disabled, quota exceeded, etc. Nothing to do.
  }
}

export function clearSessionEstablished(): void {
  try {
    localStorage.removeItem(ESTABLISHED_KEY);
  } catch {
    // See markSessionEstablished.
  }
}

/** The server user id the local IndexedDB store currently belongs to. Survives sign-out. */
export function getStoreOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

export function setStoreOwner(userId: string): void {
  try {
    localStorage.setItem(OWNER_KEY, userId);
  } catch {
    // See markSessionEstablished.
  }
}
