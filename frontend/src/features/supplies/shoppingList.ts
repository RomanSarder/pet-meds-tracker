// Renders SupplyItem[] into the plain, shareable shopping-list text SPEC
// §6.6 describes: name, quantity needed, which pets — one line per item.
// Pure: no React, no repo access.
import { joinMeta } from "@/features/pets/format";
import { neededLabel } from "./labels";
import type { SupplyItem } from "./model";

/** One line per item: "Metacam · 1 more pack · Clover, Nugget". SPEC §6.6: name, quantity, pets. */
export function shoppingListText(items: SupplyItem[]): string {
  return items
    .map((item) => {
      // neededLabel's packSize-null branch formats a bare quantity ("6 ml")
      // using the medication's unit, but neither SupplyItem nor
      // MedicationProjection carries `unit` — every fixture medication has
      // a packSize, so that branch never actually fires here. "" is an
      // inert fallback rather than threading `unit` through the contract.
      const quantity = neededLabel(item.projection.neededPacks, item.projection.needed, "");
      return joinMeta([item.name, quantity, item.petNames.join(", ") || undefined]);
    })
    .join("\n");
}
