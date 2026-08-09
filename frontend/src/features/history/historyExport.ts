// SPEC §6.4: "Export the visible range as plain text or CSV for a vet."
// Plain and factual, house style — no emoji, sentence case, facts joined
// with a spaced middle dot. Names resolve ONLY through the injected
// `nameFor` (SPEC §12: no email address is ever rendered).
import type { LocalDate } from "@/domain";
import { localDayKey, parseLocalDay } from "@/domain";
import type { LogEntry } from "./logModel";
import { groupByDay } from "./logModel";

export interface ExportContext {
  petName: string;
  from: LocalDate;
  to: LocalDate;
  nameFor: (actorId: string) => string;
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "9 Aug 2026" — a static date for a document read outside the app, unlike the screen's relative "Today"/"Yesterday". */
function formatRangeDate(day: LocalDate): string {
  const d = parseLocalDay(day);
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function entryLine(entry: LogEntry, ctx: ExportContext): string {
  return `${entry.time} · ${entry.title} · ${entry.detail} · by ${ctx.nameFor(entry.actorId)}`;
}

/**
 * A first line naming the pet and the range, then day sections (the same
 * "Ddd D Mmm" heading `dayLabel` uses), each with one line per entry: time,
 * title, detail, and "by <name>". `ctx.to` doubles as the day-heading
 * reference so a day inside the range that is actually today still reads
 * "Today · …", matching what the screen showed when the export was made.
 */
export function exportAsText(entries: LogEntry[], ctx: ExportContext): string {
  const header = `${ctx.petName} — history ${formatRangeDate(ctx.from)} to ${formatRangeDate(ctx.to)}`;
  const groups = groupByDay(entries, ctx.to);
  const sections = groups.map((group) => {
    const rows = group.entries.map((entry) => entryLine(entry, ctx));
    return [group.label, ...rows].join("\n");
  });
  return [header, ...sections].join("\n\n");
}

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Header `date,time,type,medication,detail,by`, one row per entry — `date`
 * is the entry's own LocalDate (its day-grouping instant, so a late-night
 * dose still files under the day it was scheduled for, per SPEC §3d), `type`
 * is the entry's status (given/skipped/missed/course) since that is what a
 * vet reading the sheet needs, not the dose/course kind. Every field is
 * quoted; embedded double quotes are doubled.
 */
export function exportAsCsv(entries: LogEntry[], ctx: ExportContext): string {
  const header = ["date", "time", "type", "medication", "detail", "by"];
  const rows = entries.map((entry) => [
    localDayKey(new Date(entry.at)),
    entry.time,
    entry.status,
    entry.title,
    entry.detail,
    ctx.nameFor(entry.actorId),
  ]);
  return [header, ...rows].map((row) => row.map(csvField).join(",")).join("\n") + "\n";
}
