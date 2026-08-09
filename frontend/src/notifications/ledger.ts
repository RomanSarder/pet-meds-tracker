/**
 * `AlertLedger` — the single structural guarantee that no dose ever produces
 * more than `MAX_ALERTS_PER_DOSE` notifications. See W10-CONTRACT.md: there
 * must be exactly one call site in the whole codebase that shows a
 * notification, and it must be unreachable except through `claim()`
 * returning `true`. Persisted to `localStorage` so a page reload does not
 * hand out two fresh alerts — a ledger that resets on refresh would mean a
 * refresh grants two more 3am alerts.
 */
import type { AlertReason, AlertRecord } from "./types";
import { silently } from "./support";

export const MAX_ALERTS_PER_DOSE = 2;
export const SNOOZE_MINUTES = 30;

const STORAGE_KEY = "petmeds.notifications.ledger";
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Storage seam so tests do not depend on a real `localStorage`. */
export interface LedgerStorage {
  read(): string | null;
  write(value: string): void;
}

/** Backed by `window.localStorage`. Silently no-ops (never throws) when it
 *  is unavailable or throws — Safari private mode raises on `setItem`. */
export function localStorageLedger(): LedgerStorage {
  return {
    read(): string | null {
      return silently(() => window.localStorage.getItem(STORAGE_KEY)) ?? null;
    },
    write(value: string): void {
      silently(() => window.localStorage.setItem(STORAGE_KEY, value));
    },
  };
}

type LedgerState = Record<string, AlertRecord>;

/** Corrupt or unparseable JSON — or anything that isn't a plain object — is
 *  treated as an empty ledger, silently. */
function parse(raw: string | null): LedgerState {
  if (raw === null) return {};
  const parsed = silently(() => JSON.parse(raw) as unknown);
  if (parsed === undefined || parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as LedgerState;
}

export class AlertLedger {
  private readonly storage: LedgerStorage;
  private state: LedgerState;

  constructor(storage: LedgerStorage = localStorageLedger()) {
    this.storage = storage;
    this.state = parse(silently(() => this.storage.read()) ?? null);
  }

  private persist(): void {
    silently(() => this.storage.write(JSON.stringify(this.state)));
  }

  /**
   * The ONLY gate. Returns `false` — and changes nothing — when this dose
   * has already had `MAX_ALERTS_PER_DOSE` alerts, when this exact reason has
   * already fired for it, or when it is currently snoozed (`nowMs` before
   * `snoozeUntil`). Returns `true` and records the alert otherwise. The
   * in-memory record is always updated on success even if persisting to
   * storage then fails — a write failure degrades durability, not the
   * decision already made for this call.
   */
  claim(key: string, reason: AlertReason, nowMs: number): boolean {
    const record = this.state[key];
    if (record) {
      if (record.snoozeUntil !== null && nowMs < record.snoozeUntil) return false;
      if (record.reasons.length >= MAX_ALERTS_PER_DOSE) return false;
      if (record.reasons.includes(reason)) return false;
    }
    this.state[key] = record
      ? { ...record, reasons: [...record.reasons, reason], updatedAt: nowMs }
      : { key, reasons: [reason], snoozeUntil: null, updatedAt: nowMs };
    this.persist();
    return true;
  }

  /**
   * Records a snooze until `nowMs + SNOOZE_MINUTES`. Returns `false` and
   * records nothing when the dose has already used its budget — a snooze is
   * not a licence to exceed the ceiling.
   */
  snooze(key: string, nowMs: number): boolean {
    const record = this.state[key];
    const count = record ? record.reasons.length : 0;
    if (count >= MAX_ALERTS_PER_DOSE) return false;
    const snoozeUntil = nowMs + SNOOZE_MINUTES * 60_000;
    this.state[key] = record
      ? { ...record, snoozeUntil, updatedAt: nowMs }
      : { key, reasons: [], snoozeUntil, updatedAt: nowMs };
    this.persist();
    return true;
  }

  countFor(key: string): number {
    return this.state[key]?.reasons.length ?? 0;
  }

  recordFor(key: string): AlertRecord | null {
    return this.state[key] ?? null;
  }

  /** Drops records untouched for more than 7 days so the store stays bounded. */
  prune(nowMs: number): void {
    let changed = false;
    for (const [key, record] of Object.entries(this.state)) {
      if (nowMs - record.updatedAt > PRUNE_AFTER_MS) {
        delete this.state[key];
        changed = true;
      }
    }
    if (changed) this.persist();
  }
}
