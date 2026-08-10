import { describe, expect, it } from "vitest";
import { createTranslator } from "@/i18n";
import type { DetailClause, LogEntry } from "./logModel";
import { exportAsCsv, exportAsText } from "./historyExport";

// English is pinned here: every literal below is the exact output this module
// produced before localization. Ukrainian coverage is opted into explicitly at
// the bottom of the file.
const en = createTranslator("en");
const uk = createTranslator("uk");

const GIVEN: DetailClause[] = [{ kind: "given" }];

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: "e1",
    kind: "dose",
    status: "given",
    at: "2026-08-01T06:00:00.000Z",
    displayAt: "2026-08-01T06:00:00.000Z",
    time: "07:00",
    title: { medicationName: "Metacam", amount: 0.4, unit: "ml" },
    detail: GIVEN,
    actorId: "user-1",
    ...overrides,
  };
}

describe("exportAsCsv", () => {
  it("emits the fixed header row", () => {
    const csv = exportAsCsv(
      [],
      { petName: "Clover", from: "2026-08-01", to: "2026-08-01", nameFor: () => "Roman" },
      en,
    );
    const [header] = csv.trimEnd().split("\n");
    expect(header).toBe('"date","time","type","medication","detail","by"');
  });

  it("quotes every field and is correct when a detail line contains a comma", () => {
    const entry = makeEntry({
      time: "14:12",
      detail: [
        { kind: "given" },
        {
          kind: "nextDue",
          time: "14:12",
          schedule: { segments: [{ kind: "everyHours", hours: 8 }, { kind: "fromLastDose" }] },
        },
      ],
      actorId: "user-1",
    });
    const csv = exportAsCsv(
      [entry],
      { petName: "Clover", from: "2026-08-01", to: "2026-08-01", nameFor: () => "Marta" },
      en,
    );
    const rows = csv.trimEnd().split("\n");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe(
      '"2026-08-01","14:12","given","Metacam 0.4 ml","Given · next due 14:12, every 8h · from last dose","Marta"',
    );
  });

  it("escapes an embedded double quote by doubling it", () => {
    const entry = makeEntry({
      detail: [{ kind: "skipped" }, { kind: "text", text: 'owner said "watch out"' }],
    });
    const csv = exportAsCsv(
      [entry],
      { petName: "Clover", from: "2026-08-01", to: "2026-08-01", nameFor: () => "Roman" },
      en,
    );
    const rows = csv.trimEnd().split("\n");
    expect(rows[1]).toContain('"Skipped · owner said ""watch out"""');
  });

  it("dates each row by the entry's own day-grouping instant (`at`), not `time` alone", () => {
    // 23:00 BST on 7 Aug logged past midnight — `at` carries the scheduled day.
    const entry = makeEntry({ at: "2026-08-07T22:00:00.000Z", time: "00:20" });
    const csv = exportAsCsv(
      [entry],
      { petName: "Clover", from: "2026-08-07", to: "2026-08-08", nameFor: () => "Roman" },
      en,
    );
    const rows = csv.trimEnd().split("\n");
    expect(rows[1].startsWith('"2026-08-07"')).toBe(true);
  });

  it("covers exactly the entries passed in — no more, no fewer", () => {
    const entries = [
      makeEntry({ id: "a", at: "2026-08-09T07:00:00.000Z" }),
      makeEntry({ id: "b", at: "2026-08-08T19:04:00.000Z" }),
      makeEntry({ id: "c", at: "2026-08-08T08:00:00.000Z" }),
    ];
    const csv = exportAsCsv(
      entries,
      { petName: "Clover", from: "2026-08-08", to: "2026-08-09", nameFor: () => "Roman" },
      en,
    );
    const rows = csv.trimEnd().split("\n");
    expect(rows).toHaveLength(1 + entries.length);
  });

  it("resolves names only through the injected nameFor — an unknown actor is never hardcoded to 'Someone'", () => {
    const entry = makeEntry({ actorId: "ghost-id" });
    const csv = exportAsCsv(
      [entry],
      {
        petName: "Clover",
        from: "2026-08-01",
        to: "2026-08-01",
        nameFor: (actorId) => `resolved:${actorId}`,
      },
      en,
    );
    expect(csv).toContain('"resolved:ghost-id"');
    expect(csv).not.toContain("Someone");
  });

  it("keeps the header row and the type column untranslated — they are machine field names", () => {
    const entry = makeEntry();
    const csv = exportAsCsv(
      [entry],
      { petName: "Clover", from: "2026-08-01", to: "2026-08-01", nameFor: () => "Роман" },
      uk,
    );
    const rows = csv.trimEnd().split("\n");
    expect(rows[0]).toBe('"date","time","type","medication","detail","by"');
    expect(rows[1]).toContain('"given"');
    // …while the one human-readable column is localized.
    expect(rows[1]).toContain('"Дано"');
  });
});

describe("exportAsText", () => {
  it("opens with a line naming the pet and the range", () => {
    const text = exportAsText(
      [],
      { petName: "Clover", from: "2026-08-08", to: "2026-08-09", nameFor: () => "Roman" },
      en,
    );
    expect(text.split("\n")[0]).toBe("Clover — history 8 Aug 2026 to 9 Aug 2026");
  });

  it("groups entries under day headings and renders time, title, detail and by <name>", () => {
    const entries: LogEntry[] = [
      makeEntry({
        id: "a",
        at: "2026-08-09T07:00:00.000Z",
        time: "08:00",
        title: { medicationName: "Metacam", amount: 0.4, unit: "ml" },
        detail: GIVEN,
        actorId: "user-1",
      }),
      makeEntry({
        id: "b",
        at: "2026-08-08T19:04:00.000Z",
        time: "20:04",
        title: { medicationName: "Baytril", amount: 0.3, unit: "ml" },
        detail: [{ kind: "skipped" }, { kind: "text", text: "refused syringe" }],
        actorId: "user-2",
      }),
      makeEntry({
        id: "c",
        kind: "course",
        status: "course",
        at: "2026-08-08T08:00:00.000Z",
        time: "09:00",
        title: { medicationName: "Metacam", amount: 0.4, unit: "ml" },
        detail: [{ kind: "coursePaused" }],
        actorId: "ghost-id",
      }),
    ];
    const nameFor = (actorId: string) =>
      actorId === "user-1" ? "Roman" : actorId === "user-2" ? "Marta" : `unresolved:${actorId}`;

    const text = exportAsText(
      entries,
      { petName: "Clover", from: "2026-08-08", to: "2026-08-09", nameFor },
      en,
    );

    expect(text).toContain("Today · Sun 9 Aug");
    expect(text).toContain("Yesterday · Sat 8 Aug");
    expect(text).toContain("08:00 · Metacam 0.4 ml · Given · by Roman");
    expect(text).toContain("20:04 · Baytril 0.3 ml · Skipped · refused syringe · by Marta");
    expect(text).toContain("09:00 · Metacam 0.4 ml · Course paused · by unresolved:ghost-id");
    // Never hardcodes "Someone" — that is displayNameFor's job, not this module's.
    expect(text).not.toContain("Someone");
  });

  it("covers exactly the entries passed in — every entry's title appears exactly once", () => {
    const entries: LogEntry[] = [
      makeEntry({
        id: "a",
        at: "2026-08-09T07:00:00.000Z",
        title: { medicationName: "Metacam", amount: 0.4, unit: "ml" },
      }),
      makeEntry({
        id: "b",
        at: "2026-08-08T19:00:00.000Z",
        title: { medicationName: "Baytril", amount: 0.3, unit: "ml" },
      }),
    ];
    const text = exportAsText(
      entries,
      { petName: "Clover", from: "2026-08-08", to: "2026-08-09", nameFor: () => "Roman" },
      en,
    );
    expect(text.split("Metacam 0.4 ml")).toHaveLength(2);
    expect(text.split("Baytril 0.3 ml")).toHaveLength(2);
  });

  it("renders the whole document in Ukrainian, dates included, when given a Ukrainian translator", () => {
    const entries: LogEntry[] = [
      makeEntry({
        id: "a",
        at: "2026-08-09T07:00:00.000Z",
        time: "08:00",
        detail: [{ kind: "skipped" }, { kind: "text", text: "відмовився" }],
      }),
    ];
    const text = exportAsText(
      entries,
      { petName: "Clover", from: "2026-08-08", to: "2026-08-09", nameFor: () => "Роман" },
      uk,
    );
    expect(text.split("\n")[0]).toBe("Clover — історія з 8 серп. 2026 р. до 9 серп. 2026 р.");
    expect(text).toContain("Сьогодні · нд, 9 серп.");
    // The user's own note is data — echoed verbatim, never translated. The
    // clock time is likewise never localized (SPEC §10a).
    expect(text).toContain("08:00 · Metacam 0.4 ml · Пропущено · відмовився · виконано: Роман");
  });
});
