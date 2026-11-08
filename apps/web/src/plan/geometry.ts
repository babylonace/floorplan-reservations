import { boundingBox, type Box, type PlanTable } from "@floorplan-reservations/engine";

/** Plan maths for the editor. Everything is in centimetres and degrees, like the API. */

export interface Point {
  x: number;
  y: number;
}

/** Tables snap to this grid while dragged. */
export const SNAP_CM = 5;
/** Arrow keys move a table this far; with Shift, ten times as far. */
export const NUDGE_CM = 5;
/** Turning snaps to this angle; R and Shift+R turn by it. */
export const TURN_STEP = 15;
export const MIN_SIZE_CM = 30;
/** The API's limit for any length. */
export const MAX_CM = 100_000;

export function snap(value: number, step = SNAP_CM): number {
  return Math.round(value / step) * step;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Any angle as a whole number of degrees from 0 to 359, as the API stores it. */
export function normalizeRotation(degrees: number): number {
  return ((Math.round(degrees) % 360) + 360) % 360;
}

/** A point on the plan, seen from the table's own centre and turn. */
export function toTableFrame(point: Point, table: PlanTable): Point {
  const radians = (-table.rotation * Math.PI) / 180;
  const dx = point.x - table.x;
  const dy = point.y - table.y;
  return {
    x: dx * Math.cos(radians) - dy * Math.sin(radians),
    y: dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

/**
 * The size a table takes when its corner handle is dragged to `point`. The table grows from its
 * centre, so it stays where it is. Round tables that are circles stay circles.
 */
export function sizeFromHandle(
  table: PlanTable,
  point: Point,
  step = SNAP_CM,
): { width: number; height: number } {
  const local = toTableFrame(point, table);
  const width = clamp(snap(Math.abs(local.x) * 2, step), MIN_SIZE_CM, MAX_CM);
  const height = clamp(snap(Math.abs(local.y) * 2, step), MIN_SIZE_CM, MAX_CM);
  if (table.shape === "round" && table.width === table.height) {
    const size = Math.max(width, height);
    return { width: size, height: size };
  }
  return { width, height };
}

/** The turn a table takes when its turning handle (above its top edge) is dragged to `point`. */
export function rotationFromHandle(table: PlanTable, point: Point, step = TURN_STEP): number {
  const degrees = (Math.atan2(point.y - table.y, point.x - table.x) * 180) / Math.PI + 90;
  return normalizeRotation(Math.round(degrees / step) * step);
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** The area where two boxes cross, or null when they do not. */
export function intersection(a: Box, b: Box): Box | null {
  const box = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return box.left < box.right && box.top < box.bottom ? box : null;
}

/**
 * The first free place, row by row from the top left, where a `width` × `height` table fits
 * inside the zone without touching another table. Falls back to the middle of the zone.
 */
export function findFreeSpot(
  zone: { width: number; height: number },
  tables: PlanTable[],
  width: number,
  height: number,
  gap = 20,
): Point {
  const boxes = tables.map(boundingBox);
  const step = 10;
  for (let y = height / 2 + gap; y + height / 2 + gap <= zone.height; y += step) {
    for (let x = width / 2 + gap; x + width / 2 + gap <= zone.width; x += step) {
      const box = {
        left: x - width / 2 - gap,
        top: y - height / 2 - gap,
        right: x + width / 2 + gap,
        bottom: y + height / 2 + gap,
      };
      if (!boxes.some((other) => overlaps(box, other))) return { x: snap(x), y: snap(y) };
    }
  }
  return { x: snap(zone.width / 2), y: snap(zone.height / 2) };
}

/** The next free table number: one more than the highest number in use. */
export function nextLabel(tables: { label: string }[]): string {
  const used = new Set(tables.map((table) => table.label.trim().toLowerCase()));
  const highest = Math.max(
    0,
    ...tables.map((table) => (/^\d+$/.test(table.label.trim()) ? Number(table.label) : 0)),
  );
  let next = highest + 1;
  while (used.has(String(next))) next += 1;
  return String(next);
}
