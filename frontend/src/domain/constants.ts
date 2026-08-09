export const TINT_COUNT = 4 as const;
export const UNDO_WINDOW_MS = 5_000 as const;
export const RETRACT_GRACE_MS = 30_000 as const;
export const GRACE_FIXED_MIN = 60 as const;
export const GRACE_INTERVAL_MIN = 90 as const;
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
