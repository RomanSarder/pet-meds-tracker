// Seeding a household for e2e, through the app's OWN import path.
//
// WHY NOT `addInitScript` + a raw IndexedDB write. The store is at
// `DB_VERSION 4` with per-store indexes, and the `medications` store carries a
// `nameLower` column that is NOT on the `Medication` type (`frontend/src/data/db.ts`
// — added on write by `toStoredMedication`, stripped on read). Hand-writing
// rows would restate the schema in a second place and break silently on the
// next version bump. Driving `SettingsPage`'s import instead reuses
// `readBackupFile` → `getRepo().importHousehold(backup, "replace")` →
// `queryClient.invalidateQueries()`, i.e. production code, and gets the
// `nameLower` backfill and the meta bookkeeping for free.
//
// The payload mirrors `HouseholdBackup` in `frontend/src/domain/types.ts`,
// modelled on `frontend/src/domain/fixtures.ts`. It is authored standalone
// rather than imported: `frontend/src` is aliased (`@/…`) and wired for the
// vitest environment, and `e2e/` is compiled by Playwright outside that
// workspace.
import { expect, type Page } from "@playwright/test";

/**
 * The instant every spec pins its clock to, and the day the seed is built
 * around. 07:30 UTC with `timezoneId: "UTC"` (playwright.config.ts) means
 * local wall clock == UTC, so the ISO instants below are also the times the
 * screen renders through `formatHHMM` (which reads `getHours()`).
 *
 * Chosen so all three seeded doses are still PENDING at `now`:
 *   08:00  fixedTimes  — inside DUE_PRE_WINDOW_MIN (30) → "due"
 *   12:00  fromLastDose — anchor 04:00 + 8h            → "later"
 *   20:00  fixedTimes                                   → "later"
 * Nothing is overdue, so no AlertBanner appears and each medication label
 * occurs exactly once per row.
 */
export const PINNED_NOW = new Date("2026-08-08T07:30:00.000Z");
export const SEED_DAY = "2026-08-08";

/** What the smoke spec asserts on. Kept here so the payload and the expectations cannot drift. */
export const SEED = {
  petName: "Comet",
  /** `TodayDose.title` is `${medication.name} ${doseAmount} ${doseUnit}`. */
  fixedDoseTitle: "Zeroxin 0.4 ml",
  intervalDoseTitle: "Onvaxil 0.5 ml",
  /** Bare medication names, e.g. for `today.moreOptions`'s "More options for <name>". */
  fixedMedicationName: "Zeroxin",
  intervalMedicationName: "Onvaxil",
  fixedTimes: ["08:00", "20:00"] as const,
  /** anchor `givenAt` 04:00Z + `intervalHours` 8 — the engine's elapsed-ms arithmetic. */
  intervalDueTime: "12:00",
} as const;

const HOUSEHOLD_ID = "11111111-1111-4111-8111-000000000001";
const USER_ID = "22222222-2222-4222-8222-000000000001";
const PET_ID = "33333333-3333-4333-8333-000000000001";
const MED_FIXED_ID = "44444444-4444-4444-8444-000000000001";
const MED_INTERVAL_ID = "44444444-4444-4444-8444-000000000002";
const COURSE_FIXED_ID = "55555555-5555-4555-8555-000000000001";
const COURSE_INTERVAL_ID = "55555555-5555-4555-8555-000000000002";
const ANCHOR_EVENT_ID = "66666666-6666-4666-8666-000000000001";

const CREATED = "2026-08-01T09:00:00.000Z";

/** `frontend/src/domain/keys.ts` — `${courseId}|${scheduledFor ?? "-"}`. */
const occurrenceKeyFor = (courseId: string, scheduledFor: string | null): string =>
  `${courseId}|${scheduledFor ?? "-"}`;

export function buildSeedBackup() {
  return {
    // `DB_VERSION` in frontend/src/data/db.ts.
    schemaVersion: 4,
    exportedAt: PINNED_NOW.toISOString(),

    households: [
      { id: HOUSEHOLD_ID, name: "E2E Home", createdAt: CREATED, updatedAt: CREATED, deletedAt: null },
    ],

    users: [
      {
        id: USER_ID,
        householdId: HOUSEHOLD_ID,
        // SPEC §5/§12 forbid rendering an address; fixtures carry null too.
        email: null,
        displayName: "E2E",
        tint: 1,
        isSelf: true,
        joinedAt: CREATED,
        createdAt: CREATED,
        updatedAt: CREATED,
        deletedAt: null,
      },
    ],

    pets: [
      {
        id: PET_ID,
        name: SEED.petName,
        species: "rabbit",
        birthdate: "2024-01-05",
        weightGrams: 1800,
        tint: 1,
        archived: false,
        householdId: HOUSEHOLD_ID,
        createdAt: CREATED,
        updatedAt: CREATED,
        deletedAt: null,
      },
    ],

    medications: [
      {
        id: MED_FIXED_ID,
        name: "Zeroxin",
        strength: "1.5 mg/ml",
        form: "liquid",
        unit: "ml",
        packSize: 15,
        stockUnits: 12,
        lowThreshold: null,
        createdAt: CREATED,
        updatedAt: CREATED,
        deletedAt: null,
      },
      {
        id: MED_INTERVAL_ID,
        name: "Onvaxil",
        strength: "5 mg/ml",
        form: "liquid",
        unit: "ml",
        packSize: 15,
        stockUnits: 20,
        lowThreshold: null,
        createdAt: CREATED,
        updatedAt: CREATED,
        deletedAt: null,
      },
    ],

    courses: [
      {
        id: COURSE_FIXED_ID,
        petId: PET_ID,
        medicationId: MED_FIXED_ID,
        doseAmount: 0.4,
        doseUnit: "ml",
        instructions: null,
        schedule: { kind: "fixedTimes", times: [...SEED.fixedTimes] },
        startDate: "2026-08-01",
        // Open-ended on purpose: an `endDate` inside the next 7 days would
        // also light up the "coming up" card, which is not what this proves.
        endDate: null,
        status: "active",
        notes: null,
        resumedAt: null,
        createdAt: CREATED,
        updatedAt: CREATED,
        deletedAt: null,
      },
      {
        id: COURSE_INTERVAL_ID,
        petId: PET_ID,
        medicationId: MED_INTERVAL_ID,
        doseAmount: 0.5,
        doseUnit: "ml",
        instructions: null,
        schedule: { kind: "fromLastDose", intervalHours: 8 },
        startDate: "2026-08-01",
        endDate: null,
        status: "active",
        notes: null,
        resumedAt: null,
        createdAt: CREATED,
        updatedAt: CREATED,
        deletedAt: null,
      },
    ],

    doseEvents: [
      // The anchor. Without a live `given` event (or a `resumedAt`),
      // `anchorFor` returns null, the chain reads as "not started", `dueAt` is
      // null and there is no clock time on the screen to assert. `scheduledFor`
      // is null because this is the chain's first log — the engine's own
      // convention, and the key must echo it.
      {
        id: ANCHOR_EVENT_ID,
        courseId: COURSE_INTERVAL_ID,
        scheduledFor: null,
        status: "given",
        loggedAt: "2026-08-08T04:00:00.000Z",
        givenAt: "2026-08-08T04:00:00.000Z",
        amount: 0.5,
        note: null,
        occurrenceKey: occurrenceKeyFor(COURSE_INTERVAL_ID, null),
        supersedesId: null,
        actorId: USER_ID,
        createdAt: "2026-08-08T04:00:00.000Z",
        updatedAt: "2026-08-08T04:00:00.000Z",
        deletedAt: null,
      },
    ],

    courseEvents: [],
    stockAdjustments: [],

    // `lastSweepDay` set to the pinned day so `useDailySweep` no-ops. Left
    // null, it would run mid-test and write `missed` rows / flip courses to
    // `finished` under the assertions.
    meta: { tintCursor: 1, lastSweepDay: SEED_DAY },
  };
}

/**
 * Loads `backup` into the browser's IndexedDB by driving Settings → Import
 * JSON → Replace everything.
 *
 * Two steps, not one: choosing a file only STAGES it (`readBackupFile` →
 * `pendingImport`); `importHousehold` does not run until the user picks
 * replace or merge. Replace, so a spec always starts from exactly this corpus.
 */
export async function seedHousehold(
  page: Page,
  backup: ReturnType<typeof buildSeedBackup> = buildSeedBackup(),
): Promise<void> {
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Import JSON" })).toBeVisible();

  // The input is `display: none` and ref-clicked by the button above;
  // `setInputFiles` addresses it directly rather than racing a file chooser.
  await page.setInputFiles('input[type="file"]', {
    name: "e2e-seed.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup), "utf8"),
  });

  await page.getByRole("button", { name: "Replace everything" }).click();
  await expect(page.getByText("Import complete.")).toBeVisible();
}
