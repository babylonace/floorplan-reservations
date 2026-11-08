import { describe, expect, it } from "vitest";
import {
  canJoin,
  canStillSeat,
  DEFAULT_SEATING_RULES,
  isOneSided,
  normalizeSides,
  seatedSidesOnPlan,
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
  table({ id: "big", x: 1000, y: 1000, maxSeats: 4, width: 120 }),
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

  it("gives the smallest table that fits", () => {
    // A couple gets a 2-seat table, not the 4-seat one.
    expect(seatingOptions(2, [row])[0]).toEqual({ zoneId: "room", tableIds: ["a"], seats: 2 });
    // A party of 3 gets the 4-seat table.
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
    expect(
      seatingOptions(5, [row], new Set(["big"]), { ...DEFAULT_SEATING_RULES, maxTablesJoined: 2 }),
    ).toEqual([]);
  });

  it("still accepts rules written before bars existed", () => {
    expect(
      seatingOptions(4, [row], new Set(["big"]), { maxTablesJoined: 3, joinGap: 5 }),
    ).toHaveLength(2);
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

describe("bars and tables against the wall", () => {
  // A bar of 8 stools drawn as four stretches of 2, end to end, stools on the bottom side.
  const stretch = (id: string, x: number, overrides: Partial<PlanTable> = {}) =>
    table({
      id,
      x,
      y: 300,
      width: 120,
      height: 50,
      minSeats: 1,
      maxSeats: 2,
      seatSides: ["bottom"],
      ...overrides,
    });
  const bar = zone("bar", [
    stretch("b1", 160),
    stretch("b2", 280),
    stretch("b3", 400),
    stretch("b4", 520),
  ]);

  it("lets a couple take one stretch and leaves the rest of the bar free", () => {
    const options = seatingOptions(2, [bar]);
    expect(options.slice(0, 4).map((option) => option.tableIds)).toEqual([
      ["b1"],
      ["b2"],
      ["b3"],
      ["b4"],
    ]);
  });

  it("takes stretches next to each other, in a line, for a group", () => {
    expect(seatingOptions(4, [bar]).map((option) => option.tableIds)).toEqual([
      ["b1", "b2"],
      ["b2", "b3"],
      ["b3", "b4"],
    ]);
    expect(seatingOptions(8, [bar])).toEqual([
      { zoneId: "bar", tableIds: ["b1", "b2", "b3", "b4"], seats: 8 },
    ]);
  });

  it("does not take stretches across a busy one", () => {
    expect(seatingOptions(4, [bar], new Set(["b2"])).map((option) => option.tableIds)).toEqual([
      ["b3", "b4"],
    ]);
  });

  it("allows longer runs of bar than of tables, up to its own limit", () => {
    const long = zone(
      "long",
      ["s1", "s2", "s3", "s4", "s5", "s6", "s7"].map((id, index) => stretch(id, 160 + index * 120)),
    );
    expect(seatingOptions(12, [long])).toHaveLength(2);
    expect(seatingOptions(13, [long])).toEqual([]);
    expect(
      seatingOptions(4, [long], new Set(), { ...DEFAULT_SEATING_RULES, maxBarStretchesJoined: 1 }),
    ).toEqual([]);
  });

  it("never joins stretches back to back or facing different ways", () => {
    // Stools on both sides of a central bar: the two sides are not one group.
    const front = stretch("front", 160);
    const back = stretch("back", 160, { y: 250, seatSides: ["top"] });
    expect(canJoin(front, back, 5)).toBe(false);
    // Side by side but facing opposite ways.
    expect(canJoin(front, stretch("other", 280, { seatSides: ["top"] }), 5)).toBe(false);
  });

  it("only joins stretches whose stools are in a line", () => {
    expect(canJoin(stretch("a", 160), stretch("b", 280, { y: 303 }), 5)).toBe(true);
    expect(canJoin(stretch("a", 160), stretch("b", 280, { y: 320 }), 5)).toBe(false);
  });

  it("follows the stretch's turn: stools on the bottom, turned 90 degrees, face left", () => {
    const turned = (id: string, y: number) => stretch(id, 300, { y, rotation: 90 });
    expect(canJoin(turned("a", 200), turned("b", 320), 5)).toBe(true);
    // A stretch that is not turned, touching its end, has its stools facing another way.
    expect(canJoin(turned("a", 200), stretch("c", 300, { y: 285 }), 5)).toBe(false);
  });

  it("never mixes a bar with tables that have seats all around", () => {
    expect(canJoin(stretch("bar", 160), table({ id: "t", x: 260, y: 300 }), 5)).toBe(false);
    expect(canJoin(table({ id: "t", x: 260, y: 300 }), stretch("bar", 160), 5)).toBe(false);
  });

  it("does not push a table against a side that has seats", () => {
    // Seats on the long top and bottom sides: end to end is fine, along the seats is not.
    const sides = (id: string, x: number, y: number) =>
      table({ id, x, y, width: 120, height: 80, maxSeats: 4, seatSides: ["top", "bottom"] });
    expect(canJoin(sides("a", 100, 100), sides("b", 220, 100), 5)).toBe(true);
    expect(canJoin(sides("a", 100, 100), sides("b", 100, 180), 5)).toBe(false);
    // A table with seats all around joins as before.
    expect(canJoin(table({ id: "a" }), table({ id: "b", y: 180 }), 5)).toBe(true);
  });

  it("keeps a party at stretches that still stand in a line", () => {
    expect(canStillSeat(4, [stretch("b1", 160), stretch("b2", 280)])).toBe(true);
    expect(canStillSeat(4, [stretch("b1", 160), stretch("b2", 280, { seatSides: ["top"] })])).toBe(
      false,
    );
  });
});

describe("seat sides on the plan", () => {
  it("turns the sides with the table and ignores round tables", () => {
    const bar = table({ id: "a", seatSides: ["bottom"] });
    expect([...(seatedSidesOnPlan(bar) ?? [])]).toEqual(["bottom"]);
    expect([...(seatedSidesOnPlan({ ...bar, rotation: 90 }) ?? [])]).toEqual(["left"]);
    expect([...(seatedSidesOnPlan({ ...bar, rotation: 270 }) ?? [])]).toEqual(["right"]);
    expect(seatedSidesOnPlan({ ...bar, rotation: 45 })).toBeNull();
    expect(seatedSidesOnPlan({ ...bar, shape: "round" })).toBeNull();
    expect(seatedSidesOnPlan(table({ id: "b" }))).toBeNull();
  });

  it("knows a one-sided table and puts sides in order", () => {
    expect(isOneSided(table({ id: "a", seatSides: ["left"] }))).toBe(true);
    expect(isOneSided(table({ id: "a", seatSides: ["left", "left"] }))).toBe(true);
    expect(isOneSided(table({ id: "a", seatSides: ["left", "top"] }))).toBe(false);
    expect(isOneSided(table({ id: "a" }))).toBe(false);
    expect(isOneSided(table({ id: "a", shape: "round", seatSides: ["left"] }))).toBe(false);
    expect(normalizeSides(["left", "top", "left"])).toEqual(["top", "left"]);
  });
});
