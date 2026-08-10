// SPEC §6.4: "Export the visible range as plain text or CSV for a vet."
// Plain and factual, house style — no emoji, sentence case, facts joined
// with a spaced middle dot. Names resolve ONLY through the injected
// `nameFor` (SPEC §12: no email address is ever rendered).
//
// Pure, with the translator injected as a parameter (I18N-DESIGN.md §5), so
// both languages are unit-testable without a React tree.
import type { LocalDate } from "@/domain";
import { localDayKey, parseLocalDay } from "@/domain";
import type { Translator } from "@/i18n";
import { renderDayHeading, renderDetail, renderLogTitle } from "@/i18n/history";
import type { LogEntry } from "./logModel";
import { groupByDay } from "./logModel";

export interface ExportContext {
  petName: string;
  from: LocalDate;
  to: LocalDate;
  nameFor: (actorId: string) => string;
}

// `Formatters` has no year-inclusive date formatter — `dayMonth` deliberately
// omits the year, because every in-app use of it is relative to the current
// day. An exported document is read outside the app, months later, so it
// needs the year; this is the one shape only this file wants, so it builds
// its own `Intl.DateTimeFormat` (permitted in a feature file — the ban on
// `Intl` covers `engine/**` and `logModel.ts`). Cached per locale, like the
// instances in `i18n/formatters.ts`, since these run once per exported row
// range and are expensive to construct.
const rangeDateFormats = new Map<string, Intl.DateTimeFormat>();

function rangeDateFormat(tr: Translator): Intl.DateTimeFormat {
  const tag = tr.locale === "uk" ? "uk-UA" : "en-GB";
  const existing = rangeDateFormats.get(tag);
  if (existing) return existing;
  const format = new Intl.DateTimeFormat(tag, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  rangeDateFormats.set(tag, format);
  return format;
}

/** "9 Aug 2026" — a static date for a document read outside the app, unlike the screen's relative "Today"/"Yesterday". */
function formatRangeDate(day: LocalDate, tr: Translator): string {
  return rangeDateFormat(tr).format(parseLocalDay(day));
}

function entryLine(entry: LogEntry, ctx: ExportContext, tr: Translator): string {
  const detail = renderDetail(entry.detail, tr);
  const by = tr.t("history.byActor", { name: ctx.nameFor(entry.actorId) });
  return `${entry.time} · ${renderLogTitle(entry.title, tr)} · ${detail} · ${by}`;
}

/**
 * A first line naming the pet and the range, then day sections (the same
 * headings the screen shows), each with one line per entry: time, title,
 * detail, and "by <name>". `ctx.to` doubles as the day-heading reference so a
 * day inside the range that is actually today still reads "Today · …",
 * matching what the screen showed when the export was made.
 */
export function exportAsText(entries: LogEntry[], ctx: ExportContext, tr: Translator): string {
  const header = tr.t("history.export.header", {
    petName: ctx.petName,
    from: formatRangeDate(ctx.from, tr),
    to: formatRangeDate(ctx.to, tr),
  });
  const groups = groupByDay(entries, ctx.to);
  const sections = groups.map((group) => {
    const rows = group.entries.map((entry) => entryLine(entry, ctx, tr));
    return [renderDayHeading(group.heading, tr), ...rows].join("\n");
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
 *
 * The header row and the `type` column stay untranslated in both languages
 * ON PURPOSE: they are machine field names and a stable status enum, the
 * part of the file a spreadsheet or an importer keys on, not prose. The one
 * human-readable column, `detail`, is fully localized — as is the whole of
 * the plain-text export, which is the shape meant to be read as a document.
 */
export function exportAsCsv(entries: LogEntry[], ctx: ExportContext, tr: Translator): string {
  const header = ["date", "time", "type", "medication", "detail", "by"];
  const rows = entries.map((entry) => [
    localDayKey(new Date(entry.at)),
    entry.time,
    entry.status,
    renderLogTitle(entry.title, tr),
    renderDetail(entry.detail, tr),
    ctx.nameFor(entry.actorId),
  ]);
  return [header, ...rows].map((row) => row.map(csvField).join(",")).join("\n") + "\n";
}
