// W9-DESIGN §D7 item 6 / §D2 — last-write-wins on `updatedAt` for mutable
// entities, end-to-end through the engine: a stale write must not clobber a
// newer one, whether the collision happens at push (server-side) or at
// apply (client-side pull), and ties break on the greater `id`.
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRepo } from "@/data";
import { setClock, systemClock } from "@/domain";
import { createSyncEngine } from "../engine";
import { createControllableClock, createFakeServer } from "./testSupport";

afterEach(() => {
  setClock(systemClock);
});

describe("last-write-wins by updatedAt, through the engine", () => {
  it("a newer write on one device replaces the value everywhere; a stale write clobbers nothing", async () => {
    const clock = createControllableClock("2026-08-09T00:00:00.000Z");
    setClock(clock);
    const { transport } = createFakeServer();

    const deviceA = createMemoryRepo();
    const deviceB = createMemoryRepo();
    // A third, long-offline device: it never sees A's or B's edits before
    // making (and syncing) its own.
    const deviceC = createMemoryRepo();
    const engineA = createSyncEngine({ repo: deviceA, transport, clock });
    const engineB = createSyncEngine({ repo: deviceB, transport, clock });
    const engineC = createSyncEngine({ repo: deviceC, transport, clock });

    const [medication] = await deviceA.listMedications();

    // A edits at T1 and syncs — the server's authoritative value becomes A's.
    clock.set("2026-08-09T01:00:00.000Z");
    await deviceA.updateMedication(medication.id, { name: "A's edit" });
    await engineA.syncOnce();

    // B edits later, at T2 > T1, and syncs — a genuinely newer write, which
    // must win and overwrite A's on the server.
    clock.set("2026-08-09T02:00:00.000Z");
    await deviceB.updateMedication(medication.id, { name: "B's edit" });
    await engineB.syncOnce();

    // C, offline this whole time, independently made its OWN edit back at
    // T1.5 — between A's and B's — and only syncs now, for the first time.
    // Its push must lose to the server's already-newer (B's, T2) row, and
    // its pull of the current server state must not re-clobber B's edit
    // with what C mistakenly still believes is current.
    clock.set("2026-08-09T01:30:00.000Z");
    await deviceC.updateMedication(medication.id, { name: "C's stale edit" });
    clock.set("2026-08-09T03:00:00.000Z"); // clock only needs to be later for the sync call itself
    await engineC.syncOnce();

    expect((await deviceC.getMedication(medication.id))?.name).toBe("B's edit");

    // And the value every device converges on, including A (which has not
    // touched this medication since its own, now-superseded edit).
    await engineA.syncOnce();
    expect((await deviceA.getMedication(medication.id))?.name).toBe("B's edit");
  });
});
