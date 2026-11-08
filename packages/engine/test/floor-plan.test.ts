import { describe, expect, it } from "vitest";
import { boundingBox, validateZone, type PlanTable, type PlanZone } from "../src/index.js";

function table(overrides: Partial<PlanTable> & { id: string }): PlanTable {
  return {
    label: overrides.id,
    minSeats: 2,
    maxSeats: 4,
    shape: "rect",
    x: 100,
    y: 100,
    width: 80,
    height: 80,
    rotation: 0,
    ...overrides,
  };
}

function zone(tables: PlanTable[]): PlanZone {
  return { id: "z1", name: "Dining room", width: 1000, height: 600, tables };
}

describe("boundingBox", () => {
  it("is the table itself when it is not rotated", () => {
    expect(boundingBox(table({ id: "t1", width: 120, height: 80 }))).toEqual({
      left: 40,
      top: 60,
      right: 160,
      bottom: 140,
    });
  });

  it("swaps width and height at 90 degrees", () => {
    const box = boundingBox(table({ id: "t1", width: 120, height: 80, rotation: 90 }));
    expect(box.right - box.left).toBeCloseTo(80);
    expect(box.bottom - box.top).toBeCloseTo(120);
  });

  it("grows at 45 degrees", () => {
    const box = boundingBox(table({ id: "t1", width: 100, height: 100, rotation: 45 }));
    expect(box.right - box.left).toBeCloseTo(100 * Math.SQRT2);
  });

  it("ignores rotation for round tables", () => {
    const box = boundingBox(
      table({ id: "t1", shape: "round", width: 90, height: 90, rotation: 45 }),
    );
    expect(box.right - box.left).toBe(90);
  });
});

describe("validateZone", () => {
  it("accepts a sensible plan", () => {
    const plan = zone([table({ id: "t1", x: 100 }), table({ id: "t2", x: 300 })]);
    expect(validateZone(plan)).toEqual([]);
  });

  it("accepts tables that only touch", () => {
    const plan = zone([table({ id: "t1", x: 100 }), table({ id: "t2", x: 180 })]);
    expect(validateZone(plan)).toEqual([]);
  });

  it("reports overlapping tables once per pair", () => {
    const plan = zone([table({ id: "t1", x: 100 }), table({ id: "t2", x: 150 })]);
    expect(validateZone(plan)).toEqual([{ code: "overlap", tableId: "t1", otherTableId: "t2" }]);
  });

  it("reports a table that pokes out of the room", () => {
    const plan = zone([table({ id: "t1", x: 990 })]);
    expect(validateZone(plan)).toEqual([{ code: "outside_zone", tableId: "t1" }]);
  });

  it("reports a rotated table that only leaves the room once rotated", () => {
    const nearWall = { id: "t1", x: 300, y: 50, width: 120, height: 40 };
    expect(validateZone(zone([table({ ...nearWall, rotation: 0 })]))).toEqual([]);
    const rotated = zone([table({ ...nearWall, rotation: 90 })]);
    expect(validateZone(rotated)).toEqual([{ code: "outside_zone", tableId: "t1" }]);
  });

  it("reports impossible seat counts", () => {
    const plan = zone([
      table({ id: "t1", x: 100, minSeats: 4, maxSeats: 2 }),
      table({ id: "t2", x: 300, minSeats: 0, maxSeats: 2 }),
      table({ id: "t3", x: 500, minSeats: 1.5, maxSeats: 2 }),
    ]);
    expect(validateZone(plan).map((issue) => issue.tableId)).toEqual(["t1", "t2", "t3"]);
  });
});
