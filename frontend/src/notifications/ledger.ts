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

/**
 * Backed by `window.localStorage`. `read()` is silent (a failed or missing
 * read is treated as an empty ledger — see `parse` below). `write()`
 * deliberately does NOT swallow a throw (Safari private mode raises on
 * `setItem`, as does a full quota): `AlertLedger.claim()`/`snooze()` must be
 * able to observe a failed persist so they can refuse to authorise the
 * alert (Fix 2) rather than grant it and silently fail to durably count it.
 * `AlertLedger` is what keeps every call to this module's public API from
 * throwing outward, not this adapter.
 */
export function localStorageLedger(): LedgerStorage {
  return {
    read(): string | null {
      return silently(() => window.localStorage.getItem(STORAGE_KEY)) ?? null;
    },
    write(value: string): void {
      window.localStorage.setItem(STORAGE_KEY, value);
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

  constructor(storage: LedgerStorage = localStorageLedger()) {
    this.storage = storage;
  }

  /**
   * Fix 1: reads and parses storage FRESH, every call — there is no
   * constructor-time or instance-level cache. Two tabs are two `AlertLedger`
   * instances, and the only thing that lets one learn about the other's
   * writes is reading storage again right before deciding. This does not
   * make `claim`/`snooze` a cross-tab lock: it closes the ordinary two-tab
   * race down to the microseconds between this synchronous read and the
   * synchronous write that follows it in the same call, and `localStorage`
   * offers no cross-process lock at all — a write from another tab landing
   * in that exact window is still possible in principle. That residual
   * window is accepted and documented here, not pretended away.
   */
  private readState(): LedgerState {
    return parse(silently(() => this.storage.read()) ?? null);
  }

  /**
   * Fix 2: attempts the persist and reports whether it actually happened.
   * Never throws — a throwing `storage.write` (Safari private mode, quota)
   * is caught here so it can be turned into a `false` return rather than an
   * exception out of `claim`/`snooze`.
   */
  private tryPersist(state: LedgerState): boolean {
    return silently(() => {
      this.storage.write(JSON.stringify(state));
      return true;
    }) === true;
  }

  /**
   * The ONLY gate. Returns `false` — and changes nothing — when this dose
   * has already had `MAX_ALERTS_PER_DOSE` alerts, when this exact reason has
   * already fired for it, when it is currently snoozed (`nowMs` before
   * `snoozeUntil`), or when the resulting state cannot be durably persisted.
   * Returns `true` and records the alert otherwise.
   *
   * Fix 2: the persist is attempted BEFORE the claim is authorised. Because
   * state now lives only in storage (Fix 1 — there is no in-memory copy to
   * roll back), a failed persist simply never gets written: the read
   * decided against, but nothing changed, and `false` is returned. A ledger
   * that cannot durably count must not authorise an alert — a reload after
   * a failed persist must see a first claim again, not a phantom used
   * budget or a silently ungranted extra one.
   */
  claim(key: string, reason: AlertReason, nowMs: number): boolean {
    const state = this.readState();
    const record = state[key];
    if (record) {
      if (record.snoozeUntil !== null && nowMs < record.snoozeUntil) return false;
      if (record.reasons.length >= MAX_ALERTS_PER_DOSE) return false;
      if (record.reasons.includes(reason)) return false;
    }
    const nextRecord: AlertRecord = record
      ? { ...record, reasons: [...record.reasons, reason], updatedAt: nowMs }
      : { key, reasons: [reason], snoozeUntil: null, updatedAt: nowMs };
    if (!this.tryPersist({ ...state, [key]: nextRecord })) return false;
    return true;
  }

  /**
   * Records a snooze until `nowMs + SNOOZE_MINUTES`. Returns `false` and
   * records nothing when the dose has already used its budget (a snooze is
   * not a licence to exceed the ceiling) or when persisting the snooze
   * fails (Fix 2 — same reasoning as `claim`).
   */
  snooze(key: string, nowMs: number): boolean {
    const state = this.readState();
    const record = state[key];
    const count = record ? record.reasons.length : 0;
    if (count >= MAX_ALERTS_PER_DOSE) return false;
    const snoozeUntil = nowMs + SNOOZE_MINUTES * 60_000;
    const nextRecord: AlertRecord = record
      ? { ...record, snoozeUntil, updatedAt: nowMs }
      : { key, reasons: [], snoozeUntil, updatedAt: nowMs };
    if (!this.tryPersist({ ...state, [key]: nextRecord })) return false;
    return true;
  }

  countFor(key: string): number {
    return this.readState()[key]?.reasons.length ?? 0;
  }

  recordFor(key: string): AlertRecord | null {
    return this.readState()[key] ?? null;
  }

  /** Drops records untouched for more than 7 days so the store stays bounded. */
  prune(nowMs: number): void {
    const state = this.readState();
    const next: LedgerState = { ...state };
    let changed = false;
    for (const [key, record] of Object.entries(state)) {
      if (nowMs - record.updatedAt > PRUNE_AFTER_MS) {
        delete next[key];
        changed = true;
      }
    }
    if (changed) this.tryPersist(next);
  }
}
