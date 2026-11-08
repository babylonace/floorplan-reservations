/**
 * Floor plan types and checks.
 *
 * Units are centimetres. A table's `x` and `y` are the position of its centre inside its zone,
 * measured from the zone's top-left corner. `rotation` is in degrees, clockwise.
 */

export type TableShape = "rect" | "round";

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
 * A round table is a circle (or an ellipse when width and height differ), so rotation
 * only matters for rectangles.
 */
export function boundingBox(table: PlanTable): Box {
  let halfWidth = table.width / 2;
  let halfHeight = table.height / 2;

  if (table.shape === "rect") {
    const radians = (table.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    halfWidth = (table.width * cos + table.height * sin) / 2;
    halfHeight = (table.width * sin + table.height * cos) / 2;
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
