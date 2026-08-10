// Owned by the Supplies wave. Every user-facing string from
// `features/supplies/**` — `labels.ts`, `model.ts`, `stockOptions.ts`,
// `shoppingList.ts`, `SuppliesPage.tsx`, `UpdateStockDialog.tsx` and
// `ShoppingListDialog.tsx` — lives here.
//
// Three things deliberately do NOT appear here, because they are not words:
//   - dose/stock amounts ("3.3", "54"), which SPEC §10a keeps unlocalized —
//     `String(n)` only, via `amountLabel`/`doseLabel` in `features/pets/format.ts`;
//   - units ("ml", "tab", "drop"), which are user-entered DATA and are never
//     translated — see `pets.dose.countableUnit` for the English-only
//     morphology exception (I18N-DESIGN.md §4);
//   - dates ("Wed 12 Aug"), which come from `tr.fmt.weekdayDayMonth`, never
//     from a hand-written weekday/month table.
import type { Formatters } from "../formatters";

export interface SuppliesMessages {
  // --- labels.ts: frequencyLabel -------------------------------------------
  /** A once-daily course. Never "once daily" — kit's own vocabulary. */
  "supplies.frequency.daily": () => string;
  /** "2× daily", "3× daily". */
  "supplies.frequency.timesDaily": (p: { n: number }) => string;
  /** "every 5h" — a non-integer doses-per-day interval schedule. */
  "supplies.frequency.everyHours": (p: { hours: number }) => string;
  /** "every 2 days". */
  "supplies.frequency.everyDays": (p: { days: number }) => string;
  /** A single weekly weekday. */
  "supplies.frequency.weekly": () => string;

  // --- labels.ts: stockLabel -------------------------------------------------
  /** SPEC-pinned exactly: "Stock not set". */
  "supplies.stock.notSet": () => string;

  // --- labels.ts: neededLabel --------------------------------------------
  /** "1 more pack" / "2 more packs" — a real plural rule, never `+"s"`. */
  "supplies.needed.morePacks": (p: { n: number }) => string;

  // --- labels.ts: weeksOfCoverLabel ---------------------------------------
  /** "~7 weeks of cover", "~1 week of cover". Never "~0 weeks". */
  "supplies.weeksOfCover": (p: { weeks: number }) => string;

  // --- model.ts: the row's `note` slot, composed with " · " (joinMeta) ----
  /** "Still have {medicationName}? Update stock." — SPEC §8 stale-stock prompt. */
  "supplies.note.stillHaveUpdateStock": (p: { medicationName: string }) => string;
  /** "Runs out {date}" — `date` is already localized by `tr.fmt.weekdayDayMonth`. */
  "supplies.note.runsOut": (p: { date: string }) => string;
  /** "need {quantity}" — `quantity` is `neededLabel`'s already-localized output. */
  "supplies.note.need": (p: { quantity: string }) => string;

  // --- stockOptions.ts: coarseLevelLabel ----------------------------------
  "supplies.coarseLevel.full": () => string;
  "supplies.coarseLevel.aboutHalf": () => string;
  "supplies.coarseLevel.nearlyOut": () => string;
  "supplies.coarseLevel.empty": () => string;

  // --- SuppliesPage.tsx: page chrome --------------------------------------
  "supplies.title": () => string;
  "supplies.subtitle": () => string;
  "supplies.sort.byUrgency": () => string;
  "supplies.sort.byPet": () => string;
  "supplies.section.buyNow": () => string;
  "supplies.section.stocked": () => string;
  /** Visible text of the per-row toggle button. */
  "supplies.action.addToList": () => string;
  /** `aria-label`; `name` is DATA (a medication name). */
  "supplies.action.addToListLabel": (p: { name: string }) => string;
  /** Visible text of the per-row "Update stock" button. */
  "supplies.action.updateStock": () => string;
  /** `aria-label`; `name` is DATA. */
  "supplies.action.updateStockLabel": (p: { name: string }) => string;
  /** "Shopping list · N items" — the bottom bar button and the dialog's own
   *  empty-state title share this. A real plural rule: the pre-existing
   *  English "1 items" bug is fixed by routing through it. */
  "supplies.shoppingList.countLabel": (p: { count: number }) => string;

  // --- ShoppingListDialog.tsx ------------------------------------------------
  "supplies.shoppingList.dialogTitle": () => string;
  "supplies.shoppingList.copy": () => string;

  // --- UpdateStockDialog.tsx ------------------------------------------------
  "supplies.updateStock.title": () => string;
  "supplies.updateStock.unitsOnHand": () => string;
  "supplies.updateStock.addPack": () => string;
  "supplies.updateStock.cancel": () => string;
  "supplies.updateStock.save": () => string;
}

export const enSupplies = (f: Formatters): SuppliesMessages => ({
  "supplies.frequency.daily": () => "daily",
  "supplies.frequency.timesDaily": (p) => `${p.n}× daily`,
  "supplies.frequency.everyHours": (p) => `every ${p.hours}h`,
  "supplies.frequency.everyDays": (p) => `every ${p.days} days`,
  "supplies.frequency.weekly": () => "weekly",

  "supplies.stock.notSet": () => "Stock not set",

  "supplies.needed.morePacks": (p) =>
    f.plural(p.n, {
      one: `${p.n} more pack`,
      other: `${p.n} more packs`,
    }),

  "supplies.weeksOfCover": (p) =>
    f.plural(p.weeks, {
      one: `~${p.weeks} week of cover`,
      other: `~${p.weeks} weeks of cover`,
    }),

  "supplies.note.stillHaveUpdateStock": (p) => `Still have ${p.medicationName}? Update stock.`,
  "supplies.note.runsOut": (p) => `Runs out ${p.date}`,
  "supplies.note.need": (p) => `need ${p.quantity}`,

  "supplies.coarseLevel.full": () => "full",
  "supplies.coarseLevel.aboutHalf": () => "about half",
  "supplies.coarseLevel.nearlyOut": () => "nearly out",
  "supplies.coarseLevel.empty": () => "empty",

  "supplies.title": () => "Supplies",
  "supplies.subtitle": () => "Stock on hand vs. next 30 days",
  "supplies.sort.byUrgency": () => "By urgency",
  "supplies.sort.byPet": () => "By pet",
  "supplies.section.buyNow": () => "Buy now",
  "supplies.section.stocked": () => "Stocked",
  "supplies.action.addToList": () => "Add to list",
  "supplies.action.addToListLabel": (p) => `Add ${p.name} to list`,
  "supplies.action.updateStock": () => "Update stock",
  "supplies.action.updateStockLabel": (p) => `Update ${p.name} stock`,
  "supplies.shoppingList.countLabel": (p) =>
    `Shopping list · ${f.plural(p.count, { one: `${p.count} item`, other: `${p.count} items` })}`,

  "supplies.shoppingList.dialogTitle": () => "Shopping list",
  "supplies.shoppingList.copy": () => "Copy",

  "supplies.updateStock.title": () => "Update stock",
  "supplies.updateStock.unitsOnHand": () => "Units on hand",
  "supplies.updateStock.addPack": () => "Add a purchased pack",
  "supplies.updateStock.cancel": () => "Cancel",
  "supplies.updateStock.save": () => "Save",
});

export const ukSupplies = (f: Formatters): SuppliesMessages => ({
  "supplies.frequency.daily": () => "щодня",
  "supplies.frequency.timesDaily": (p) => `${p.n}× на день`,
  "supplies.frequency.everyHours": (p) => `кожні ${p.hours} год`,
  "supplies.frequency.everyDays": (p) => `кожні ${p.days} дн.`,
  "supplies.frequency.weekly": () => "щотижня",

  "supplies.stock.notSet": () => "Запас не вказано",

  // one: 1, 21 → 1 упаковка; few: 2–4 → 2 упаковки; many: 5–20 → 5 упаковок;
  // other: fractionals → 1.5 упаковки.
  "supplies.needed.morePacks": (p) =>
    f.plural(p.n, {
      one: `ще ${p.n} упаковка`,
      few: `ще ${p.n} упаковки`,
      many: `ще ${p.n} упаковок`,
      other: `ще ${p.n} упаковки`,
    }),

  // one: 1, 21 → ~1 тиждень; few: 2–4 → ~2 тижні; many: 5–20 → ~5 тижнів;
  // other: fractionals → ~1.5 тижня.
  "supplies.weeksOfCover": (p) =>
    f.plural(p.weeks, {
      one: `~${p.weeks} тиждень запасу`,
      few: `~${p.weeks} тижні запасу`,
      many: `~${p.weeks} тижнів запасу`,
      other: `~${p.weeks} тижня запасу`,
    }),

  "supplies.note.stillHaveUpdateStock": (p) => `Ще є ${p.medicationName}? Оновіть залишок.`,
  "supplies.note.runsOut": (p) => `Закінчується ${p.date}`,
  "supplies.note.need": (p) => `потрібно ${p.quantity}`,

  "supplies.coarseLevel.full": () => "повна",
  "supplies.coarseLevel.aboutHalf": () => "наполовину",
  "supplies.coarseLevel.nearlyOut": () => "майже порожньо",
  "supplies.coarseLevel.empty": () => "порожньо",

  "supplies.title": () => "Запаси",
  "supplies.subtitle": () => "Запас на руках проти наступних 30 днів",
  "supplies.sort.byUrgency": () => "За терміновістю",
  "supplies.sort.byPet": () => "За улюбленцем",
  "supplies.section.buyNow": () => "Купити зараз",
  "supplies.section.stocked": () => "Є в наявності",
  "supplies.action.addToList": () => "Додати до списку",
  "supplies.action.addToListLabel": (p) => `Додати ${p.name} до списку`,
  "supplies.action.updateStock": () => "Оновити запас",
  "supplies.action.updateStockLabel": (p) => `Оновити запас ${p.name}`,
  "supplies.shoppingList.countLabel": (p) =>
    `Список покупок · ${f.plural(p.count, {
      one: `${p.count} товар`,
      few: `${p.count} товари`,
      many: `${p.count} товарів`,
      other: `${p.count} товару`,
    })}`,

  "supplies.shoppingList.dialogTitle": () => "Список покупок",
  "supplies.shoppingList.copy": () => "Копіювати",

  "supplies.updateStock.title": () => "Оновити запас",
  "supplies.updateStock.unitsOnHand": () => "Одиниць на руках",
  "supplies.updateStock.addPack": () => "Додати куплену упаковку",
  "supplies.updateStock.cancel": () => "Скасувати",
  "supplies.updateStock.save": () => "Зберегти",
});
