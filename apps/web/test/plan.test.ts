import { describe, expect, it, vi } from "vitest";
import { ApiError, type Api } from "../src/api/client";
import { contrastRatio, tableColor, TABLE_COLORS, textOn } from "../src/plan/colors";
import {
  addTable,
  changedFields,
  draftFromZone,
  draftIssues,
  pendingChanges,
  rebase,
  removeTable,
  restoreTable,
  updateTable,
} from "../src/plan/draft";
import {
  findFreeSpot,
  nextLabel,
  normalizeRotation,
  rotationFromHandle,
  sizeFromHandle,
  snap,
  toTableFrame,
} from "../src/plan/geometry";
import { saveChanges } from "../src/plan/save";
import { table, zone } from "./fixtures";

describe("geometry", () => {
  it("snaps to the 5 cm grid and keeps angles between 0 and 359", () => {
    expect(snap(12)).toBe(10);
    expect(snap(13)).toBe(15);
    expect(normalizeRotation(-15)).toBe(345);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(721)).toBe(1);
  });

  it("sees a point from the table's own turn", () => {
    const turned = table({ id: "a", x: 100, y: 100, rotation: 90 });
    const local = toTableFrame({ x: 100, y: 150 }, turned);
    expect(local.x).toBeCloseTo(50);
    expect(local.y).toBeCloseTo(0);
  });

  it("resizes from the corner handle around the centre", () => {
    const rect = table({ id: "a", x: 100, y: 100, width: 80, height: 80 });
    expect(sizeFromHandle(rect, { x: 160, y: 125 })).toEqual({ width: 120, height: 50 });
    // Never smaller than 30 cm.
    expect(sizeFromHandle(rect, { x: 101, y: 101 })).toEqual({ width: 30, height: 30 });
    // A round table that is a circle stays a circle.
    const circle = table({ id: "b", shape: "round", x: 0, y: 0, width: 90, height: 90 });
    expect(sizeFromHandle(circle, { x: 60, y: 20 })).toEqual({ width: 120, height: 120 });
  });

  it("turns towards the handle in 15 degree steps", () => {
    const t = table({ id: "a", x: 0, y: 0 });
    expect(rotationFromHandle(t, { x: 0, y: -100 })).toBe(0);
    expect(rotationFromHandle(t, { x: 100, y: 0 })).toBe(90);
    expect(rotationFromHandle(t, { x: 100, y: 8 })).toBe(90);
    expect(rotationFromHandle(t, { x: -100, y: 0 })).toBe(270);
  });

  it("finds a free spot that does not touch other tables", () => {
    const busy = [table({ id: "a", x: 60, y: 60, width: 80, height: 80 })];
    const spot = findFreeSpot({ width: 1000, height: 600 }, busy, 80, 80);
    expect(spot.x - 40).toBeGreaterThanOrEqual(100 + 20);
    expect(spot.y).toBe(60);
  });

  it("numbers new tables after the highest number", () => {
    expect(nextLabel([{ label: "1" }, { label: "7" }, { label: "Bar" }])).toBe("8");
    expect(nextLabel([])).toBe("1");
  });
});

describe("colours", () => {
  it("reads the table colour from its style and falls back to linen", () => {
    expect(tableColor({ color: "#8A5A3B" })).toBe("#8a5a3b");
    expect(tableColor({ color: "red" })).toBe("#e6dcc6");
    expect(tableColor({})).toBe("#e6dcc6");
  });

  it("writes labels in a colour with enough contrast on every table colour", () => {
    for (const { hex } of TABLE_COLORS) {
      expect(contrastRatio(hex, textOn(hex)), hex).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("the draft", () => {
  const stored = zone([table({ id: "a", x: 100, y: 100 }), table({ id: "b", x: 300, y: 100 })]);

  it("lists only what changed, removals first and new tables last", () => {
    let draft = draftFromZone(stored);
    draft = updateTable(draft, "a", { x: 120 });
    draft = removeTable(draft, "b");
    draft = addTable(draft, table({ id: "new:1", label: "9", x: 500 }));

    const changes = pendingChanges(draft);
    expect(changes.map((change) => change.kind)).toEqual(["delete", "update", "create"]);
    expect(changes[1]).toMatchObject({ kind: "update", id: "a", fields: { x: 120 } });
    expect(changes[2]).toMatchObject({ kind: "create", fields: { label: "9", x: 500 } });
    expect(changes[2]?.kind === "create" && "zoneId" in changes[2].fields).toBe(false);
  });

  it("forgets a change that was undone by hand", () => {
    let draft = draftFromZone(stored);
    draft = updateTable(draft, "a", { x: 120 });
    draft = updateTable(draft, "a", { x: 100 });
    expect(pendingChanges(draft)).toEqual([]);
  });

  it("compares styles by content", () => {
    const saved = table({ id: "a", style: { color: "#8a5a3b" } });
    expect(changedFields(saved, { ...saved, style: { color: "#8a5a3b" } })).toEqual({});
    expect(changedFields(saved, { ...saved, style: {} })).toEqual({ style: {} });
  });

  it("checks the plan on screen with the engine", () => {
    const draft = updateTable(draftFromZone(stored), "b", { x: 130 });
    expect(draftIssues(draft, stored)).toEqual([
      { code: "overlap", tableId: "a", otherTableId: "b" },
    ]);
  });

  it("puts a removed table back as it was stored", () => {
    const removed = removeTable(updateTable(draftFromZone(stored), "b", { x: 900 }), "b");
    const back = restoreTable(removed, "b");
    expect(back.deleted).toEqual([]);
    expect(back.tables.find((t) => t.id === "b")?.x).toBe(300);
  });

  it("after saving, keeps only the changes that did not get through", () => {
    let draft = draftFromZone(stored);
    draft = updateTable(draft, "a", { x: 120 });
    draft = updateTable(draft, "b", { label: "B" });
    draft = addTable(draft, table({ id: "new:7", label: "7" }));
    // The API took "a" and the new table; "b" was refused.
    const now = zone([
      table({ id: "a", x: 120, y: 100 }),
      table({ id: "b", x: 300, y: 100 }),
      table({ id: "c", label: "7" }),
    ]);
    const after = rebase(draft, now, new Set(["b"]));
    expect(after.tables.map((t) => [t.id, t.label, t.x])).toEqual([
      ["a", "a", 120],
      ["b", "B", 300],
      ["c", "7", 200],
    ]);
    expect(pendingChanges(after)).toEqual([
      { kind: "update", id: "b", label: "B", fields: { label: "B" } },
    ]);
  });
});

describe("saving", () => {
  const api = () => ({
    createTable: vi.fn<Api["createTable"]>(),
    updateTable: vi.fn<Api["updateTable"]>(),
    deleteTable: vi.fn<Api["deleteTable"]>(),
  });

  it("tries a refused move again once the table in its way has moved", async () => {
    const calls = api();
    let blocked = true;
    calls.updateTable.mockImplementation((_slug: string, id: string) => {
      if (id === "a" && blocked) return Promise.reject(new ApiError(422, "invalid"));
      if (id === "b") blocked = false;
      return Promise.resolve(table({ id }));
    });
    const result = await saveChanges(calls, "v", "zone-1", [
      { kind: "update", id: "a", label: "a", fields: { x: 300 } },
      { kind: "update", id: "b", label: "b", fields: { x: 500 } },
    ]);
    expect(result.failures).toEqual([]);
    expect(result.saved).toBe(2);
    expect(calls.updateTable.mock.calls.map((call) => call[1])).toEqual(["a", "b", "a"]);
  });

  it("gives up on changes that stay invalid, and reports other refusals", async () => {
    const calls = api();
    calls.updateTable.mockRejectedValue(new ApiError(422, "invalid"));
    calls.deleteTable.mockRejectedValue(
      new ApiError(409, "booked", { code: "upcoming_reservations", count: 2 }),
    );
    const result = await saveChanges(calls, "v", "zone-1", [
      { kind: "delete", id: "x", label: "x" },
      { kind: "update", id: "a", label: "a", fields: { x: 1 } },
    ]);
    expect(result.saved).toBe(0);
    expect(result.failures.map((f) => [f.change.id, f.error.status])).toEqual([
      ["x", 409],
      ["a", 422],
    ]);
    expect(calls.updateTable).toHaveBeenCalledTimes(1);
  });

  it("stops at once when the session has ended, and keeps the rest unsent", async () => {
    const calls = api();
    calls.updateTable.mockRejectedValue(new ApiError(401, "Please sign in first."));
    const result = await saveChanges(calls, "v", "zone-1", [
      { kind: "update", id: "a", label: "a", fields: { x: 1 } },
      { kind: "update", id: "b", label: "b", fields: { x: 2 } },
    ]);
    expect(result.failures).toHaveLength(1);
    expect(result.unsent.map((change) => change.id)).toEqual(["b"]);
    expect(calls.updateTable).toHaveBeenCalledTimes(1);
  });

  it("remembers which new table became which stored one", async () => {
    const calls = api();
    calls.createTable.mockResolvedValue(table({ id: "stored-id", label: "5" }));
    const result = await saveChanges(calls, "v", "zone-1", [
      {
        kind: "create",
        id: "new:3",
        label: "5",
        fields: {
          label: "5",
          minSeats: 2,
          maxSeats: 4,
          shape: "rect",
          x: 1,
          y: 1,
          width: 80,
          height: 80,
          rotation: 0,
          style: {},
          bookable: true,
        },
      },
    ]);
    expect(result.created.get("new:3")?.id).toBe("stored-id");
  });
});
