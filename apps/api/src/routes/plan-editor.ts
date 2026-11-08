import {
  canStillSeat,
  validateZone,
  type PlanIssue,
  type PlanTable,
  type PlanZone,
} from "@floorplan-reservations/engine";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import type { PoolClient } from "pg";
import type { Pool } from "../db.js";
import { errorCode, inTransaction } from "../transaction.js";
import {
  errorResponse,
  issueKey,
  issueSchema,
  NO_NUL,
  slugParam,
  TABLE_COLUMNS,
  tableSchema,
  toApiTable,
  zoneSchema,
  type ApiTable,
  type TableRow,
} from "./shared.js";

/**
 * Staff edit the floor plan here: zones, and the tables inside them.
 *
 * Every change runs in one transaction that first locks the zones it touches, then the tables,
 * always in that order. Two edits of the same zone therefore take turns, and the plan is
 * checked with the engine against what is really stored, not against a copy read earlier.
 *
 * Bookings are protected in two ways:
 * - A change that would leave an upcoming party without room (fewer seats, joined tables moved
 *   apart, a table taken away) is refused with 409.
 * - A table that was ever booked is retired instead of deleted, so past bookings keep it.
 */

const MAX_CM = 100_000;
// Leaves room for colours, a font and the like, without letting the plan grow without limit.
const MAX_STYLE_CHARS = 2000;

const uuid = { type: "string", format: "uuid" } as const;

const zoneFields = {
  name: { type: "string", minLength: 1, maxLength: 60, pattern: NO_NUL },
  width: { type: "integer", minimum: 1, maximum: MAX_CM, description: "In cm." },
  height: { type: "integer", minimum: 1, maximum: MAX_CM, description: "In cm." },
  sortOrder: {
    type: "integer",
    minimum: -10_000,
    maximum: 10_000,
    description: "Zones are listed from the lowest number up.",
  },
} as const;

const tableFields = {
  label: { type: "string", minLength: 1, maxLength: 20, pattern: NO_NUL },
  minSeats: { type: "integer", minimum: 1, maximum: 100 },
  maxSeats: { type: "integer", minimum: 1, maximum: 100 },
  shape: { type: "string", enum: ["rect", "round"] },
  x: { type: "integer", minimum: -MAX_CM, maximum: MAX_CM, description: "Centre, in cm." },
  y: { type: "integer", minimum: -MAX_CM, maximum: MAX_CM, description: "Centre, in cm." },
  width: { type: "integer", minimum: 1, maximum: MAX_CM, description: "In cm." },
  height: { type: "integer", minimum: 1, maximum: MAX_CM, description: "In cm." },
  rotation: { type: "integer", minimum: 0, maximum: 359, description: "Degrees, clockwise." },
  style: {
    type: "object",
    maxProperties: 30,
    description: "Looks for the plan editor, such as a colour. The booking engine ignores it.",
  },
  bookable: {
    type: "boolean",
    description: "false keeps the table on the plan but out of online booking.",
  },
} as const;

const issuesResponse = {
  type: "object",
  required: ["error", "issues"],
  properties: {
    error: { type: "string" },
    issues: {
      type: "array",
      description: "New problems the change would bring. A table being created is called `new`.",
      items: issueSchema,
    },
  },
} as const;

const venueParams = {
  type: "object",
  required: ["slug"],
  properties: { slug: slugParam },
} as const;

const zoneParams = {
  type: "object",
  required: ["slug", "zoneId"],
  properties: { slug: slugParam, zoneId: uuid },
} as const;

const tableParams = {
  type: "object",
  required: ["slug", "tableId"],
  properties: { slug: slugParam, tableId: uuid },
} as const;

interface ZoneBody {
  name?: string;
  width?: number;
  height?: number;
  sortOrder?: number;
}

interface TableBody {
  zoneId?: string;
  label?: string;
  minSeats?: number;
  maxSeats?: number;
  shape?: "rect" | "round";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  style?: Record<string, unknown>;
  bookable?: boolean;
}

interface ZoneRow {
  id: string;
  name: string;
  sort_order: number;
  width: number;
  height: number;
}

/** What a transaction decided; sent once it has committed. */
interface Outcome {
  status: number;
  body?: unknown;
}

const NEW_TABLE_ID = "new";

function toApiZone(row: ZoneRow) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    width: row.width,
    height: row.height,
  };
}

function notFound(what: string): Outcome {
  return { status: 404, body: { error: `${what} not found` } };
}

function badRequest(error: string): Outcome {
  return { status: 400, body: { error } };
}

/** Text the database would refuse or keep blank, and styles too big to store. */
function checkText(body: ZoneBody & TableBody): Outcome | null {
  if (body.name !== undefined && !body.name.trim()) return badRequest("name must not be blank");
  if (body.label !== undefined && !body.label.trim()) return badRequest("label must not be blank");
  if (body.style !== undefined) {
    const json = JSON.stringify(body.style);
    if (json.length > MAX_STYLE_CHARS) {
      return badRequest(`style must be at most ${MAX_STYLE_CHARS} characters as JSON`);
    }
    // PostgreSQL cannot store the NUL character, not even inside JSON.
    if (json.includes("\\u0000")) return badRequest("style must not contain the NUL character");
  }
  return null;
}

async function findVenueId(client: PoolClient, slug: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>("select id from venues where slug = $1", [
    slug,
  ]);
  return rows[0]?.id ?? null;
}

/** Locks the venue's zones with these ids, in id order, and returns the ones in use. */
async function lockZones(
  client: PoolClient,
  venueId: string,
  zoneIds: string[],
): Promise<Map<string, ZoneRow>> {
  const { rows } = await client.query<ZoneRow>(
    `select id, name, sort_order, width, height
       from zones
      where venue_id = $1 and id = any($2::uuid[]) and retired_at is null
      order by id
        for update`,
    [venueId, zoneIds],
  );
  return new Map(rows.map((row) => [row.id, row]));
}

/** The tables in use in a zone, locked in id order when `lock` is set. */
async function zoneTables(client: PoolClient, zoneId: string, lock = false): Promise<ApiTable[]> {
  const { rows } = await client.query<TableRow>(
    `select ${TABLE_COLUMNS}
       from dining_tables t
      where t.zone_id = $1 and t.retired_at is null
      order by t.id
      ${lock ? "for update" : ""}`,
    [zoneId],
  );
  return rows.map(toApiTable);
}

function planZone(zone: ZoneRow, tables: PlanTable[]): PlanZone {
  return { id: zone.id, name: zone.name, width: zone.width, height: zone.height, tables };
}

/** Problems in `after` that `before` did not have. Old problems never block an edit. */
function newIssues(before: PlanZone, after: PlanZone): PlanIssue[] {
  const known = new Set(validateZone(before).map(issueKey));
  return validateZone(after).filter((issue) => !known.has(issueKey(issue)));
}

function planRefused(issues: PlanIssue[]): Outcome {
  return {
    status: 422,
    body: { error: "The change would make the floor plan invalid", issues },
  };
}

/** Upcoming reservations, still holding their tables, that use any of these tables. */
async function upcomingReservationCount(client: PoolClient, tableIds: string[]): Promise<number> {
  const { rows } = await client.query<{ count: number }>(
    `select count(distinct reservation_id)::int as count
       from reservation_tables
      where table_id = any($1::uuid[]) and holds_tables and upper(during) > now()`,
    [tableIds],
  );
  return rows[0]?.count ?? 0;
}

/**
 * How many upcoming reservations at `edited` would no longer have room once it changes: too
 * few seats, joined tables no longer side by side, or tables split across zones.
 */
async function reservationsLeftWithoutRoom(client: PoolClient, edited: ApiTable): Promise<number> {
  const { rows } = await client.query<{ party_size: number; tables: TableRow[] }>(
    `select r.party_size,
            (select json_agg(json_build_object(
                      'id', t.id, 'zone_id', t.zone_id, 'label', t.label,
                      'min_seats', t.min_seats, 'max_seats', t.max_seats, 'shape', t.shape,
                      'x', t.x, 'y', t.y, 'width', t.width, 'height', t.height,
                      'rotation', t.rotation, 'style', t.style, 'bookable', t.bookable))
               from reservation_tables all_rt
               join dining_tables t on t.id = all_rt.table_id
              where all_rt.reservation_id = r.id) as tables
       from reservation_tables rt
       join reservations r on r.id = rt.reservation_id
      where rt.table_id = $1 and rt.holds_tables and upper(rt.during) > now()`,
    [edited.id],
  );

  return rows.filter(({ party_size, tables }) => {
    const after = tables.map((row) => (row.id === edited.id ? edited : toApiTable(row)));
    const oneZone = after.every((table) => table.zoneId === edited.zoneId);
    return !oneZone || !canStillSeat(party_size, after);
  }).length;
}

/** Tables any reservation, past or upcoming, has used. Those are retired, not deleted. */
const HAS_HISTORY = "exists (select 1 from reservation_tables rt where rt.table_id = t.id)";

function send(reply: FastifyReply, outcome: Outcome) {
  return reply.code(outcome.status).send(outcome.body);
}

/** Turns a duplicate name or label into a 409 instead of a server error. */
async function run(
  reply: FastifyReply,
  duplicateMessage: string,
  work: () => Promise<Outcome>,
): Promise<FastifyReply> {
  let outcome: Outcome;
  try {
    outcome = await work();
  } catch (error) {
    if (errorCode(error) !== "23505") throw error;
    outcome = { status: 409, body: { error: duplicateMessage } };
  }
  return send(reply, outcome);
}

export const planEditorRoutes: FastifyPluginAsync<{ pool: Pool }> = (app, { pool }) => {
  const tags = ["floor plan editor"];

  app.post<{
    Params: { slug: string };
    Body: Required<Pick<ZoneBody, "name" | "width" | "height">> & ZoneBody;
  }>(
    "/venues/:slug/zones",
    {
      schema: {
        summary: "Add a zone (a room, a terrace) to the floor plan.",
        tags,
        params: venueParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "width", "height"],
          properties: zoneFields,
        },
        response: { 201: zoneSchema, 400: errorResponse, 404: errorResponse, 409: errorResponse },
      },
    },
    (request, reply) => {
      const body = request.body;
      const invalid = checkText(body);
      if (invalid) return send(reply, invalid);

      return run(reply, "A zone with that name already exists", () =>
        inTransaction(pool, async (client): Promise<Outcome> => {
          const venueId = await findVenueId(client, request.params.slug);
          if (!venueId) return notFound("Venue");

          const { rows } = await client.query<ZoneRow>(
            `insert into zones (venue_id, name, sort_order, width, height)
             values ($1, $2, $3, $4, $5)
             returning id, name, sort_order, width, height`,
            [venueId, body.name.trim(), body.sortOrder ?? 0, body.width, body.height],
          );
          const zone = rows[0];
          if (!zone) throw new Error("Zone insert returned no row");
          return { status: 201, body: toApiZone(zone) };
        }),
      );
    },
  );

  app.patch<{ Params: { slug: string; zoneId: string }; Body: ZoneBody }>(
    "/venues/:slug/zones/:zoneId",
    {
      schema: {
        summary: "Rename, resize or reorder a zone.",
        description: "A smaller zone is refused when tables would end up outside it.",
        tags,
        params: zoneParams,
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: zoneFields,
        },
        response: {
          200: zoneSchema,
          400: errorResponse,
          404: errorResponse,
          409: errorResponse,
          422: issuesResponse,
        },
      },
    },
    (request, reply) => {
      const body = request.body;
      const invalid = checkText(body);
      if (invalid) return send(reply, invalid);

      return run(reply, "A zone with that name already exists", () =>
        inTransaction(pool, async (client): Promise<Outcome> => {
          const venueId = await findVenueId(client, request.params.slug);
          if (!venueId) return notFound("Venue");
          const zone = (await lockZones(client, venueId, [request.params.zoneId])).get(
            request.params.zoneId,
          );
          if (!zone) return notFound("Zone");

          const changed: ZoneRow = {
            ...zone,
            name: body.name?.trim() ?? zone.name,
            sort_order: body.sortOrder ?? zone.sort_order,
            width: body.width ?? zone.width,
            height: body.height ?? zone.height,
          };
          const tables = await zoneTables(client, zone.id);
          const issues = newIssues(planZone(zone, tables), planZone(changed, tables));
          if (issues.length > 0) return planRefused(issues);

          const { rows } = await client.query<ZoneRow>(
            `update zones set name = $2, sort_order = $3, width = $4, height = $5
              where id = $1
              returning id, name, sort_order, width, height`,
            [zone.id, changed.name, changed.sort_order, changed.width, changed.height],
          );
          const updated = rows[0];
          if (!updated) throw new Error("Zone update returned no row");
          return { status: 200, body: toApiZone(updated) };
        }),
      );
    },
  );

  app.delete<{ Params: { slug: string; zoneId: string } }>(
    "/venues/:slug/zones/:zoneId",
    {
      schema: {
        summary: "Remove a zone and its tables.",
        description:
          "Refused while any of its tables has an upcoming reservation. Tables that were booked " +
          "in the past are retired, so old reservations keep them.",
        tags,
        params: zoneParams,
        response: { 204: { type: "null" }, 404: errorResponse, 409: errorResponse },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await inTransaction(pool, async (client): Promise<Outcome> => {
          const venueId = await findVenueId(client, request.params.slug);
          if (!venueId) return notFound("Venue");
          const zone = (await lockZones(client, venueId, [request.params.zoneId])).get(
            request.params.zoneId,
          );
          if (!zone) return notFound("Zone");

          const tables = await zoneTables(client, zone.id, true);
          const upcoming = await upcomingReservationCount(
            client,
            tables.map((table) => table.id),
          );
          if (upcoming > 0) {
            return {
              status: 409,
              body: {
                error:
                  `${upcoming} upcoming reservation(s) use tables in this zone. Move or cancel ` +
                  "them first, or mark the tables as not bookable.",
              },
            };
          }

          await client.query(
            `update dining_tables t set retired_at = now(), bookable = false
              where t.zone_id = $1 and t.retired_at is null and ${HAS_HISTORY}`,
            [zone.id],
          );
          await client.query(
            `delete from dining_tables t where t.zone_id = $1 and not ${HAS_HISTORY}`,
            [zone.id],
          );
          const kept = await client.query(
            "select 1 from dining_tables where zone_id = $1 limit 1",
            [zone.id],
          );
          if (kept.rowCount) {
            await client.query("update zones set retired_at = now() where id = $1", [zone.id]);
          } else {
            await client.query("delete from zones where id = $1", [zone.id]);
          }
          return { status: 204 };
        }),
      ),
  );

  app.post<{
    Params: { slug: string; zoneId: string };
    Body: Required<
      Pick<TableBody, "label" | "minSeats" | "maxSeats" | "x" | "y" | "width" | "height">
    > &
      TableBody;
  }>(
    "/venues/:slug/zones/:zoneId/tables",
    {
      schema: {
        summary: "Add a table to a zone.",
        description:
          "Refused with 422 when the table would stick out of the zone, overlap another table " +
          "or have impossible seat counts.",
        tags,
        params: zoneParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["label", "minSeats", "maxSeats", "x", "y", "width", "height"],
          properties: tableFields,
        },
        response: {
          201: tableSchema,
          400: errorResponse,
          404: errorResponse,
          409: errorResponse,
          422: issuesResponse,
        },
      },
    },
    (request, reply) => {
      const body = request.body;
      const invalid = checkText(body);
      if (invalid) return send(reply, invalid);

      return run(reply, "A table with that label already exists in this zone", () =>
        inTransaction(pool, async (client): Promise<Outcome> => {
          const venueId = await findVenueId(client, request.params.slug);
          if (!venueId) return notFound("Venue");
          const zone = (await lockZones(client, venueId, [request.params.zoneId])).get(
            request.params.zoneId,
          );
          if (!zone) return notFound("Zone");

          const table: PlanTable = {
            id: NEW_TABLE_ID,
            label: body.label.trim(),
            minSeats: body.minSeats,
            maxSeats: body.maxSeats,
            shape: body.shape ?? "rect",
            x: body.x,
            y: body.y,
            width: body.width,
            height: body.height,
            rotation: body.rotation ?? 0,
          };
          const tables = await zoneTables(client, zone.id);
          const issues = newIssues(planZone(zone, tables), planZone(zone, [...tables, table]));
          if (issues.length > 0) return planRefused(issues);

          const { rows } = await client.query<TableRow>(
            `insert into dining_tables as t
               (venue_id, zone_id, label, min_seats, max_seats, shape, x, y, width, height,
                rotation, style, bookable)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             returning ${TABLE_COLUMNS}`,
            [
              venueId,
              zone.id,
              table.label,
              table.minSeats,
              table.maxSeats,
              table.shape,
              table.x,
              table.y,
              table.width,
              table.height,
              table.rotation,
              body.style ?? {},
              body.bookable ?? true,
            ],
          );
          const created = rows[0];
          if (!created) throw new Error("Table insert returned no row");
          return { status: 201, body: toApiTable(created) };
        }),
      );
    },
  );

  app.patch<{ Params: { slug: string; tableId: string }; Body: TableBody }>(
    "/venues/:slug/tables/:tableId",
    {
      schema: {
        summary: "Move, resize, turn, restyle or change the seats of a table.",
        description:
          "Send only the fields that change. `zoneId` moves the table to another zone. " +
          "Refused with 422 when the plan would become invalid, and with 409 when an upcoming " +
          "reservation at this table would no longer have room. Setting `bookable` to false is " +
          "always allowed: reservations already made keep the table.",
        tags,
        params: tableParams,
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: { zoneId: uuid, ...tableFields },
        },
        response: {
          200: tableSchema,
          400: errorResponse,
          404: errorResponse,
          409: errorResponse,
          422: issuesResponse,
        },
      },
    },
    (request, reply) => {
      const body = request.body;
      const invalid = checkText(body);
      if (invalid) return send(reply, invalid);

      return run(reply, "A table with that label already exists in this zone", () =>
        inTransaction(pool, async (client): Promise<Outcome> => {
          const venueId = await findVenueId(client, request.params.slug);
          if (!venueId) return notFound("Venue");
          const { tableId } = request.params;

          // Zones are locked before tables, so first find out which zone the table is in.
          const peek = await client.query<{ zone_id: string }>(
            "select zone_id from dining_tables where id = $1 and venue_id = $2 and retired_at is null",
            [tableId, venueId],
          );
          const fromZoneId = peek.rows[0]?.zone_id;
          if (!fromZoneId) return notFound("Table");
          const toZoneId = body.zoneId ?? fromZoneId;

          const zones = await lockZones(client, venueId, [fromZoneId, toZoneId]);
          const fromZone = zones.get(fromZoneId);
          const toZone = zones.get(toZoneId);
          if (!toZone) return notFound("Zone");

          const locked = await client.query<TableRow>(
            `select ${TABLE_COLUMNS} from dining_tables t
              where t.id = $1 and t.retired_at is null
                for update`,
            [tableId],
          );
          const current = locked.rows[0];
          if (!fromZone || current?.zone_id !== fromZoneId) {
            return {
              status: 409,
              body: { error: "The table changed while saving. Please try again." },
            };
          }

          const before = toApiTable(current);
          const after: ApiTable = {
            ...before,
            zoneId: toZoneId,
            label: body.label?.trim() ?? before.label,
            minSeats: body.minSeats ?? before.minSeats,
            maxSeats: body.maxSeats ?? before.maxSeats,
            shape: body.shape ?? before.shape,
            x: body.x ?? before.x,
            y: body.y ?? before.y,
            width: body.width ?? before.width,
            height: body.height ?? before.height,
            rotation: body.rotation ?? before.rotation,
            style: body.style ?? before.style,
            bookable: body.bookable ?? before.bookable,
          };

          // Taking a table out of a zone cannot break that zone, so only the zone it ends up
          // in is checked.
          const others = (await zoneTables(client, toZoneId)).filter((t) => t.id !== tableId);
          const issues = newIssues(
            planZone(toZone, toZoneId === fromZoneId ? [...others, before] : others),
            planZone(toZone, [...others, after]),
          );
          if (issues.length > 0) return planRefused(issues);

          const withoutRoom = await reservationsLeftWithoutRoom(client, after);
          if (withoutRoom > 0) {
            return {
              status: 409,
              body: {
                error:
                  `${withoutRoom} upcoming reservation(s) at this table would no longer have ` +
                  "room. Move or cancel them first.",
              },
            };
          }

          const { rows } = await client.query<TableRow>(
            `update dining_tables t
                set zone_id = $2, label = $3, min_seats = $4, max_seats = $5, shape = $6,
                    x = $7, y = $8, width = $9, height = $10, rotation = $11, style = $12,
                    bookable = $13
              where t.id = $1
              returning ${TABLE_COLUMNS}`,
            [
              tableId,
              after.zoneId,
              after.label,
              after.minSeats,
              after.maxSeats,
              after.shape,
              after.x,
              after.y,
              after.width,
              after.height,
              after.rotation,
              after.style,
              after.bookable,
            ],
          );
          const updated = rows[0];
          if (!updated) throw new Error("Table update returned no row");
          return { status: 200, body: toApiTable(updated) };
        }),
      );
    },
  );

  app.delete<{ Params: { slug: string; tableId: string } }>(
    "/venues/:slug/tables/:tableId",
    {
      schema: {
        summary: "Remove a table from the plan.",
        description:
          "Refused while the table has an upcoming reservation; mark it as not bookable " +
          "instead. A table booked in the past is retired, so old reservations keep it.",
        tags,
        params: tableParams,
        response: { 204: { type: "null" }, 404: errorResponse, 409: errorResponse },
      },
    },
    async (request, reply) =>
      send(
        reply,
        await inTransaction(pool, async (client): Promise<Outcome> => {
          const venueId = await findVenueId(client, request.params.slug);
          if (!venueId) return notFound("Venue");
          const { tableId } = request.params;

          const peek = await client.query<{ zone_id: string }>(
            "select zone_id from dining_tables where id = $1 and venue_id = $2 and retired_at is null",
            [tableId, venueId],
          );
          const zoneId = peek.rows[0]?.zone_id;
          if (!zoneId) return notFound("Table");
          await lockZones(client, venueId, [zoneId]);
          const locked = await client.query<{ zone_id: string }>(
            "select zone_id from dining_tables where id = $1 and retired_at is null for update",
            [tableId],
          );
          if (locked.rows[0]?.zone_id !== zoneId) {
            return {
              status: 409,
              body: { error: "The table changed while saving. Please try again." },
            };
          }

          const upcoming = await upcomingReservationCount(client, [tableId]);
          if (upcoming > 0) {
            return {
              status: 409,
              body: {
                error:
                  `${upcoming} upcoming reservation(s) use this table. Move or cancel them ` +
                  "first, or mark it as not bookable.",
              },
            };
          }

          const retired = await client.query(
            `update dining_tables t set retired_at = now(), bookable = false
              where t.id = $1 and ${HAS_HISTORY}`,
            [tableId],
          );
          if (!retired.rowCount) {
            await client.query("delete from dining_tables where id = $1", [tableId]);
          }
          return { status: 204 };
        }),
      ),
  );

  return Promise.resolve();
};
