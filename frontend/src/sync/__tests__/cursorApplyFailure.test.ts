// W9-DESIGN §D7 item 6 / §D6 — the cursor advances only after a successful
// `applyRemoteChanges`, so a crash mid-apply re-delivers the same page
// rather than skipping it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRepo } from "@/data";
import { setClock, systemClock } from "@/domain";
import { createSyncEngine } from "../engine";
import { createControllableClock, createFakeServer } from "./testSupport";

afterEach(() => {
  setClock(systemClock);
});

describe("cursor advancement", () => {
  it("does not advance the syncCursor when applyRemoteChanges rejects", async () => {
    const clock = createControllableClock("2026-08-09T00:00:00.000Z");
    setClock(clock);
    const { transport } = createFakeServer();

    // A source device pushes a real change so the device under test has
    // something to pull.
    const source = createMemoryRepo();
    const engineSource = createSyncEngine({ repo: source, transport, clock });
    const [course] = await source.listCourses();
    await source.updateCourse(course.id, { notes: "pushed by source" });
    await engineSource.syncOnce();

    const underTest = createMemoryRepo();
    const engineUnderTest = createSyncEngine({ repo: underTest, transport, clock });

    const cursorBefore = await underTest.getMeta("syncCursor");
    expect(cursorBefore).toBeNull();

    const applySpy = vi
      .spyOn(underTest, "applyRemoteChanges")
      .mockRejectedValueOnce(new Error("simulated crash mid-apply"));

    await expect(engineUnderTest.syncOnce()).rejects.toThrow("simulated crash mid-apply");
    expect(await underTest.getMeta("syncCursor")).toBe(cursorBefore);
    // The failed apply never touched the course locally.
    expect((await underTest.getCourse(course.id))?.notes).not.toBe("pushed by source");

    applySpy.mockRestore();

    // Retrying re-delivers the same page rather than skipping it.
    await engineUnderTest.syncOnce();
    expect(await underTest.getMeta("syncCursor")).not.toBeNull();
    expect((await underTest.getCourse(course.id))?.notes).toBe("pushed by source");
  });
});
