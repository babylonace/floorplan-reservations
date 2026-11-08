import {
  boundingBox,
  normalizeSides,
  type Box,
  type PlanTable,
  type TableSide,
} from "@floorplan-reservations/engine";

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

/** Below this, in cm, two edges count as touching: rounding from turning must not decide it. */
const EPSILON = 0.01;

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

/**
 * The next free table name: one more than the highest number in use, after `prefix` if there is
 * one ("B1", "B2"… for bar sections).
 */
export function nextLabel(tables: { label: string }[], prefix = ""): string {
  const used = new Set(tables.map((table) => table.label.trim().toLowerCase()));
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}(\\d+)$`, "i");
  const highest = Math.max(
    0,
    ...tables.map((table) => Number(pattern.exec(table.label.trim())?.[1] ?? 0)),
  );
  let next = highest + 1;
  while (used.has(`${prefix}${String(next)}`.toLowerCase())) next += 1;
  return `${prefix}${String(next)}`;
}

/**
 * Where the next section of a bar goes: straight after `section`, along its length, the same
 * way round, so the stools stay in a line. The far end first, then the near end. null when
 * neither end has room inside the zone without touching another table.
 */
export function nextInLine(
  section: PlanTable,
  zone: { width: number; height: number },
  tables: PlanTable[],
): Point | null {
  const radians = (section.rotation * Math.PI) / 180;
  const along = { x: Math.cos(radians) * section.width, y: Math.sin(radians) * section.width };
  const others = tables.filter((table) => table.id !== section.id).map(boundingBox);
  for (const sign of [1, -1]) {
    const spot = {
      x: Math.round(section.x + sign * along.x),
      y: Math.round(section.y + sign * along.y),
    };
    const box = boundingBox({ ...section, ...spot });
    const inside =
      box.left >= -EPSILON &&
      box.top >= -EPSILON &&
      box.right <= zone.width + EPSILON &&
      box.bottom <= zone.height + EPSILON;
    const inner = {
      left: box.left + EPSILON,
      top: box.top + EPSILON,
      right: box.right - EPSILON,
      bottom: box.bottom - EPSILON,
    };
    if (inside && !others.some((other) => overlaps(inner, other))) return spot;
  }
  return null;
}

/**
 * `seats` shared out over sides of these lengths. Every side gets one seat first (the longest
 * sides first when there are fewer seats than sides), so a side chosen for seats is never left
 * empty; the rest go in proportion to length, the biggest leftovers first, so a long side gets
 * more chairs than a short one.
 */
export function shareSeats(seats: number, lengths: number[]): number[] {
  const counts = lengths.map(() => 0);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0 || seats <= 0) return counts;
  const longestFirst = lengths
    .map((length, index) => ({ index, length }))
    .sort((a, b) => b.length - a.length || a.index - b.index);
  let left = seats;
  for (const { index } of longestFirst) {
    if (left <= 0) break;
    counts[index] = 1;
    left -= 1;
  }
  const exact = lengths.map((length) => (left * length) / total);
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index);
  exact.forEach((value, index) => {
    counts[index] = (counts[index] ?? 0) + Math.floor(value);
  });
  let missing = seats - counts.reduce((sum, count) => sum + count, 0);
  for (const { index } of order) {
    if (missing <= 0) break;
    counts[index] = (counts[index] ?? 0) + 1;
    missing -= 1;
  }
  return counts;
}

/** The most chairs drawn around one table: a drawing aid, not a limit. */
export const MAX_CHAIRS_DRAWN = 16;
/** A chair (or bar stool) is a circle this wide, in cm, this far from the table's edge. */
export const CHAIR_RADIUS = 15;
export const CHAIR_GAP = 4;

/**
 * Where the chairs go, in the table's own frame (its centre, before it turns), and how big
 * they are drawn. Round tables get them evenly around; a table that says which sides have
 * seats gets them only there, shared out by length; any other table gets them along its two
 * long sides. Chairs shrink when they would touch each other.
 */
export function chairLayout(
  table: Pick<PlanTable, "shape" | "width" | "height" | "maxSeats" | "seatSides">,
): { radius: number; chairs: Point[] } {
  const seats = Math.max(0, Math.min(table.maxSeats, MAX_CHAIRS_DRAWN));
  const chairs: Point[] = [];
  let room = Infinity;
  const out = (radius: number) => CHAIR_GAP + radius;
  if (table.shape === "round") {
    const rx = table.width / 2 + out(CHAIR_RADIUS);
    const ry = table.height / 2 + out(CHAIR_RADIUS);
    for (let i = 0; i < seats; i++) {
      const angle = (i / seats) * 2 * Math.PI - Math.PI / 2;
      chairs.push({ x: Math.cos(angle) * rx, y: Math.sin(angle) * ry });
    }
    // The ellipse's perimeter (Ramanujan), shared out between the chairs.
    if (seats > 1) {
      const perimeter = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
      room = perimeter / seats;
    }
  } else {
    const sides: TableSide[] = table.seatSides
      ? normalizeSides(table.seatSides)
      : table.width >= table.height
        ? ["top", "bottom"]
        : ["left", "right"];
    const across = (side: TableSide) => side === "top" || side === "bottom";
    const counts = table.seatSides
      ? shareSeats(
          seats,
          sides.map((side) => (across(side) ? table.width : table.height)),
        )
      : [Math.ceil(seats / 2), Math.floor(seats / 2)];
    sides.forEach((side, index) => {
      const count = counts[index] ?? 0;
      const length = across(side) ? table.width : table.height;
      const depth = (across(side) ? table.height : table.width) / 2 + out(CHAIR_RADIUS);
      if (count > 1) room = Math.min(room, length / count);
      for (let i = 0; i < count; i++) {
        const along = -length / 2 + ((i + 0.5) * length) / count;
        if (side === "top") chairs.push({ x: along, y: -depth });
        else if (side === "bottom") chairs.push({ x: along, y: depth });
        else if (side === "left") chairs.push({ x: -depth, y: along });
        else chairs.push({ x: depth, y: along });
      }
    });
  }
  const radius = Math.max(6, Math.min(CHAIR_RADIUS, room / 2 - 2));
  return { radius, chairs };
}
