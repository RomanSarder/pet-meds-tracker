import { describe, expect, it } from "vitest";
import type { HouseholdBackup } from "@/domain";
import {
  backupFileName,
  isHouseholdBackup,
  readBackupFile,
  serializeBackup,
} from "@/data/backupFile";

function emptyBackup(): HouseholdBackup {
  return {
    schemaVersion: 1,
    exportedAt: "2026-08-08T07:00:00.000Z",
    pets: [],
    medications: [],
    courses: [],
    doseEvents: [],
    stockAdjustments: [],
  };
}

describe("backupFileName", () => {
  it("names the file after the day of the exported instant", () => {
    expect(backupFileName("2026-08-08T07:00:00.000Z")).toBe(
      "petmeds-backup-2026-08-08.json",
    );
  });

  it("uses a different day when the instant falls on a different day", () => {
    expect(backupFileName("2025-01-31T23:59:59.999Z")).toBe(
      "petmeds-backup-2025-01-31.json",
    );
  });
});

describe("serializeBackup / readBackupFile round-trip", () => {
  it("serializes with 2-space indentation", () => {
    const json = serializeBackup(emptyBackup());
    expect(json).toContain("\n  \"schemaVersion\": 1");
  });

  it("reads back exactly what was serialized", async () => {
    const backup = emptyBackup();
    const json = serializeBackup(backup);
    const file = new File([json], "backup.json", { type: "application/json" });

    const parsed = await readBackupFile(file);

    expect(parsed).toEqual(backup);
  });

  it("round-trips a backup with populated arrays", async () => {
    const backup: HouseholdBackup = {
      ...emptyBackup(),
      pets: [
        {
          id: "pet-1",
          name: "Clover",
          species: "rabbit",
          birthdate: null,
          weightGrams: null,
          tint: 1,
          archived: false,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          deletedAt: null,
        },
      ],
    };
    const file = new File([serializeBackup(backup)], "backup.json");

    const parsed = await readBackupFile(file);

    expect(parsed).toEqual(backup);
  });
});

describe("isHouseholdBackup", () => {
  it("accepts a well-formed backup shape", () => {
    expect(isHouseholdBackup(emptyBackup())).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(isHouseholdBackup(null)).toBe(false);
    expect(isHouseholdBackup("not a backup")).toBe(false);
    expect(isHouseholdBackup(42)).toBe(false);
  });

  it("rejects a missing schemaVersion", () => {
    const { schemaVersion: _schemaVersion, ...rest } = emptyBackup();
    expect(isHouseholdBackup(rest)).toBe(false);
  });

  it("rejects a non-numeric schemaVersion", () => {
    expect(isHouseholdBackup({ ...emptyBackup(), schemaVersion: "1" })).toBe(false);
  });

  it("rejects when any of the five arrays is missing or not an array", () => {
    const { doseEvents: _doseEvents, ...rest } = emptyBackup();
    expect(isHouseholdBackup(rest)).toBe(false);
    expect(isHouseholdBackup({ ...emptyBackup(), courses: "nope" })).toBe(false);
  });
});

describe("readBackupFile validation", () => {
  it("rejects a file that isn't valid JSON", async () => {
    const file = new File(["{ not json"], "backup.json");
    await expect(readBackupFile(file)).rejects.toThrow(/valid JSON/i);
  });

  it("rejects well-formed JSON missing the backup shape", async () => {
    const file = new File([JSON.stringify({ hello: "world" })], "backup.json");
    await expect(readBackupFile(file)).rejects.toThrow(/backup/i);
  });

  it("rejects a backup missing one of the required arrays", async () => {
    const malformed = { schemaVersion: 1, exportedAt: "2026-08-08T07:00:00.000Z" };
    const file = new File([JSON.stringify(malformed)], "backup.json");
    await expect(readBackupFile(file)).rejects.toThrow(/backup/i);
  });
});
