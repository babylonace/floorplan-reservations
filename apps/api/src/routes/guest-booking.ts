import {
  arrivalTimes,
  durationFor,
  largestParty,
  seatingOptions,
} from "@floorplan-reservations/engine";
import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "../db.js";
import { loadOpeningHours } from "./booking-rules.js";
import { loadPlan } from "./reservations.js";
import { errorResponse, slugParam } from "./shared.js";

/**
 * What the public booking page needs besides the booking rules: the venue's name and languages,
 * the zones a guest may ask for, and which arrival times of a day still have room.
 */

/** Minutes between two arrival times a guest can pick. */
export const ARRIVAL_STEP_MINUTES = 15;

export interface AvailabilityRateLimit {
  /** Availability requests one address may send per window. */
  max: number;
  windowMs: number;
}

const optionsResponse = {
  type: "object",
  required: ["name", "timeZone", "defaultLocale", "locales", "largestParty", "zones"],
  properties: {
    name: { type: "string" },
    timeZone: { type: "string" },
    defaultLocale: { type: "string" },
    locales: {
      type: "array",
      items: { type: "string" },
      description: "Languages the venue writes to guests in.",
    },
    largestParty: {
      type: "integer",
      description: "Bigger groups have to contact the venue.",
    },
    zones: {
      type: "array",
      description: "Zones a guest may ask for, in the venue's order.",
      items: {
        type: "object",
        required: ["id", "name"],
        properties: { id: { type: "string", format: "uuid" }, name: { type: "string" } },
      },
    },
  },
} as const;

const availabilityResponse = {
  type: "object",
  required: ["date", "slots"],
  properties: {
    date: { type: "string" },
    slots: {
      type: "array",
      description:
        "Arrival times of that day that are still ahead, every 15 minutes. Times past " +
        "midnight belong to the day the evening started.",
      items: {
        type: "object",
        required: ["time", "startsAt", "available", "zoneIds"],
        properties: {
          time: { type: "string", description: "Local time, HH:MM." },
          startsAt: { type: "string", format: "date-time" },
          available: { type: "boolean", description: "Some table is free, in any zone." },
          zoneIds: {
            type: "array",
            items: { type: "string", format: "uuid" },
            description: "Zones a guest may ask for that have a free table at this time.",
          },
        },
      },
    },
  },
} as const;

interface VenueRow {
  id: string;
  name: string;
  time_zone: string;
  default_locale: string;
  locales: string[];
  booking_horizon_days: number;
  today: string;
}

interface Slot {
  time: string;
  startsAt: string;
  available: boolean;
  zoneIds: string[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function isRealDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export const guestBookingRoutes: FastifyPluginAsync<{
  pool: Pool;
  now: () => Date;
  rateLimit: AvailabilityRateLimit;
}> = (app, { pool, now, rateLimit }) => {
  const tags = ["booking page"];
  const params = { type: "object", required: ["slug"], properties: { slug: slugParam } } as const;

  async function findVenue(slug: string): Promise<VenueRow | undefined> {
    const { rows } = await pool.query<VenueRow>(
      `select id, name, time_zone, default_locale, locales, booking_horizon_days,
              to_char(($2::timestamptz at time zone time_zone)::date, 'YYYY-MM-DD') as today
         from venues where slug = $1`,
      [slug, now()],
    );
    return rows[0];
  }

  app.get<{ Params: { slug: string } }>(
    "/venues/:slug/booking-options",
    {
      schema: {
        summary: "The venue's name, languages and the zones guests may ask for.",
        tags,
        params,
        response: { 200: optionsResponse, 404: errorResponse },
      },
    },
    async (request, reply) => {
      const venue = await findVenue(request.params.slug);
      if (!venue) return reply.code(404).send({ error: "Venue not found" });
      const zones = await pool.query<{ id: string; name: string }>(
        `select id, name from zones
          where venue_id = $1 and guest_selectable and retired_at is null
          order by sort_order, name`,
        [venue.id],
      );
      return {
        name: venue.name,
        timeZone: venue.time_zone,
        defaultLocale: venue.default_locale,
        locales: venue.locales,
        largestParty: largestParty(),
        zones: zones.rows,
      };
    },
  );

  app.get<{ Params: { slug: string }; Querystring: { date: string; partySize: number } }>(
    "/venues/:slug/availability",
    {
      config: { rateLimit: { max: rateLimit.max, timeWindow: rateLimit.windowMs } },
      schema: {
        summary: "Which arrival times of a day still have a table for the party.",
        description:
          "A free time is a hint, not a promise: someone else may book it first. Days before " +
          "today or beyond the booking horizon have no times.",
        tags,
        params,
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["date", "partySize"],
          properties: {
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            partySize: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
        response: { 200: availabilityResponse, 400: errorResponse, 404: errorResponse },
      },
    },
    async (request, reply) => {
      const { date, partySize } = request.query;
      if (!DATE.test(date) || !isRealDate(date)) {
        return reply.code(400).send({ error: `${date} is not a real date` });
      }
      const venue = await findVenue(request.params.slug);
      if (!venue) return reply.code(404).send({ error: "Venue not found" });

      const minutes = durationFor(partySize);
      const ahead = daysBetween(venue.today, date);
      if (minutes === null || ahead < 0 || ahead > venue.booking_horizon_days) {
        return { date, slots: [] };
      }

      const hours = await loadOpeningHours(pool, venue.id, [date]);
      const times = arrivalTimes(hours, date, ARRIVAL_STEP_MINUTES);
      if (times.length === 0) return { date, slots: [] };

      // Local date and time to an instant, in the venue's own time zone.
      const instants = await pool.query<{ at: Date }>(
        `select (x.day + x.at::time) at time zone $3 as at
           from unnest($1::date[], $2::text[]) with ordinality as x (day, at, n)
          order by x.n`,
        [times.map((slot) => slot.date), times.map((slot) => slot.time), venue.time_zone],
      );
      const current = now().getTime();
      const upcoming = times
        .map((slot, index) => ({ ...slot, at: instants.rows[index]?.at ?? new Date(0) }))
        .filter((slot) => slot.at.getTime() > current);
      const first = upcoming[0];
      const last = upcoming.at(-1);
      if (!first || !last) return { date, slots: [] };

      const lengthMs = minutes * 60_000;
      const [plan, selectable, held] = await Promise.all([
        loadPlan(pool, venue.id),
        pool.query<{ id: string }>(
          "select id from zones where venue_id = $1 and guest_selectable and retired_at is null",
          [venue.id],
        ),
        pool.query<{ table_id: string; starts: Date; ends: Date }>(
          `select table_id, lower(during) as starts, upper(during) as ends
             from reservation_tables
            where venue_id = $1 and holds_tables and during && tstzrange($2, $3, '[)')`,
          [venue.id, first.at, new Date(last.at.getTime() + lengthMs)],
        ),
      ]);
      const offered = new Set(selectable.rows.map((row) => row.id));

      const slots: Slot[] = upcoming.map((slot) => {
        const start = slot.at.getTime();
        const end = start + lengthMs;
        const busy = new Set(
          held.rows
            .filter((row) => row.starts.getTime() < end && row.ends.getTime() > start)
            .map((row) => row.table_id),
        );
        const options = seatingOptions(partySize, plan, busy);
        const withRoom = new Set(options.map((option) => option.zoneId));
        // In the venue's order, like the zone picker.
        const zoneIds = plan
          .map((zone) => zone.id)
          .filter((id) => withRoom.has(id) && offered.has(id));
        return {
          time: slot.time,
          startsAt: slot.at.toISOString(),
          available: options.length > 0,
          zoneIds,
        };
      });
      return { date, slots };
    },
  );

  return Promise.resolve();
};
