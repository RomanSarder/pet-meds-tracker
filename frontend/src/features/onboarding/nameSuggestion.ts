// SPEC §5/§6.9 — the editable name suggestion shown on first run, derived
// from the local part of the signed-in email ("roman@…" → "Roman"). Pure so
// it can be unit-tested without a session or a repo. CONTRACT-W8.md §5.4:
// this must never return a string containing "@" — the address itself must
// never reach the DOM, only a name guessed from it.
import { DISPLAY_NAME_MAX } from "@/domain";

/**
 * `null`/blank/malformed input (no "@", an empty local part, or an empty
 * domain part) returns "". Otherwise: take the local part, cut at the first
 * "+", replace "." / "_" / "-" with spaces, title-case each word, collapse
 * whitespace, and trim to `DISPLAY_NAME_MAX` characters.
 */
export function suggestNameFromEmail(email: string | null): string {
  if (!email) {
    return "";
  }
  const trimmedEmail = email.trim();
  if (trimmedEmail.length === 0) {
    return "";
  }

  const at = trimmedEmail.indexOf("@");
  // No "@", an empty local part ("@x.com"), or an empty domain ("x@") are
  // all malformed — there is no local part worth guessing a name from.
  if (at <= 0 || at === trimmedEmail.length - 1) {
    return "";
  }

  const local = trimmedEmail.slice(0, at);
  const beforeTag = local.split("+")[0];
  const spaced = beforeTag.replace(/[._-]+/g, " ").trim();
  if (spaced.length === 0) {
    return "";
  }

  const titled = spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

  const result = titled.slice(0, DISPLAY_NAME_MAX);
  // Defence in depth: the slicing above can never leave an "@" in the
  // result since `local` was taken strictly before it, but the contract is
  // absolute enough to assert rather than assume.
  return result.includes("@") ? "" : result;
}
