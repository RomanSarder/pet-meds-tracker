export const TINT_COUNT = 4 as const;
export const UNDO_WINDOW_MS = 5_000 as const;
export const RETRACT_GRACE_MS = 30_000 as const;
export const GRACE_FIXED_MIN = 60 as const;
/**
 * The UPPER BOUND of a `fromLastDose` course's cross-occurrence grace window
 * — no longer a flat value applied to every interval. The actual per-course
 * window is `intervalGraceMinutes(intervalHours)` (`./grace`), which scales
 * down for short intervals; this cap is what every interval of 4h and up
 * still lands on unchanged, exactly as the flat constant did before.
 */
export const GRACE_INTERVAL_CAP_MIN = 90 as const;
/**
 * The hard floor beneath the `allowWithinGrace` bypass (SPEC §3b's
 * early-give confirm). However a give is confirmed, a second `DoseEvent` on
 * the same course within this many minutes of any LIVE one already on it is
 * refused outright — no dialog, no override, checked unconditionally ahead
 * of the (bypassable) grace-window heuristic. Without this floor, a mis-tap
 * a minute after a real give could walk through the confirm dialog and log a
 * second dose seconds later; see `data/errors.ts`'s `TooSoonSinceLastDoseError`.
 */
export const EARLY_GIVE_FLOOR_MIN = 10 as const;
export const DUE_PRE_WINDOW_MIN = 30 as const;
export const MISSED_AFTER_HOURS = 12 as const;
export const UNKNOWN_ACTOR_NAME = "Someone" as const;
export const DISPLAY_NAME_MIN = 1 as const;
export const DISPLAY_NAME_MAX = 24 as const;
export const DEFAULT_HOUSEHOLD_NAME = "Home" as const;
/** SPEC §5: six uppercase chars, ambiguous glyphs excluded — no O/0, no I/1. */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" as const;
export const JOIN_CODE_LENGTH = 6 as const;
export const JOIN_CODE_TTL_MS = 24 * 60 * 60 * 1000;
/** SPEC §5/§7: placeholder self-user name until slice 8's first-run screen captures a real one. */
export const DEFAULT_SELF_DISPLAY_NAME = "You" as const;
