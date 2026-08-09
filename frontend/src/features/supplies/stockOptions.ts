// Coarse stock-level options for "drops and suspensions" (SPEC §6.6). Pure —
// no React, no repo.
import type { Medication } from "@/domain";

export type CoarseLevel = "full" | "about half" | "nearly out" | "empty";

/** SPEC §6.6: stored as a fraction of packSize. */
export const COARSE_FRACTIONS: Record<CoarseLevel, number> = {
  full: 1,
  "about half": 0.5,
  // §6.6 doesn't fix an exact figure for "nearly out" — 0.1 is a judgement
  // call, not a transcribed value.
  "nearly out": 0.1,
  empty: 0,
};

/** Display order: full, about half, nearly out, empty. */
export const COARSE_LEVELS: CoarseLevel[] = ["full", "about half", "nearly out", "empty"];

/** true for liquid forms — SPEC §6.6's "drops and suspensions". */
export function allowsCoarseFigure(medication: Medication): boolean {
  return medication.form === "liquid";
}

export function coarseUnits(packSize: number, level: CoarseLevel): number {
  return packSize * COARSE_FRACTIONS[level];
}
