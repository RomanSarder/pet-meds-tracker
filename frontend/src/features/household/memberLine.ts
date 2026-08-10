// Pure line-builders for the Household and Your-name screens (CONTRACT-W8
// §5.1/§5.2, SPEC §6.5). Kept out of the components so the only real *logic*
// on these otherwise-transcribed screens has its own tests, decoupled from
// rendering and from the repo/hooks layer.
import type { DoseEvent } from "@/domain";
import type { Translator } from "@/i18n";

// Every function below REQUIRES a real `Translator` from the caller — there
// is no default. A default would let a call site silently render English
// inside a Ukrainian screen with no compile error and no test failure;
// requiring the argument makes the compiler find every call site.

/**
 * "12 Jun" from an ISO instant, in local time — matches the rest of the app's
 * local-time convention (SPEC §3d), not a UTC read of the string. A DATE, so
 * it localizes via `tr.fmt.dayMonth` — never a hand-written month table.
 */
export function formatJoinedDate(iso: string, tr: Translator): string {
  const d = new Date(iso);
  return tr.fmt.dayMonth(d);
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How many doses `actorId` logged (a `given` or `skipped` DoseEvent, i.e. a
 * `logDose` call) in the 7 days ending at `at`. `missed` events are excluded:
 * SPEC §4 writes those from the daily sweep, not from anyone "logging"
 * anything.
 */
export function dosesLoggedThisWeek(
  events: readonly DoseEvent[],
  actorId: string,
  at: Date,
): number {
  const cutoff = at.getTime() - SEVEN_DAYS_MS;
  const atMs = at.getTime();
  return events.filter((e) => {
    if (e.actorId !== actorId || e.status === "missed") return false;
    const loggedAt = new Date(e.loggedAt).getTime();
    return loggedAt > cutoff && loggedAt <= atMs;
  }).length;
}

/**
 * The Household screen's second line per member row (CONTRACT-W8 §5.1): self
 * always reads "You · joined 12 Jun"; everyone else reads their activity this
 * week when they have any, and when they joined otherwise.
 */
export function memberLine(params: {
  isSelf: boolean;
  joinedAt: string;
  dosesThisWeek: number;
}, tr: Translator): string {
  const joined = formatJoinedDate(params.joinedAt, tr);
  if (params.isSelf) {
    return tr.t("household.memberLine.you", { date: joined });
  }
  if (params.dosesThisWeek > 0) {
    return tr.t("household.memberLine.loggedDoses", { n: params.dosesThisWeek });
  }
  return tr.t("household.memberLine.joined", { date: joined });
}

/**
 * Joins other members' names for the Your-name helper copy (CONTRACT-W8
 * §5.2): "Marta", "Marta and Ilya", "Marta, Ilya and Sam" — or, with nobody
 * else in the household, the generic fallback so the sentence still reads.
 * The names themselves are DATA (SPEC §10a) and are never translated or
 * declined; only the joining conjunction and the empty-household fallback
 * resolve through the catalogue.
 */
export function otherMemberNamesLabel(names: readonly string[], tr: Translator): string {
  if (names.length === 0) {
    return tr.t("household.otherMembers.everyone");
  }
  if (names.length === 1) {
    return names[0];
  }
  return `${names.slice(0, -1).join(", ")}${tr.t("household.otherMembers.and")}${names[names.length - 1]}`;
}
