import { isoWeekday, type OpeningHours } from "@floorplan-reservations/engine";
import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "../db.js";
import { inTransaction } from "../transaction.js";
import { authResponses, requireVenueRole, SESSION_SECURITY } from "./auth.js";
import { errorResponse, slugParam } from "./shared.js";

/**
 * When guests may book online: how many days ahead, and the arrival windows of each day.
 * Guests read the rules to build a calendar; staff replace them as a whole.
 */

const MAX_WEEKLY_WINDOWS = 50;
const MAX_SPECIAL_DAYS = 400;
const MAX_WINDOWS_PER_DAY = 10;

type Queryable = Pick<Pool, "query">;

const time = {
  type: "string",
  pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$",
  description: "Local time in the venue's time zone, HH:MM.",
} as const;

const windowFields = { firstArrival: time, lastArrival: time } as const;

const arrivalWindow = {
  type: "object",
  additionalProperties: false,
  required: ["firstArrival", "lastArrival"],
  description: "A last arrival earlier than the first one means the window runs past midnight.",
  properties: windowFields,
} as const;

const rulesSchema = {
  type: "object",
  additionalProperties: false,
  required: ["horizonDays", "weekly", "specialDays"],
  properties: {
    horizonDays: {
      type: "integer",
      minimum: 1,
      maximum: 730,
      description: "Guests may book from today up to this many days ahead.",
    },
    weekly: {
      type: "array",
      maxItems: MAX_WEEKLY_WINDOWS,
      description: "Arrival windows that repeat every week. A weekday with none is closed.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["weekday", "firstArrival", "lastArrival"],
        properties: {
          weekday: { type: "integer", minimum: 1, maximum: 7, description: "1 = Monday." },
          ...windowFields,
        },
      },
    },
    specialDays: {
      type: "array",
      maxItems: MAX_SPECIAL_DAYS,
      description:
        "Dates that do not follow the weekly hours. A special day with no windows is closed.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "windows"],
        properties: {
          date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          windows: { type: "array", maxItems: MAX_WINDOWS_PER_DAY, items: arrivalWindow },
        },
      },
    },
  },
} as const;

export interface BookingRules extends OpeningHours {
  horizonDays: number;
}

interface WindowRow {
  weekday: number | null;
  on_date: string | null;
  first_arrival: string;
  last_arrival: string;
}

/**
 * Reads a venue's opening hours. With `dates`, only the special days among those dates are
 * read, which is all a single booking needs.
 */
export async function loadOpeningHours(
  db: Queryable,
  venueId: string,
  dates?: string[],
): Promise<OpeningHours> {
  const dateFilter = dates ? "and day = any($2::date[])" : "";
  const params = dates ? [venueId, dates] : [venueId];
  const special = await db.query<{ day: string }>(
    `select to_char(day, 'YYYY-MM-DD') as day from special_days
      where venue_id = $1 ${dateFilter} order by day`,
    params,
  );
  const windows = await db.query<WindowRow>(
    `select weekday, to_char(on_date, 'YYYY-MM-DD') as on_date,
            to_char(first_arrival, 'HH24:MI') as first_arrival,
            to_char(last_arrival, 'HH24:MI') as last_arrival
       from opening_hours
      where venue_id = $1 and (weekday is not null or on_date = any($2::date[]))
      order by weekday nulls last, on_date, first_arrival`,
    [venueId, special.rows.map((row) => row.day)],
  );

  return {
    weekly: windows.rows.flatMap((row) =>
      row.weekday === null
        ? []
        : [
            {
              weekday: row.weekday,
              firstArrival: row.first_arrival,
              lastArrival: row.last_arrival,
            },
          ],
    ),
    specialDays: special.rows.map(({ day }) => ({
      date: day,
      windows: windows.rows
        .filter((row) => row.on_date === day)
        .map((row) => ({ firstArrival: row.first_arrival, lastArrival: row.last_arrival })),
    })),
  };
}

function isRealDate(date: string): boolean {
  try {
    isoWeekday(date);
    return true;
  } catch {
    return false;
  }
}

export const bookingRulesRoutes: FastifyPluginAsync<{ pool: Pool; now: () => Date }> = (
  app,
  { pool, now },
) => {
  const tags = ["booking rules"];
  const params = {
    type: "object",
    required: ["slug"],
    properties: { slug: slugParam },
  } as const;

  app.get<{ Params: { slug: string } }>(
    "/venues/:slug/booking-rules",
    {
      schema: {
        summary: "How far ahead guests may book, and when they may arrive.",
        description: "Special days in the past are left out.",
        tags,
        params,
        response: { 200: rulesSchema, 404: errorResponse },
      },
    },
    async (request, reply) => {
      const venue = await pool.query<{ id: string; booking_horizon_days: number; today: string }>(
        `select id, booking_horizon_days,
                to_char(($2::timestamptz at time zone time_zone)::date, 'YYYY-MM-DD') as today
           from venues where slug = $1`,
        [request.params.slug, now()],
      );
      const row = venue.rows[0];
      if (!row) return reply.code(404).send({ error: "Venue not found" });

      const hours = await loadOpeningHours(pool, row.id);
      return {
        horizonDays: row.booking_horizon_days,
        weekly: hours.weekly,
        specialDays: hours.specialDays.filter((day) => day.date >= row.today),
      };
    },
  );

  app.put<{ Params: { slug: string }; Body: BookingRules }>(
    "/venues/:slug/booking-rules",
    {
      // Only an owner of the venue may change when guests can book.
      onRequest: requireVenueRole(pool, now, ["owner"]),
      schema: {
        summary: "Replace the booking rules: horizon, weekly hours and special days.",
        description:
          "Everything is replaced at once. Bookings already made are kept, even when they now " +
          "fall outside the hours.",
        tags,
        security: SESSION_SECURITY,
        params,
        body: rulesSchema,
        response: {
          ...authResponses,
          204: { type: "null" },
          400: errorResponse,
          404: errorResponse,
        },
      },
    },
    async (request, reply) => {
      const { horizonDays, weekly, specialDays } = request.body;
      const dates = specialDays.map((day) => day.date);
      const badDate = dates.find((date) => !isRealDate(date));
      if (badDate !== undefined) {
        return reply.code(400).send({ error: `${badDate} is not a real date` });
      }
      if (new Set(dates).size !== dates.length) {
        return reply.code(400).send({ error: "Each special day may only be listed once" });
      }

      const found = await inTransaction(pool, async (client) => {
        // Locking the venue makes two replacements take turns instead of mixing their rows.
        const venue = await client.query<{ id: string }>(
          "update venues set booking_horizon_days = $2 where slug = $1 returning id",
          [request.params.slug, horizonDays],
        );
        const venueId = venue.rows[0]?.id;
        if (!venueId) return false;

        await client.query("delete from opening_hours where venue_id = $1", [venueId]);
        await client.query("delete from special_days where venue_id = $1", [venueId]);
        await client.query(
          "insert into special_days (venue_id, day) select $1, unnest($2::date[])",
          [venueId, dates],
        );
        const windows = [
          ...weekly.map((window) => ({ ...window, date: null as string | null })),
          ...specialDays.flatMap((day) =>
            day.windows.map((window) => ({ ...window, weekday: null, date: day.date })),
          ),
        ];
        await client.query(
          `insert into opening_hours (venue_id, weekday, on_date, first_arrival, last_arrival)
           select $1, w.weekday, w.on_date, w.first_arrival, w.last_arrival
             from unnest($2::smallint[], $3::date[], $4::time[], $5::time[])
                    as w (weekday, on_date, first_arrival, last_arrival)`,
          [
            venueId,
            windows.map((window) => window.weekday),
            windows.map((window) => window.date),
            windows.map((window) => window.firstArrival),
            windows.map((window) => window.lastArrival),
          ],
        );
        return true;
      });

      if (!found) return reply.code(404).send({ error: "Venue not found" });
      return reply.code(204).send();
    },
  );

  return Promise.resolve();
};
