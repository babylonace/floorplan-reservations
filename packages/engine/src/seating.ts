/**
 * Picks where to seat a party: one table, or several tables pushed together.
 *
 * The engine only decides what would be best. It does not know about other requests arriving
 * at the same moment; the database has the last word on whether a table is still free.
 */

import {
  boundingBox,
  isOneSided,
  seatedSidesOnPlan,
  type Box,
  type PlanTable,
  type PlanZone,
  type TableSide,
} from "./floor-plan.js";

export interface SeatingOption {
  zoneId: string;
  /** Sorted by id, so the same tables always come out in the same order. */
  tableIds: string[];
  /** Seats the chosen tables have together. */
  seats: number;
}

export interface SeatingRules {
  /** Most tables that may be pushed together for one party. */
  maxTablesJoined: number;
  /**
   * Most stretches of bar (tables with seats on one side) that may be taken together in a row.
   * A bar is drawn in short stretches so that a couple does not block the whole bar; a group
   * takes several stretches next to each other. Optional, so rules written before bars existed
   * still work: it then takes the default.
   */
  maxBarStretchesJoined?: number;
  /** Two tables can be pushed together when the gap between their edges is at most this many cm. */
  joinGap: number;
}

export const DEFAULT_SEATING_RULES: SeatingRules = {
  maxTablesJoined: 3,
  maxBarStretchesJoined: 6,
  joinGap: 5,
};

// Same tolerance as the plan checks: rounding noise must not decide whether tables meet.
const EPSILON = 1e-6;

function edge(box: Box, side: TableSide): number {
  if (side === "top") return box.top;
  if (side === "bottom") return box.bottom;
  return side === "left" ? box.left : box.right;
}

/**
 * True when two rectangular tables stand side by side: the gap between them is small and they
 * face each other along a shared edge. Round tables and tables turned at an angle (not a
 * multiple of 90 degrees) are never joined.
 *
 * Tables are never pushed together along a side that has seats: those seats would be lost, and
 * the party would get fewer seats than the tables say. So joined tables keep all their seats.
 * Tables with seats all around (the default) join along any side, as before.
 *
 * Stretches of bar (seats on one side only) only join other stretches, end to end, in a line:
 * their seats face the same way and their seated edges line up, so the party sits in a row.
 */
export function canJoin(a: PlanTable, b: PlanTable, joinGap: number): boolean {
  const straight = (table: PlanTable) => table.shape === "rect" && table.rotation % 90 === 0;
  if (!straight(a) || !straight(b)) return false;
  const first: Box = boundingBox(a);
  const second: Box = boundingBox(b);
  const gapX = Math.max(first.left - second.right, second.left - first.right);
  const gapY = Math.max(first.top - second.bottom, second.top - first.bottom);
  const sideBySide = gapX <= joinGap + EPSILON && gapX >= -EPSILON && gapY < -EPSILON;
  const endToEnd = gapY <= joinGap + EPSILON && gapY >= -EPSILON && gapX < -EPSILON;
  if (!sideBySide && !endToEnd) return false;

  // The side of each table that the other one touches.
  let touching: [TableSide, TableSide];
  if (sideBySide) touching = a.x < b.x ? ["right", "left"] : ["left", "right"];
  else touching = a.y < b.y ? ["bottom", "top"] : ["top", "bottom"];
  const seatsA = seatedSidesOnPlan(a);
  const seatsB = seatedSidesOnPlan(b);
  if (seatsA?.has(touching[0]) || seatsB?.has(touching[1])) return false;

  const bar = isOneSided(a);
  if (bar !== isOneSided(b)) return false;
  if (!bar) return true;
  const [faceA] = seatsA ?? [];
  const [faceB] = seatsB ?? [];
  return (
    faceA !== undefined &&
    faceA === faceB &&
    Math.abs(edge(first, faceA) - edge(second, faceA)) <= joinGap + EPSILON
  );
}

function byId(a: PlanTable, b: PlanTable): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Groups of 2 or more tables where every table is joined to the group through neighbours: up to
 * `maxTablesJoined` tables, or `maxBarStretchesJoined` stretches of bar.
 */
function joinedGroups(tables: PlanTable[], rules: SeatingRules): PlanTable[][] {
  const neighbours = new Map<string, PlanTable[]>();
  for (const table of tables) {
    neighbours.set(
      table.id,
      tables.filter((other) => other.id !== table.id && canJoin(table, other, rules.joinGap)),
    );
  }

  const seen = new Set<string>();
  const groups: PlanTable[][] = [];
  let frontier: PlanTable[][] = tables.map((table) => [table]);

  // Stretches of bar only join each other, so a group is all bar or no bar at all.
  const maxBar = rules.maxBarStretchesJoined ?? DEFAULT_SEATING_RULES.maxBarStretchesJoined ?? 6;
  const largest = Math.max(rules.maxTablesJoined, maxBar);
  for (let size = 2; size <= largest; size++) {
    const next: PlanTable[][] = [];
    for (const group of frontier) {
      const bar = group[0] !== undefined && isOneSided(group[0]);
      if (size > (bar ? maxBar : rules.maxTablesJoined)) continue;
      for (const member of group) {
        for (const neighbour of neighbours.get(member.id) ?? []) {
          if (group.includes(neighbour)) continue;
          const grown = [...group, neighbour].sort(byId);
          const key = grown.map((table) => table.id).join(",");
          if (seen.has(key)) continue;
          seen.add(key);
          next.push(grown);
        }
      }
    }
    groups.push(...next);
    frontier = next;
  }

  return groups;
}

function seatsOf(tables: PlanTable[]): number {
  return tables.reduce((total, table) => total + table.maxSeats, 0);
}

/**
 * Every way to seat `partySize` people at the free tables, best first.
 *
 * - A single table is used when the party fits between its minimum and maximum seats.
 *   Smaller tables come first, so big tables stay free for big groups.
 * - Otherwise neighbouring rectangular tables in the same zone are pushed together, or
 *   stretches of bar next to each other in a line are taken together (see `canJoin`). Fewer
 *   tables come first, then fewer empty seats. A group is only offered when every table in it
 *   is needed: taking any one away would leave too few seats.
 *
 * `busyTableIds` are tables already taken for the time being asked about. Tables staff keep
 * out of online booking should not be passed in at all.
 */
export function seatingOptions(
  partySize: number,
  zones: readonly PlanZone[],
  busyTableIds: ReadonlySet<string> = new Set(),
  rules: SeatingRules = DEFAULT_SEATING_RULES,
): SeatingOption[] {
  if (!Number.isInteger(partySize) || partySize < 1) {
    throw new RangeError(`Party size must be a whole number of at least 1, got ${partySize}`);
  }

  const singles: (SeatingOption & { order: number })[] = [];
  const joined: (SeatingOption & { order: number; tableCount: number })[] = [];

  zones.forEach((zone, order) => {
    const free = zone.tables.filter((table) => !busyTableIds.has(table.id)).sort(byId);

    for (const table of free) {
      if (table.minSeats <= partySize && partySize <= table.maxSeats) {
        singles.push({ zoneId: zone.id, tableIds: [table.id], seats: table.maxSeats, order });
      }
    }

    for (const group of joinedGroups(free, rules)) {
      const seats = seatsOf(group);
      const everyTableNeeded = group.every((table) => seats - table.maxSeats < partySize);
      if (seats >= partySize && everyTableNeeded) {
        joined.push({
          zoneId: zone.id,
          tableIds: group.map((table) => table.id),
          seats,
          order,
          tableCount: group.length,
        });
      }
    }
  });

  singles.sort((a, b) => a.seats - b.seats || a.order - b.order);
  joined.sort((a, b) => a.tableCount - b.tableCount || a.seats - b.seats || a.order - b.order);

  return [...singles, ...joined].map(({ zoneId, tableIds, seats }) => ({
    zoneId,
    tableIds,
    seats,
  }));
}

/**
 * True when tables a party already holds can still seat it: together they have enough seats
 * and, when there are several, they still stand side by side as one group.
 *
 * Used before staff change the plan, so an edit never leaves a booked party without room.
 * It is looser than `seatingOptions`: minimum seats and the cap on joined tables only steer new
 * bookings, they do not make an existing one impossible.
 */
export function canStillSeat(
  partySize: number,
  tables: readonly PlanTable[],
  rules: SeatingRules = DEFAULT_SEATING_RULES,
): boolean {
  const [first] = tables;
  if (!first || seatsOf([...tables]) < partySize) return false;

  // Every table must be reachable from the first one through neighbours it can be pushed against.
  const reached = new Set([first.id]);
  const queue = [first];
  for (let current = queue.pop(); current; current = queue.pop()) {
    for (const other of tables) {
      if (!reached.has(other.id) && canJoin(current, other, rules.joinGap)) {
        reached.add(other.id);
        queue.push(other);
      }
    }
  }
  return reached.size === tables.length;
}
