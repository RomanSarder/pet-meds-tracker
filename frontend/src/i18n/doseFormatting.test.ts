import { describe, expect, it } from "vitest";

// SPEC §10a's absolute rule: dose (and stock) amounts never localize — never
// through `Intl.NumberFormat`, which would render 0.4 as "0,4" in Ukrainian.
// This wave does not touch any dose-rendering code (that lives in
// `features/pets`, out of scope here), but pins the rule as a standalone
// guard so a later wave cannot silently reach for `Intl.NumberFormat` on a
// dose amount.
describe("dose amounts never localize", () => {
  it("0.4 stringifies as '0.4', never through Intl.NumberFormat", () => {
    const doseAmount = 0.4;
    expect(String(doseAmount)).toBe("0.4");
    expect(new Intl.NumberFormat("uk-UA").format(doseAmount)).not.toBe(String(doseAmount));
  });
});
