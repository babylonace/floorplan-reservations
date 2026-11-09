import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "../db.js";
import { queueStatusEmail } from "../email/outbox.js";
import { inTransaction } from "../transaction.js";
import { authResponses, requireVenueRole, SESSION_SECURITY } from "./auth.js";
import { errorResponse, slugParam } from "./shared.js";

/**
 * The day's service for the venue's staff: the bookings of one day with the guests' details,
 * and the buttons that move a booking on (confirm, seat, no-show, cancel). Guest details only
 * leave the API here, to signed-in staff of that venue.
 */

export const STATUSES = [
  "pending",
  "confirmed",
  "seated",
  "completed",
  "cancelled",
  "no_show",
] as const;
type Status = (typeof STATUSES)[number];

/** The statuses staff can set, and the ones each can be set from. */
export const ALLOWED_FROM = {
  confirmed: ["pending"],
  seated: ["pending", "confirmed"],
  no_show: ["pending", "confirmed"],
  cancelled: ["pending", "confirmed"],
} as const satisfies Partial<Record<Status, readonly Status[]>>;
type Action = keyof typeof ALLOWED_FROM;

const tags = ["service"];
const STAFF_ROLES = ["owner", "staff"] as const;

const reservationSchema = {
  type: "object",
  required: [
    "id",
    "status",
    "startsAt",
    "endsAt",
    "partySize",
    "guestName",
    "guestEmail",
    "guestPhone",
    "notes",
    "locale",
    "tables",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    status: { type: "string", enum: [...STATUSES] },
    startsAt: { type: "string", format: "date-time" },
    endsAt: { type: "string", format: "date-time" },
    partySize: { type: "integer" },
    guestName: { type: "string" },
    guestEmail: { type: ["string", "null"] },
    guestPhone: { type: ["string", "null"] },
    notes: { type: ["string", "null"] },
    locale: { type: "string", description: "The language the guest booked in." },
    tables: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "zoneId", "zoneName"],
        properties: {
          id: { type: "string", format: "uuid" },
          label: { type: "string" },
          zoneId: { type: "string", format: "uuid" },
          zoneName: { type: "string" },
        },
      },
    },
  },
} as const;

interface ReservationRow {
  id: string;
  status: Status;
  starts_at: Date;
  ends_at: Date;
  party_size: number;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  notes: string | null;
  locale: string;
  tables: { id: string; label: string; zoneId: string; zoneName: string }[];
}

const RESERVATION_COLUMNS = `r.id, r.status, r.starts_at, r.ends_at, r.party_size, r.guest_name,
  r.guest_email, r.guest_phone, r.notes, r.locale,
  coalesce((select json_agg(json_build_object('id', t.id, 'label', t.label, 'zoneId', z.id,
                                              'zoneName', z.name)
                            order by z.sort_order, t.label)
              from reservation_tables rt
              join dining_tables t on t.id = rt.table_id
              join zones z on z.id = t.zone_id
             where rt.reservation_id = r.id), '[]') as tables`;

function toApi(row: ReservationRow) {
  return {
    id: row.id,
    status: row.status,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    partySize: row.party_size,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    guestPhone: row.guest_phone,
    notes: row.notes,
    locale: row.locale,
    tables: row.tables,
  };
}

function isRealDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
}

export interface ServiceRouteOptions {
  pool: Pool;
  now: () => Date;
  /** Called after a change queued e-mails, so they go out without waiting for the timer. */
  onEmailsQueued: () => void;
}

export const serviceRoutes: FastifyPluginAsync<ServiceRouteOptions> = (
  app,
  { pool, now, onEmailsQueued },
) => {
  const params = {
    type: "object",
    required: ["slug"],
    properties: { slug: slugParam },
  } as const;

  app.get<{ Params: { slug: string }; Querystring: { date: string } }>(
    "/venues/:slug/reservations",
    {
      onRequest: requireVenueRole(pool, now, STAFF_ROLES),
      schema: {
        summary: "The bookings of one day, with the guests' details, for the venue's staff.",
        description:
          "Every booking that starts on that day in the venue's time zone, cancelled ones " +
          "included, ordered by arrival time.",
        tags,
        security: SESSION_SECURITY,
        params,
        querystring: {
          type: "object",
          required: ["date"],
          additionalProperties: false,
          properties: {
            date: {
              type: "string",
              pattern: "^\\d{4}-\\d{2}-\\d{2}$",
              description: "The day, YYYY-MM-DD, in the venue's time zone.",
            },
          },
        },
        response: {
          ...authResponses,
          200: {
            type: "object",
            required: ["date", "timeZone", "reservations"],
            properties: {
              date: { type: "string" },
              timeZone: { type: "string" },
              reservations: { type: "array", items: reservationSchema },
            },
          },
          400: errorResponse,
          404: errorResponse,
        },
      },
    },
    async (request, reply) => {
      const { date } = request.query;
      if (!isRealDate(date)) {
        return reply.code(400).send({ error: `${date} is not a real date` });
      }
      const venue = await pool.query<{ id: string; time_zone: string }>(
        "select id, time_zone from venues where slug = $1",
        [request.params.slug],
      );
      const found = venue.rows[0];
      if (!found) return reply.code(404).send({ error: "Venue not found", code: "not_found" });

      const { rows } = await pool.query<ReservationRow>(
        `select ${RESERVATION_COLUMNS}
           from reservations r
          where r.venue_id = $1
            and r.starts_at >= ($2::date)::timestamp at time zone $3
            and r.starts_at < ($2::date + 1)::timestamp at time zone $3
          order by r.starts_at, r.created_at`,
        [found.id, date, found.time_zone],
      );
      // Guest details must not stay in shared caches or the browser's back button cache.
      void reply.header("cache-control", "no-store");
      return { date, timeZone: found.time_zone, reservations: rows.map(toApi) };
    },
  );

  app.patch<{ Params: { slug: string; id: string }; Body: { status: Action } }>(
    "/venues/:slug/reservations/:id",
    {
      onRequest: requireVenueRole(pool, now, STAFF_ROLES),
      schema: {
        summary: "Confirm, seat, cancel or mark a booking as a no-show.",
        description:
          "A pending booking can be confirmed; pending and confirmed ones can be seated, " +
          "marked as a no-show or cancelled. Cancelled and no-show bookings free their " +
          "tables. Asking for the status a booking already has changes nothing. Confirming " +
          "and cancelling e-mail the guest in their language.",
        tags,
        security: SESSION_SECURITY,
        params: {
          type: "object",
          required: ["slug", "id"],
          properties: { slug: slugParam, id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: { status: { type: "string", enum: Object.keys(ALLOWED_FROM) } },
        },
        response: {
          ...authResponses,
          200: reservationSchema,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    async (request, reply) => {
      const { slug, id } = request.params;
      const status = request.body.status;
      const result = await inTransaction(pool, async (client) => {
        const updated = await client.query<ReservationRow>(
          `update reservations r set status = $3
            where r.id = $1
              and r.venue_id = (select id from venues where slug = $2)
              and r.status = any($4::reservation_status[])
          returning ${RESERVATION_COLUMNS}`,
          [id, slug, status, ALLOWED_FROM[status]],
        );
        const row = updated.rows[0];
        if (row) {
          await queueStatusEmail(client, row.id, status);
          return { changed: true as const, row };
        }
        const current = await client.query<ReservationRow>(
          `select ${RESERVATION_COLUMNS} from reservations r
            where r.id = $1 and r.venue_id = (select id from venues where slug = $2)`,
          [id, slug],
        );
        return { changed: false as const, row: current.rows[0] ?? null };
      });

      if (result.changed) {
        onEmailsQueued();
        return toApi(result.row);
      }
      if (!result.row) {
        return reply.code(404).send({ error: "Reservation not found", code: "not_found" });
      }
      if (result.row.status === status) return toApi(result.row);
      return reply.code(409).send({
        error: `A ${result.row.status} booking cannot become ${status}`,
        code: "status_not_allowed",
      });
    },
  );

  return Promise.resolve();
};
