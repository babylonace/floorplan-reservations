import type { PlanIssue, PlanTable, TableShape } from "@floorplan-reservations/engine";

/** Pieces of the HTTP contract that several routes share. */

export const SLUG_PATTERN = "^[a-z0-9]+(-[a-z0-9]+)*$";

// Any character but NUL, which PostgreSQL cannot store in text.
export const NO_NUL = "^[^\\u0000]*$";

export const slugParam = { type: "string", pattern: SLUG_PATTERN, maxLength: 80 } as const;

export const errorResponse = {
  type: "object",
  required: ["error"],
  properties: { error: { type: "string" } },
} as const;

export const issueSchema = {
  type: "object",
  required: ["code", "tableId"],
  properties: {
    code: { type: "string", enum: ["seats_invalid", "outside_zone", "overlap"] },
    tableId: { type: "string" },
    otherTableId: { type: "string" },
  },
} as const;

export const tableSchema = {
  type: "object",
  required: [
    "id",
    "zoneId",
    "label",
    "minSeats",
    "maxSeats",
    "shape",
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "style",
    "bookable",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    zoneId: { type: "string", format: "uuid" },
    label: { type: "string" },
    minSeats: { type: "integer" },
    maxSeats: { type: "integer" },
    shape: { type: "string", enum: ["rect", "round"] },
    x: { type: "integer", description: "Centre of the table, in cm from the zone's left edge." },
    y: { type: "integer", description: "Centre of the table, in cm from the zone's top edge." },
    width: { type: "integer" },
    height: { type: "integer" },
    rotation: { type: "integer", description: "Degrees, clockwise." },
    style: { type: "object", additionalProperties: true },
    bookable: { type: "boolean" },
  },
} as const;

export const zoneSchema = {
  type: "object",
  required: ["id", "name", "sortOrder", "width", "height"],
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    sortOrder: { type: "integer" },
    width: { type: "integer" },
    height: { type: "integer" },
  },
} as const;

/** The columns every query selects when it hands a table to `toApiTable`. */
export const TABLE_COLUMNS =
  "t.id, t.zone_id, t.label, t.min_seats, t.max_seats, t.shape, t.x, t.y, t.width, t.height, " +
  "t.rotation, t.style, t.bookable";

export interface TableRow {
  id: string;
  zone_id: string;
  label: string;
  min_seats: number;
  max_seats: number;
  shape: TableShape;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  style: Record<string, unknown>;
  bookable: boolean;
}

export interface ApiTable extends PlanTable {
  zoneId: string;
  style: Record<string, unknown>;
  bookable: boolean;
}

export function toApiTable(row: TableRow): ApiTable {
  return {
    id: row.id,
    zoneId: row.zone_id,
    label: row.label,
    minSeats: row.min_seats,
    maxSeats: row.max_seats,
    shape: row.shape,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    style: row.style,
    bookable: row.bookable,
  };
}

/** Same key for the same problem, whichever of two overlapping tables is named first. */
export function issueKey(issue: PlanIssue): string {
  if (issue.code !== "overlap") return `${issue.code}:${issue.tableId}`;
  const pair = [issue.tableId, issue.otherTableId].sort();
  return `overlap:${pair.join(",")}`;
}
