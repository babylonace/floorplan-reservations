import { validateZone, type PlanIssue } from "@floorplan-reservations/engine";
import type { PlanZone, Table, TableFields } from "../api/types";

/**
 * The tables of one zone as the person is editing them, next to the tables as they are stored.
 * Nothing reaches the API until the person saves; the engine checks every step on the way.
 */
export interface Draft {
  zoneId: string;
  /** The tables as the API last sent them, by id. */
  saved: ReadonlyMap<string, Table>;
  /** The tables as they are now on screen. New ones have an id starting with `new:`. */
  tables: readonly Table[];
  /** Stored tables the person removed. */
  deleted: readonly string[];
}

export type Change =
  | { kind: "delete"; id: string; label: string }
  | { kind: "update"; id: string; label: string; fields: Partial<TableFields> }
  | { kind: "create"; id: string; label: string; fields: Omit<TableFields, "zoneId"> };

const NEW_PREFIX = "new:";
let created = 0;

export function isNewId(id: string): boolean {
  return id.startsWith(NEW_PREFIX);
}

export function newTableId(): string {
  created += 1;
  return `${NEW_PREFIX}${String(created)}`;
}

export function draftFromZone(zone: PlanZone): Draft {
  return {
    zoneId: zone.id,
    saved: new Map(zone.tables.map((table) => [table.id, table])),
    tables: zone.tables,
    deleted: [],
  };
}

const FIELDS = [
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
] as const satisfies readonly (keyof TableFields)[];

/** The fields of `current` that differ from `saved`: what a PATCH has to send. */
export function changedFields(saved: Table, current: Table): Partial<TableFields> {
  const fields: Partial<TableFields> = {};
  for (const field of FIELDS) {
    const before = saved[field];
    const after = current[field];
    const same =
      field === "style" ? JSON.stringify(before) === JSON.stringify(after) : before === after;
    if (!same) Object.assign(fields, { [field]: after });
  }
  return fields;
}

function creationFields(table: Table): Omit<TableFields, "zoneId"> {
  return {
    label: table.label,
    minSeats: table.minSeats,
    maxSeats: table.maxSeats,
    shape: table.shape,
    x: table.x,
    y: table.y,
    width: table.width,
    height: table.height,
    rotation: table.rotation,
    style: table.style,
    bookable: table.bookable,
  };
}

/**
 * What saving would send, in the order it is sent: removals first, so they make room, then
 * changes to stored tables, then new tables.
 */
export function pendingChanges(draft: Draft): Change[] {
  const deletes: Change[] = draft.deleted.map((id) => ({
    kind: "delete",
    id,
    label: draft.saved.get(id)?.label ?? id,
  }));
  const updates: Change[] = [];
  const creates: Change[] = [];
  for (const table of draft.tables) {
    const saved = draft.saved.get(table.id);
    if (saved) {
      const fields = changedFields(saved, table);
      if (Object.keys(fields).length > 0) {
        updates.push({ kind: "update", id: table.id, label: table.label, fields });
      }
    } else {
      creates.push({
        kind: "create",
        id: table.id,
        label: table.label,
        fields: creationFields(table),
      });
    }
  }
  return [...deletes, ...updates, ...creates];
}

/** The engine's view of the zone as it is on screen. */
export function draftIssues(draft: Draft, zone: { width: number; height: number }): PlanIssue[] {
  return validateZone({
    id: draft.zoneId,
    name: "",
    width: zone.width,
    height: zone.height,
    tables: [...draft.tables],
  });
}

export function updateTable(draft: Draft, id: string, patch: Partial<Table>): Draft {
  return {
    ...draft,
    tables: draft.tables.map((table) => (table.id === id ? { ...table, ...patch } : table)),
  };
}

export function addTable(draft: Draft, table: Table): Draft {
  return { ...draft, tables: [...draft.tables, table] };
}

export function removeTable(draft: Draft, id: string): Draft {
  return {
    ...draft,
    tables: draft.tables.filter((table) => table.id !== id),
    deleted: draft.saved.has(id) ? [...draft.deleted, id] : draft.deleted,
  };
}

/** Puts back a stored table the person removed, as it was stored. */
export function restoreTable(draft: Draft, id: string): Draft {
  const saved = draft.saved.get(id);
  if (!saved || !draft.deleted.includes(id)) return draft;
  return {
    ...draft,
    tables: [...draft.tables, saved],
    deleted: draft.deleted.filter((deleted) => deleted !== id),
  };
}

/**
 * The draft after a save, on top of the zone as the API now has it. Changes in `keep` were not
 * saved and stay on screen, waiting for the next try; everything else shows what is stored.
 */
export function rebase(previous: Draft, zone: PlanZone, keep: ReadonlySet<string>): Draft {
  const fresh = draftFromZone(zone);
  const current = new Map(previous.tables.map((table) => [table.id, table]));
  const tables: Table[] = [];
  for (const stored of zone.tables) {
    if (keep.has(stored.id) && previous.deleted.includes(stored.id)) continue;
    const mine = current.get(stored.id);
    tables.push(keep.has(stored.id) && mine ? mine : stored);
  }
  for (const table of previous.tables) {
    if (isNewId(table.id) && keep.has(table.id)) tables.push(table);
  }
  const deleted = previous.deleted.filter((id) => keep.has(id) && fresh.saved.has(id));
  return { ...fresh, tables, deleted };
}

/**
 * The zone as the API must now have it, worked out from a save's results, for when it cannot be
 * read again. `notSaved` holds the ids of every change that was refused or not sent.
 */
export function assumeSaved(
  previous: Draft,
  zone: PlanZone,
  notSaved: ReadonlySet<string>,
  created: ReadonlyMap<string, Table>,
): PlanZone {
  const tables: Table[] = [];
  for (const table of previous.tables) {
    if (isNewId(table.id)) {
      const stored = created.get(table.id);
      if (stored) tables.push(stored);
    } else {
      tables.push(notSaved.has(table.id) ? (previous.saved.get(table.id) ?? table) : table);
    }
  }
  for (const id of previous.deleted) {
    const stored = previous.saved.get(id);
    if (stored && notSaved.has(id)) tables.push(stored);
  }
  return { ...zone, tables, issues: [] };
}
