// Browser-side plumbing for SPEC.md §8 export/import: turning a
// `HouseholdBackup` into a downloadable file, and turning a chosen `File`
// back into a validated `HouseholdBackup`. Deliberately pure/DOM-only — no
// repo calls here, so it stays trivially testable under jsdom.
import type { HouseholdBackup, IsoDateTime } from "@/domain";

const BACKUP_ARRAY_KEYS = [
  "pets",
  "medications",
  "courses",
  "doseEvents",
  "stockAdjustments",
] as const;

/** e.g. `petmeds-backup-2026-08-08.json` — day-only, taken from the ISO instant. */
export function backupFileName(exportedAt: IsoDateTime): string {
  return `petmeds-backup-${exportedAt.slice(0, 10)}.json`;
}

export function serializeBackup(b: HouseholdBackup): string {
  return JSON.stringify(b, null, 2);
}

/**
 * Structural check that a parsed JSON value is shaped like a
 * `HouseholdBackup`: a numeric `schemaVersion` plus the five arrays. Does not
 * validate the *contents* of those arrays — `importHousehold` is expected to
 * do the rest — this is only the gate that keeps obviously-wrong files
 * (wrong file entirely, truncated download, hand-edited JSON missing a
 * field) from ever reaching it.
 */
export function isHouseholdBackup(value: unknown): value is HouseholdBackup {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.schemaVersion !== "number") return false;
  return BACKUP_ARRAY_KEYS.every((key) => Array.isArray(record[key]));
}

/**
 * Triggers a browser download of `b` as a JSON file. Guarded for
 * `URL.createObjectURL` being absent (jsdom does not implement it) so this
 * is safe to call from code under test without needing a DOM mock.
 */
export function downloadBackup(b: HouseholdBackup): void {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return;
  }
  const blob = new Blob([serializeBackup(b)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = backupFileName(b.exportedAt);
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * `File#text()` is unimplemented in jsdom (it only inherits `Blob`'s stub),
 * so this goes through `FileReader`, which both real browsers and jsdom
 * support.
 */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsText(file);
  });
}

/**
 * Reads and parses a chosen `File`, validating its shape before returning.
 * Throws a plain `Error` with a short, user-facing message on anything
 * malformed — invalid JSON, or JSON missing the required backup shape — so a
 * bad file never reaches `importHousehold`.
 */
export async function readBackupFile(file: File): Promise<HouseholdBackup> {
  const text = await readFileAsText(file);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (!isHouseholdBackup(parsed)) {
    throw new Error("That file doesn't look like a Pet Meds backup.");
  }
  return parsed;
}
