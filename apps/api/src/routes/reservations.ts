import {
  durationFor,
  seatingOptions,
  type PlanZone,
  type TableShape,
} from "@floorplan-reservations/engine";
import type { FastifyPluginAsync } from "fastify";
import type { PoolClient } from "pg";
import type { Pool } from "../db.js";

const SLUG_PATTERN = "^[a-z0-9]+(-[a-z0-9]+)*$";

// PostgreSQL error codes that mean "someone else got there first, try again".
const EXCLUSION_VIOLATION = "23P01";
const DEADLOCK_DETECTED = "40P01";

/**
 * How many times one request re-reads the free tables after losing a race. Each round of a race
 * has a winner, so this only runs out when many people book the same few tables at once; they
 * are then told nothing is free and can try again.
 */
const MAX_ATTEMPTS = 8;

const createBody = {
  type: "object",
  additionalProperties: false,
  required: ["startsAt", "partySize", "guestName"],
  // At least one way to reach the guest, as the database also requires.
  anyOf: [{ required: ["guestEmail"] }, { required: ["guestPhone"] }],
  properties: {
    startsAt: {
      type: "string",
      format: "date-time",
      description: "Arrival time with its offset, for example 2030-05-01T21:00:00+02:00.",
    },
    partySize: { type: "integer", minimum: 1, maximum: 100 },
    guestName: { type: "string", minLength: 1, maxLength: 120, pattern: "\\S" },
    guestEmail: { type: "string", format: "email", maxLength: 254 },
    guestPhone: { type: "string", minLength: 6, maxLength: 32, pattern: "^[+0-9 ()-]+$" },
    locale: {
      type: "string",
      pattern: "^[a-z]{2,3}(-[A-Z]{2})?$",
      description: "Language for messages to the guest. Defaults to the venue's language.",
    },
    notes: { type: "string", maxLength: 500 },
  },
} as const;

const reservationResponse = {
  type: "object",
  required: ["id", "status", "startsAt", "endsAt", "partySize", "tables"],
  properties: {
    id: { type: "string", format: "uuid" },
    status: { type: "string" },
    startsAt: { type: "string", format: "date-time" },
    endsAt: { type: "string", format: "date-time" },
    partySize: { type: "integer" },
    tables: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "zoneId"],
        properties: {
          id: { type: "string", format: "uuid" },
          label: { type: "string" },
          zoneId: { type: "string", format: "uuid" },
        },
      },
    },
  },
} as const;

const errorResponse = {
  type: "object",
  required: ["error"],
  properties: { error: { type: "string" } },
} as const;

interface CreateBody {
  startsAt: string;
  partySize: number;
  guestName: string;
  guestEmail?: string;
  guestPhone?: string;
  locale?: string;
  notes?: string;
}

interface VenueRow {
  id: string;
  default_locale: string;
  locales: string[];
}

interface TableRow {
  id: string;
  zone_id: string;
  zone_name: string;
  zone_width: number;
  zone_height: number;
  label: string;
  min_seats: number;
  max_seats: number;
  shape: TableShape;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** The venue's bookable tables, grouped by zone in the order staff set. */
async function loadPlan(pool: Pool, venueId: string): Promise<PlanZone[]> {
  const { rows } = await pool.query<TableRow>(
    `select t.id, t.zone_id, z.name as zone_name, z.width as zone_width, z.height as zone_height,
            t.label, t.min_seats, t.max_seats, t.shape, t.x, t.y, t.width, t.height, t.rotation
       from dining_tables t
       join zones z on z.id = t.zone_id
      where t.venue_id = $1 and t.bookable
      order by z.sort_order, z.name, t.label`,
    [venueId],
  );

  const zones = new Map<string, PlanZone>();
  for (const row of rows) {
    let zone = zones.get(row.zone_id);
    if (!zone) {
      zone = {
        id: row.zone_id,
        name: row.zone_name,
        width: row.zone_width,
        height: row.zone_height,
        tables: [],
      };
      zones.set(row.zone_id, zone);
    }
    zone.tables.push({
      id: row.id,
      label: row.label,
      minSeats: row.min_seats,
      maxSeats: row.max_seats,
      shape: row.shape,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      rotation: row.rotation,
    });
  }
  return [...zones.values()];
}

function isRaceLost(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === EXCLUSION_VIOLATION || code === DEADLOCK_DETECTED;
}

type Booking = { id: string; status: string; tableIds: string[] } | null;

/**
 * Books the best free tables inside one transaction. When another request takes the same table
 * first, the database rejects this one; it then rolls back to its savepoint, reads the free
 * tables again and tries the next best choice. Returns null when nothing is free.
 */
async function bookBestTables(
  client: PoolClient,
  plan: PlanZone[],
  venueId: string,
  body: CreateBody,
  locale: string,
  startsAt: Date,
  endsAt: Date,
): Promise<Booking> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await client.query("savepoint attempt");
    try {
      const busy = await client.query<{ table_id: string }>(
        `select distinct table_id
           from reservation_tables
          where venue_id = $1 and holds_tables and during && tstzrange($2, $3, '[)')`,
        [venueId, startsAt, endsAt],
      );
      const [best] = seatingOptions(
        body.partySize,
        plan,
        new Set(busy.rows.map((row) => row.table_id)),
      );
      if (!best) return null;

      const reservation = await client.query<{ id: string; status: string }>(
        `insert into reservations
           (venue_id, starts_at, ends_at, party_size, guest_name, guest_email, guest_phone, locale, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning id, status`,
        [
          venueId,
          startsAt,
          endsAt,
          body.partySize,
          body.guestName.trim(),
          body.guestEmail ?? null,
          body.guestPhone ?? null,
          locale,
          body.notes ?? null,
        ],
      );
      const created = reservation.rows[0];
      if (!created) throw new Error("Reservation insert returned no row");

      // Requests that want the same table queue up here, one at a time, until the one ahead
      // commits or gives up. Without the queue, two requests writing the same table at the
      // same instant can wait for each other until PostgreSQL breaks the tie, which takes a
      // second. Tables are taken in id order, so groups of tables cannot lock each other out.
      // The queue only speeds things up: the exclusion constraint still decides who wins.
      for (const tableId of best.tableIds) {
        await client.query("select pg_advisory_xact_lock(hashtextextended('table:' || $1, 0))", [
          tableId,
        ]);
      }
      await client.query(
        `insert into reservation_tables (reservation_id, table_id, venue_id)
         select $1, table_id, $3 from unnest($2::uuid[]) as table_id`,
        [created.id, best.tableIds, venueId],
      );
      await client.query("release savepoint attempt");
      return { ...created, tableIds: best.tableIds };
    } catch (error) {
      if (!isRaceLost(error)) throw error;
      await client.query("rollback to savepoint attempt");
    }
  }
  return null;
}

export const reservationRoutes: FastifyPluginAsync<{ pool: Pool }> = (app, { pool }) => {
  app.post<{ Params: { slug: string }; Body: CreateBody }>(
    "/venues/:slug/reservations",
    {
      schema: {
        summary: "Book a table. The engine picks one table, or several pushed together.",
        description:
          "How long the table is kept depends on the party size. The database refuses any " +
          "booking that would share a table with another one at the same time.",
        tags: ["reservations"],
        params: {
          type: "object",
          required: ["slug"],
          properties: { slug: { type: "string", pattern: SLUG_PATTERN, maxLength: 80 } },
        },
        body: createBody,
        response: {
          201: reservationResponse,
          400: errorResponse,
          404: errorResponse,
          409: errorResponse,
          422: errorResponse,
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const startsAt = new Date(body.startsAt);
      if (Number.isNaN(startsAt.getTime())) {
        return reply.code(400).send({ error: "startsAt is not a valid date" });
      }
      if (startsAt.getTime() <= Date.now()) {
        return reply.code(400).send({ error: "startsAt must be in the future" });
      }

      const minutes = durationFor(body.partySize);
      if (minutes === null) {
        return reply
          .code(422)
          .send({ error: "This party is too big to book online. Please contact the venue." });
      }
      const endsAt = new Date(startsAt.getTime() + minutes * 60_000);

      const venueResult = await pool.query<VenueRow>(
        "select id, default_locale, locales from venues where slug = $1",
        [request.params.slug],
      );
      const venue = venueResult.rows[0];
      if (!venue) {
        return reply.code(404).send({ error: "Venue not found" });
      }

      const locale = body.locale ?? venue.default_locale;
      if (!venue.locales.includes(locale)) {
        return reply.code(400).send({ error: "This venue does not offer that language" });
      }

      const plan = await loadPlan(pool, venue.id);
      const client = await pool.connect();
      let booking: Booking;
      try {
        await client.query("begin");
        booking = await bookBestTables(client, plan, venue.id, body, locale, startsAt, endsAt);
        await client.query(booking ? "commit" : "rollback");
        client.release();
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        // A connection in an unknown state is thrown away instead of going back to the pool.
        client.release(true);
        throw error;
      }

      if (!booking) {
        return reply.code(409).send({ error: "No table is free for that party at that time" });
      }

      const tablesById = new Map(
        plan.flatMap((zone) =>
          zone.tables.map((table) => [
            table.id,
            { id: table.id, label: table.label, zoneId: zone.id },
          ]),
        ),
      );
      return reply.code(201).send({
        id: booking.id,
        status: booking.status,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        partySize: body.partySize,
        tables: booking.tableIds.flatMap((id) => tablesById.get(id) ?? []),
      });
    },
  );
  return Promise.resolve();
};
