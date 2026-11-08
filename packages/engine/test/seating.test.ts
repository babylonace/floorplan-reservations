import { describe, expect, it } from "vitest";
import {
  canJoin,
  canStillSeat,
  seatingOptions,
  type PlanTable,
  type PlanZone,
} from "../src/index.js";

function table(overrides: Partial<PlanTable> & { id: string }): PlanTable {
  return {
    label: overrides.id,
    minSeats: 1,
    maxSeats: 2,
    shape: "rect",
    x: 100,
    y: 100,
    width: 80,
    height: 80,
    rotation: 0,
    ...overrides,
  };
}

function zone(id: string, tables: PlanTable[]): PlanZone {
  return { id, name: id, width: 2000, height: 2000, tables };
}

// Three 2-seat tables in a row, edges touching, and a 4-seat table far away.
const row = zone("room", [
  table({ id: "a", x: 100 }),
  table({ id: "b", x: 180 }),
  table({ id: "c", x: 260 }),
  table({ id: "big", x: 1000, y: 1000, minSeats: 3, maxSeats: 4, width: 120 }),
]);

describe("canJoin", () => {
  it("joins tables whose edges touch or nearly touch", () => {
    expect(canJoin(table({ id: "a" }), table({ id: "b", x: 180 }), 5)).toBe(true);
    expect(canJoin(table({ id: "a" }), table({ id: "b", x: 184 }), 5)).toBe(true);
    expect(canJoin(table({ id: "a" }), table({ id: "b", y: 180 }), 5)).toBe(true);
  });

  it("does not join tables with a real gap between them", () => {
    expect(canJoin(table({ id: "a" }), table({ id: "b", x: 200 }), 5)).toBe(false);
  });

  it("does not join tables that only meet at a corner", () => {
    expect(canJoin(table({ id: "a" }), table({ id: "b", x: 180, y: 180 }), 5)).toBe(false);
  });

  it("never joins round tables or tables turned at an angle", () => {
    expect(canJoin(table({ id: "a" }), table({ id: "b", x: 180, shape: "round" }), 5)).toBe(false);
    expect(canJoin(table({ id: "a" }), table({ id: "b", x: 180, rotation: 45 }), 5)).toBe(false);
    expect(canJoin(table({ id: "a" }), table({ id: "b", x: 180, rotation: 90 }), 5)).toBe(true);
  });
});

describe("seatingOptions", () => {
  it("prefers the smallest single table that fits", () => {
    const options = seatingOptions(2, [row]);
    expect(options.slice(0, 3).map((option) => option.tableIds)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("respects a table's minimum seats", () => {
    // The 4-seat table wants at least 3 people, so a couple never gets it.
    expect(seatingOptions(2, [row]).some((option) => option.tableIds.includes("big"))).toBe(false);
    expect(seatingOptions(3, [row])[0]).toEqual({ zoneId: "room", tableIds: ["big"], seats: 4 });
  });

  it("pushes neighbouring tables together when no single table is big enough", () => {
    const options = seatingOptions(4, [row], new Set(["big"]));
    expect(options.map((option) => option.tableIds)).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
    expect(options[0]?.seats).toBe(4);
  });

  it("only joins tables that every one of them is needed for", () => {
    // Five people need all three 2-seat tables; four people never get three tables.
    expect(seatingOptions(5, [row], new Set(["big"])).map((option) => option.tableIds)).toEqual([
      ["a", "b", "c"],
    ]);
  });

  it("does not join tables across a busy table", () => {
    expect(seatingOptions(4, [row], new Set(["b", "big"]))).toEqual([]);
  });

  it("skips busy tables", () => {
    const options = seatingOptions(2, [row], new Set(["a"]));
    expect(options[0]?.tableIds).toEqual(["b"]);
  });

  it("never joins tables from different zones", () => {
    const inside = zone("inside", [table({ id: "x" })]);
    const outside = zone("outside", [table({ id: "y", x: 180 })]);
    expect(seatingOptions(4, [inside, outside])).toEqual([]);
  });

  it("keeps zone order when tables are otherwise equal", () => {
    const first = zone("first", [table({ id: "z" })]);
    const second = zone("second", [table({ id: "a" })]);
    expect(seatingOptions(2, [first, second]).map((option) => option.zoneId)).toEqual([
      "first",
      "second",
    ]);
  });

  it("returns nothing when the party is too big for the room", () => {
    expect(seatingOptions(20, [row])).toEqual([]);
  });

  it("stops at the most tables a venue allows to join", () => {
    expect(seatingOptions(5, [row], new Set(["big"]), { maxTablesJoined: 2, joinGap: 5 })).toEqual(
      [],
    );
  });

  it("rejects a party size that is not a whole positive number", () => {
    expect(() => seatingOptions(0, [row])).toThrow(RangeError);
    expect(() => seatingOptions(2.5, [row])).toThrow(RangeError);
  });
});

describe("canStillSeat", () => {
  it("keeps a party at a table with enough seats", () => {
    expect(canStillSeat(2, [table({ id: "a" })])).toBe(true);
    expect(canStillSeat(3, [table({ id: "a" })])).toBe(false);
  });

  it("ignores the minimum seats, which only steers new bookings", () => {
    expect(canStillSeat(1, [table({ id: "a", minSeats: 2, maxSeats: 4 })])).toBe(true);
  });

  it("keeps joined tables while they still stand side by side", () => {
    const joined = [table({ id: "a", x: 100 }), table({ id: "b", x: 180 })];
    expect(canStillSeat(4, joined)).toBe(true);
  });

  it("refuses joined tables once one is moved away or turned round", () => {
    expect(canStillSeat(4, [table({ id: "a", x: 100 }), table({ id: "b", x: 400 })])).toBe(false);
    expect(
      canStillSeat(4, [table({ id: "a", x: 100 }), table({ id: "b", x: 180, shape: "round" })]),
    ).toBe(false);
  });

  it("accepts a chain where the ends only meet through the middle table", () => {
    const chain = [
      table({ id: "a", x: 100 }),
      table({ id: "c", x: 260 }),
      table({ id: "b", x: 180 }),
    ];
    expect(canStillSeat(6, chain)).toBe(true);
  });

  it("refuses an empty list", () => {
    expect(canStillSeat(1, [])).toBe(false);
  });
});
