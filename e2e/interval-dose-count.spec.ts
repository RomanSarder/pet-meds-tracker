// SPEC §4's row pill on a `fromLastDose` course, end to end.
//
// THE BUG THIS PINS. An interval chain renders at most ONE occurrence at a
// time — the current head — so a pill counting rendered occurrences read
// "0 of 1 doses" all day, however many doses had actually gone in. The count
// now comes off the DoseEvent ledger, and the denominator is either the
// course's own `maxPerDay` or nothing at all.
//
// Everything here is asserted INSIDE the interval row's own `role="group"`
// (labelled with the dose title): the seeded household also has a `fixedTimes`
// course carrying its own "N of M doses" pill, and a page-wide text match
// would not distinguish them.
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  intervalDoseGivenAt,
  PINNED_NOW,
  SEED,
  seedHousehold,
  withIntervalMaxPerDay,
  buildSeedBackup,
} from "./fixtures/seed";

/**
 * A second dose for the seed day, given at 05:00 — an hour after the seeded
 * 04:00 anchor.
 *
 * `scheduledFor` is the chain head the anchor created (04:00 + 8h), so this
 * reads as that occurrence given early, exactly the row the app itself would
 * write. 05:00 is also more than the 8h interval's 90-minute grace away from
 * the spec's own 07:30 `now`, so a give driven through the UI below is not met
 * by the early-give confirm dialog — this spec is about the count, not that
 * dialog.
 */
function seedWithTwoDosesToday() {
  return intervalDoseGivenAt(buildSeedBackup(), {
    id: "66666666-6666-4666-8666-000000000002",
    givenAt: "2026-08-08T05:00:00.000Z",
    scheduledFor: "2026-08-08T12:00:00.000Z",
  });
}

/**
 * The interval course's PENDING row, whose accessible name is exactly the dose
 * title. `exact` is load-bearing: a row that has just been given is relabelled
 * "<title>, given" and would otherwise also match on a substring, leaving two
 * rows under this locator for the moment before the re-anchored chain's
 * refetch drops the resolved one.
 */
function intervalRow(page: Page): Locator {
  return page.getByRole("group", { name: SEED.intervalDoseTitle, exact: true });
}

async function openToday(page: Page): Promise<void> {
  await page.goto("/today");
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText(SEED.petName, { exact: true })).toBeVisible();
}

test("an interval course's pill counts every dose given today, not the one rendered occurrence", async ({
  page,
}) => {
  await page.clock.install({ time: PINNED_NOW });
  await seedHousehold(page, seedWithTwoDosesToday());
  await openToday(page);

  const row = intervalRow(page);
  // Two doses in the ledger for today, one row on the screen.
  await expect(row).toHaveCount(1);
  await expect(row.getByText("2 doses given")).toBeVisible();
  // The old, occurrence-derived pill would have said this instead.
  await expect(row.getByText("0 of 1 doses")).toHaveCount(0);

  // And it moves when a dose is actually given. The chain re-anchors on the
  // give, so the row this resolves is replaced by the next head — the pill on
  // that new row is the one carrying the day's count forward.
  await row.getByRole("button", { name: "Give" }).click();
  await expect(intervalRow(page).getByText("3 doses given")).toBeVisible();
});

test("the seeded single-dose day reads in the singular, with no denominator", async ({ page }) => {
  await page.clock.install({ time: PINNED_NOW });
  await seedHousehold(page);
  await openToday(page);

  // The seed's only interval dose is the 04:00 anchor.
  await expect(intervalRow(page).getByText("1 dose given")).toBeVisible();
});

test("a daily maximum supplies the denominator, and the pill turns amber at the cap", async ({
  page,
}) => {
  await page.clock.install({ time: PINNED_NOW });
  await seedHousehold(page, withIntervalMaxPerDay(seedWithTwoDosesToday(), 3));
  await openToday(page);

  const row = intervalRow(page);
  await expect(row.getByText("2 of 3 max")).toBeVisible();

  // The third dose reaches the cap: same sentence, now the `capped` state —
  // the ordinary Give is replaced by the ghost "Give anyway" (SPEC §3b-i).
  await row.getByRole("button", { name: "Give" }).click();

  const capped = intervalRow(page);
  await expect(capped.getByText("3 of 3 max")).toBeVisible();
  await expect(
    capped.getByRole("button", { name: `Give ${SEED.intervalMedicationName} anyway` }),
  ).toBeVisible();
  await expect(capped.getByRole("button", { name: "Give", exact: true })).toHaveCount(0);
});
