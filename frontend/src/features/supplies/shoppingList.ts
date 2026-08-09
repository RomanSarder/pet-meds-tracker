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
      // The pack branch renders "N more pack(s)"; the no-packSize branch
      // renders a unit-bearing quantity (e.g. "3 ml").
      const quantity = neededLabel(item.projection.neededPacks, item.projection.needed, item.unit);
      return joinMeta([item.name, quantity, item.petNames.join(", ") || undefined]);
    })
    .join("\n");
}
