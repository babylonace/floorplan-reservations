/**
 * Floor plan types and checks.
 *
 * Units are centimetres. A table's `x` and `y` are the position of its centre inside its zone,
 * measured from the zone's top-left corner. `rotation` is in degrees, clockwise.
 */

export type TableShape = "rect" | "round";

/** A side of a table, seen from the table itself before it is turned. */
export type TableSide = "top" | "right" | "bottom" | "left";

/** The four sides, clockwise from the top. */
export const TABLE_SIDES: readonly TableSide[] = ["top", "right", "bottom", "left"];

export interface PlanTable {
  id: string;
  label: string;
  minSeats: number;
  maxSeats: number;
  shape: TableShape;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /**
   * The sides of a rectangular table that have seats, before it is turned. Missing or null
   * means seats all around, as tables always had. One side only is a stretch of bar or a table
   * against the wall. Round tables ignore it.
   */
  seatSides?: readonly TableSide[] | null;
}

export interface PlanZone {
  id: string;
  name: string;
  width: number;
  height: number;
  tables: PlanTable[];
}

export type PlanIssue =
  | { code: "seats_invalid"; tableId: string }
  | { code: "outside_zone"; tableId: string }
  | { code: "overlap"; tableId: string; otherTableId: string };

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The axis-aligned box that contains a table once it is rotated.
 * A round table is an ellipse (a circle when width and height match).
 */
export function boundingBox(table: PlanTable): Box {
  const radians = (table.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  let halfWidth: number;
  let halfHeight: number;

  if (table.shape === "rect") {
    halfWidth = (table.width * cos + table.height * sin) / 2;
    halfHeight = (table.width * sin + table.height * cos) / 2;
  } else {
    const a = table.width / 2;
    const b = table.height / 2;
    halfWidth = Math.hypot(a * cos, b * sin);
    halfHeight = Math.hypot(a * sin, b * cos);
  }

  return {
    left: table.x - halfWidth,
    top: table.y - halfHeight,
    right: table.x + halfWidth,
    bottom: table.y + halfHeight,
  };
}

// Rounding noise from cos/sin must not turn "touching" into "overlapping".
const EPSILON = 1e-6;

function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.left < b.right - EPSILON &&
    b.left < a.right - EPSILON &&
    a.top < b.bottom - EPSILON &&
    b.top < a.bottom - EPSILON
  );
}

/**
 * Finds the problems in a zone that would make the booking engine give wrong answers:
 * impossible seat counts, tables outside the room and tables on top of each other.
 *
 * The overlap test uses bounding boxes, so two rotated tables can be reported as overlapping
 * when only their boxes touch. That is the safe side for a booking engine.
 */
export function validateZone(zone: PlanZone): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const boxes = zone.tables.map((table) => ({ table, box: boundingBox(table) }));

  for (const { table, box } of boxes) {
    if (
      !Number.isInteger(table.minSeats) ||
      !Number.isInteger(table.maxSeats) ||
      table.minSeats < 1 ||
      table.maxSeats < table.minSeats
    ) {
      issues.push({ code: "seats_invalid", tableId: table.id });
    }

    if (
      box.left < -EPSILON ||
      box.top < -EPSILON ||
      box.right > zone.width + EPSILON ||
      box.bottom > zone.height + EPSILON
    ) {
      issues.push({ code: "outside_zone", tableId: table.id });
    }
  }

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const first = boxes[i];
      const second = boxes[j];
      if (first && second && boxesOverlap(first.box, second.box)) {
        issues.push({ code: "overlap", tableId: first.table.id, otherTableId: second.table.id });
      }
    }
  }

  return issues;
}

/** `sides` once each, in the order of `TABLE_SIDES`. */
export function normalizeSides(sides: readonly TableSide[]): TableSide[] {
  return TABLE_SIDES.filter((side) => sides.includes(side));
}

/**
 * The sides of a table that have seats, as directions on the plan once the table is turned.
 * null when the seats go all around (or the table is round), and for tables turned at an angle
 * that is not a multiple of 90 degrees, whose sides face no plan direction.
 */
export function seatedSidesOnPlan(table: PlanTable): Set<TableSide> | null {
  if (table.shape !== "rect" || !table.seatSides || table.rotation % 90 !== 0) return null;
  const turns = (((table.rotation / 90) % 4) + 4) % 4;
  return new Set(
    table.seatSides.map((side) => TABLE_SIDES[(TABLE_SIDES.indexOf(side) + turns) % 4] ?? side),
  );
}

/** True for a rectangular table with seats on one side only: a stretch of bar, or a table by the wall. */
export function isOneSided(table: PlanTable): boolean {
  return table.shape === "rect" && new Set(table.seatSides ?? TABLE_SIDES).size === 1;
}
