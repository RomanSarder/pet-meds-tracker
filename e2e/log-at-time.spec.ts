// SPEC §6.1a "Log at a different time" — feature spec.
//
// Reuses the smoke spec's household unmodified: it already carries a
// `fixedTimes` course (Zeroxin, 08:00 due / 20:00 later) and a `fromLastDose`
// course (Onvaxil, anchored so its next dose is 12:00 — a `later`, not-yet-due
// occurrence at the pinned 07:30). That combination happens to cover both the
// "moves" vs "stays" consequence treatments AND the not-yet-due
// "At its scheduled time" case without any fixture changes.
//
// Every dose's overflow (`⋯`) is available regardless of its due/later state —
// only a `given` row loses it (SPEC §6.1) — so the pending Onvaxil and Zeroxin
// rows are reached the same way a real long-press/overflow tap would.
//
// The confirm/undo test uses the Zeroxin (fixedTimes) dose rather than the
// Onvaxil one the earlier scenarios open — see the FINDING comment on that
// test for why a fromLastDose confirm cannot be asserted "given in place".
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PINNED_NOW, SEED, seedHousehold } from "./fixtures/seed";

test.beforeEach(async ({ page }) => {
  // Before ANY navigation — see smoke.spec.ts.
  await page.clock.install({ time: PINNED_NOW });
  await seedHousehold(page);
  await page.goto("/today");
  await expect(page).toHaveURL(/\/today$/);
});

/**
 * Opens the sheet from a dose row's overflow menu, by medication name.
 * `.first()` matters for Zeroxin: `fixedTimes` contributes one row per time
 * (08:00 and 20:00), both sharing the same "More options for Zeroxin" name,
 * and `todayModel`'s `byDueAt` sort puts 08:00 first in DOM order.
 */
async function openSheet(page: Page, medicationName: string): Promise<void> {
  await page
    .getByRole("button", { name: `More options for ${medicationName}`, exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Log at a different time", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

/** The sheet's large headline — `data-testid` disambiguates it from the exact-time value box, which renders the same formatted time. */
function headline(page: Page): Locator {
  return page.getByTestId("log-at-time-headline");
}

/**
 * Selection as a real user's assistive tech would read it. The sheet sets
 * `aria-pressed` on every offset chip (SPEC §9 — selection must not be carried
 * by colour alone), so the accessible state is assertable directly and there
 * is no need to reach through to the inline style `Chip`'s `selected` prop
 * drives. Asserting the state rather than the styling also means a repaint of
 * the chip's colours cannot break this spec.
 */
async function isChipSelected(chip: Locator): Promise<boolean> {
  return (await chip.getAttribute("aria-pressed")) === "true";
}

test("opens a fromLastDose dose 30 minutes ago by default; offsets move the headline, the moves consequence, and cap +5 min at now", async ({
  page,
}) => {
  await openSheet(page, SEED.intervalMedicationName);

  // Default: 30 min before the pinned 07:30 → 07:00, with that chip selected.
  await expect(headline(page)).toHaveText("07:00");
  expect(await isChipSelected(page.getByRole("button", { name: "30 min", exact: true }))).toBe(
    true,
  );
  expect(await isChipSelected(page.getByRole("button", { name: "Just now", exact: true }))).toBe(
    false,
  );

  const consequence = page.getByText(/^Next dose moves to \d{2}:\d{2}$/);
  const before = await consequence.textContent();

  // Each chip moves the headline...
  await page.getByRole("button", { name: "15 min", exact: true }).click();
  await expect(headline(page)).toHaveText("07:15");
  await page.getByRole("button", { name: "1 h", exact: true }).click();
  await expect(headline(page)).toHaveText("06:30");
  await page.getByRole("button", { name: "2 h", exact: true }).click();
  await expect(headline(page)).toHaveText("05:30");

  // ...and the consequence block's whole reason for existing is that its named
  // time actually follows: assert the change, not merely the text's presence.
  const after = await consequence.textContent();
  expect(after).not.toBe(before);

  // Just now lands exactly on the pinned instant, which caps + 5 min.
  await page.getByRole("button", { name: "Just now", exact: true }).click();
  await expect(headline(page)).toHaveText("07:30");
  await expect(page.getByRole("button", { name: "+ 5 min", exact: true })).toBeDisabled();
});

test("'at its scheduled time' sets the headline in one tap; a not-yet-due dose gets a future, disabled confirm", async ({
  page,
}) => {
  await openSheet(page, SEED.intervalMedicationName);

  await page.getByRole("button", { name: /At its scheduled time/ }).click();
  await expect(headline(page)).toHaveText(SEED.intervalDueTime);
  // "turns berry if the value is in the future" (SPEC §6.1a).
  expect(await headline(page).evaluate((el) => (el as HTMLElement).style.color)).toBe(
    "var(--alert)",
  );

  const confirm = page.getByRole("button", { name: `Log at ${SEED.intervalDueTime}`, exact: true });
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeDisabled();
});

// FINDING (reported, not routed around): confirming a fromLastDose log does
// NOT leave a "given" row in place. `getOccurrences` regenerates the day's
// occurrences from the recomputed chain, and the just-logged instant becomes
// the new anchor — so the row this sheet was opened from is replaced by the
// freshly projected NEXT occurrence (a different `Occurrence.key`), not shown
// resolved. `keepResolved` (TodayPage.tsx) cannot rescue it: it retains rows
// by key, and the given event's key never reappears in a refetch. This test
// therefore exercises confirm/undo on the fixedTimes dose instead, where the
// calendar slot's key is stable across a log — see the report for detail.
test("confirming logs the dose in place, hides the overflow, and undo restores it", async ({
  page,
}) => {
  // `.first()` inside `openSheet` reaches the 08:00 Zeroxin occurrence.
  await openSheet(page, SEED.fixedMedicationName);

  // The 30-min-ago default (07:00) is a valid past time — no need to touch a chip.
  await expect(headline(page)).toHaveText("07:00");
  await page.getByRole("button", { name: "Log at 07:00", exact: true }).click();

  // SPEC §1: logging never navigates away.
  await expect(page).toHaveURL(/\/today$/);

  const givenRow = page.getByRole("group", { name: `${SEED.fixedDoseTitle}, given`, exact: true });
  await expect(givenRow).toBeVisible();
  await expect(givenRow.getByRole("button", { name: /More options/ })).toHaveCount(0);

  const toast = page.getByRole("status");
  await expect(toast).toContainText(`${SEED.fixedMedicationName} logged`);

  await toast.getByRole("button", { name: "Undo", exact: true }).click();

  // Back to pending — the 20:00 Zeroxin row shares the same unsuffixed name,
  // so `.first()` (chronological DOM order, as in `openSheet`) is what pins
  // this assertion to the 08:00 occurrence specifically.
  const revertedRow = page.getByRole("group", { name: SEED.fixedDoseTitle, exact: true }).first();
  await expect(revertedRow).toBeVisible();
  await expect(revertedRow.getByRole("button", { name: /More options/ })).toBeVisible();
});

test("a fixedTimes course shows the 'stays' consequence, unmoved by the chosen time", async ({
  page,
}) => {
  // `.first()` in `openSheet` reaches the 08:00 occurrence, not the 20:00 one.
  await openSheet(page, SEED.fixedMedicationName);

  await expect(headline(page)).toHaveText("07:00");
  const nextSlot = SEED.fixedTimes[1]; // the 08:00 occurrence's own next slot, same day.
  const consequence = page.getByText(`Next dose stays at ${nextSlot}`, { exact: true });
  await expect(consequence).toBeVisible();

  // Missing a dose does not shift later doses (SPEC §3a) — the named time must
  // hold even as the chosen time moves, unlike the fromLastDose "moves" case.
  await page.getByRole("button", { name: "1 h", exact: true }).click();
  await expect(headline(page)).toHaveText("06:30");
  await expect(consequence).toBeVisible();
});
