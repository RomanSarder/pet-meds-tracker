// Harness proof, not a feature test.
//
// It asserts exactly the three things that have to work before anyone can
// write a real spec: the recorded session gets past `appLayoutRoute`'s
// `beforeLoad` without a bounce to /sign-in, the Settings import actually
// lands a household in IndexedDB, and a pinned clock makes the engine's
// scheduling output reproducible. Anything about how the Today sheet looks or
// behaves belongs in a feature spec, not here.
import { expect, test } from "@playwright/test";
import { PINNED_NOW, SEED, seedHousehold } from "./fixtures/seed";

test("a seeded, authenticated household renders both courses' doses on /today", async ({ page }) => {
  // Before ANY navigation. `setClock` from `frontend/src/domain/clock.ts` is
  // module-local — no window hook, no query param, no import.meta.env branch —
  // so the browser has no way to inject a clock. Playwright's overrides
  // `Date`/`setTimeout`/`setInterval` from outside instead, which also pins
  // `useNow`'s local-midnight timer and the 30s background-sync poll.
  await page.clock.install({ time: PINNED_NOW });

  await seedHousehold(page);

  // Straight to /today, never "/": the index route is the only one that calls
  // `GET /api/household` and redirects to /welcome on a 404, and this user has
  // no server-side household. /today has no `beforeLoad` of its own, so a
  // valid session is sufficient.
  await page.goto("/today");
  await expect(page).toHaveURL(/\/today$/);

  await expect(page.getByText(SEED.petName, { exact: true })).toBeVisible();

  // The fixedTimes course contributes one row per time in the schedule...
  await expect(page.getByText(SEED.fixedDoseTitle, { exact: true })).toHaveCount(2);
  for (const time of SEED.fixedTimes) {
    await expect(page.getByText(time, { exact: false }).first()).toBeVisible();
  }

  // ...and the fromLastDose course contributes one, at anchor + intervalHours.
  // A concrete time here is what proves the anchoring `given` event took: with
  // no anchor the row reads "not started" and carries no clock time at all.
  await expect(page.getByText(SEED.intervalDoseTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(SEED.intervalDueTime, { exact: false }).first()).toBeVisible();
});
