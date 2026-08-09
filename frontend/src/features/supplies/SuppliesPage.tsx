// The Supplies screen (SPEC §6.6) — assembly only.
//
// Transcribed element-for-element and style-object-for-style-object from the
// design kit's `ui_kits/petmeds-app/SuppliesScreen.jsx` (see
// CONTRACT-supplies.md "The kit composition being transcribed"). Every string
// and every layout decision below traces back to either the kit or one of the
// six enumerated "Spec-required departures from the kit" — nothing here is
// invented.
//
// What is left for this file to own: reading real data through `./hooks`
// instead of the kit's fixture arrays, the sort/listed/dialog state the kit's
// own component held, and wiring the two dialogs (`UpdateStockDialog`,
// `ShoppingListDialog`) the kit had no slot for.
import { useMemo, useState, type ReactElement } from "react";
import { Button, EmptyState, ScreenHeader, SectionLabel, SupplyRow } from "@/components/ds";
import { SegmentedControl } from "@/components/ds/core/SegmentedControl";
import type { Medication } from "@/domain";
import { useNow } from "@/app/useNow";
import { useSupplyData } from "./hooks";
import { buildSupplyItems, sortSupplyItems, SUPPLY_SORTS, type SupplyItem, type SupplySort } from "./model";
import { ShoppingListDialog } from "./ShoppingListDialog";
import { UpdateStockDialog } from "./UpdateStockDialog";

const SCREEN_STYLE = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
} as const;

const SORT_ROW_STYLE = { padding: "0 22px 14px" } as const;

const LIST_STYLE = {
  flex: 1,
  overflowY: "auto",
  padding: "0 22px 22px",
  display: "flex",
  flexDirection: "column",
  gap: 12,
} as const;

const BOTTOM_BAR_STYLE = { padding: "12px 22px 22px" } as const;

const ACTIONS_STYLE = { display: "flex", gap: 8 } as const;

export function SuppliesPage(): ReactElement {
  // Never a bare `new Date()` — the whole projection is a pure function of an
  // explicit `now`, and this is the one place that reads the injected clock.
  const now = useNow();
  const { medications, courses, pets, adjustments, isLoading } = useSupplyData();

  // "By urgency" is the default (SPEC §6.6).
  const [sort, setSort] = useState<SupplySort>(SUPPLY_SORTS[0]);
  // Medication ids toggled onto the shopping list via "Add to list".
  const [listed, setListed] = useState<ReadonlySet<string>>(() => new Set());
  const [shoppingOpen, setShoppingOpen] = useState(false);
  const [stockMedication, setStockMedication] = useState<Medication | null>(null);

  const medicationById = useMemo(
    () => new Map(medications.map((m) => [m.id, m] as const)),
    [medications],
  );

  const items = useMemo(
    () =>
      sortSupplyItems(
        buildSupplyItems({ medications, courses, pets, adjustments, now }),
        sort,
      ),
    [medications, courses, pets, adjustments, now, sort],
  );

  // Sorting never moves an item between groups (model.ts); the split happens
  // after sorting so each group's internal order follows the chosen sort.
  const buy = items.filter((item) => item.buyNow);
  const ok = items.filter((item) => !item.buyNow);
  const listedItems = items.filter((item) => listed.has(item.medicationId));

  function toggleListed(medicationId: string) {
    setListed((prev) => {
      const next = new Set(prev);
      if (next.has(medicationId)) {
        next.delete(medicationId);
      } else {
        next.add(medicationId);
      }
      return next;
    });
  }

  function openUpdateStock(medicationId: string) {
    const medication = medicationById.get(medicationId);
    if (medication) setStockMedication(medication);
  }

  function actionsFor(item: SupplyItem) {
    return (
      <div style={ACTIONS_STYLE}>
        {item.buyNow ? (
          // Visible text stays exactly the kit's "Add to list"; membership is
          // conveyed through `aria-pressed`, not a relabel, per the contract.
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Add ${item.name} to list`}
            aria-pressed={listed.has(item.medicationId)}
            onClick={() => toggleListed(item.medicationId)}
          >
            Add to list
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Update ${item.name} stock`}
          onClick={() => openUpdateStock(item.medicationId)}
        >
          Update stock
        </Button>
      </div>
    );
  }

  // Loading: nothing beyond the header, matching the house pattern in
  // `TodayPage.tsx` of showing the real chrome rather than a spinner screen.
  if (isLoading) {
    return (
      <div style={SCREEN_STYLE}>
        <ScreenHeader title="Supplies" subtitle="Stock on hand vs. next 30 days" />
      </div>
    );
  }

  return (
    <div style={SCREEN_STYLE}>
      <ScreenHeader title="Supplies" subtitle="Stock on hand vs. next 30 days" />
      <div style={SORT_ROW_STYLE}>
        <SegmentedControl
          options={SUPPLY_SORTS}
          value={sort}
          onChange={(value) => setSort(value as SupplySort)}
        />
      </div>
      <div style={LIST_STYLE}>
        {items.length === 0 ? (
          // Departure 5: the DS EmptyState in place of the kit's fixture-only
          // groups, when there is nothing to show at all — the stub's
          // existing copy.
          <EmptyState icon="package" title="Supplies" />
        ) : (
          <>
            {/*
              Both section labels render unconditionally, exactly as the kit's
              SuppliesScreen.jsx does. Suppressing an empty group's label would
              be a layout decision this slice has no authority to make: the kit
              is the layout authority and this screen is a transcription of it.
              The nothing-to-show-at-all case is handled above by EmptyState.
            */}
            <SectionLabel tone="alert">Buy now</SectionLabel>
            {buy.map((item) => (
              <SupplyRow
                key={item.medicationId}
                name={item.name}
                forWhom={item.forWhom}
                stock={item.stock}
                tone={item.tone}
                percent={item.percent}
                note={item.note}
                action={actionsFor(item)}
              />
            ))}
            <SectionLabel>Stocked</SectionLabel>
            {ok.map((item) => (
              <SupplyRow
                key={item.medicationId}
                name={item.name}
                forWhom={item.forWhom}
                stock={item.stock}
                tone={item.tone}
                percent={item.percent}
                note={item.note}
                action={actionsFor(item)}
              />
            ))}
          </>
        )}
      </div>
      <div style={BOTTOM_BAR_STYLE}>
        <Button
          variant="ink"
          size="lg"
          block
          // Departure 6: the kit asks for "shopping-basket", but the frozen
          // DS types `IconName` as a closed union (components/ds/core/icons.ts)
          // that never registered that glyph — only "shopping-cart". Forced
          // substitution to the nearest registered glyph, not a design choice.
          icon="shopping-cart"
          onClick={() => setShoppingOpen(true)}
        >
          Shopping list · {listed.size} items
        </Button>
      </div>

      {stockMedication ? (
        <UpdateStockDialog
          open={stockMedication !== null}
          onOpenChange={(open) => {
            if (!open) setStockMedication(null);
          }}
          medication={stockMedication}
        />
      ) : null}
      <ShoppingListDialog open={shoppingOpen} onOpenChange={setShoppingOpen} items={listedItems} />
    </div>
  );
}
