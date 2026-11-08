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

  async function selectableZones(venueId: string) {
    const { rows } = await pool.query<{ id: string; name: string }>(
      `select z.id, z.name from zones z
          where z.venue_id = $1 and z.guest_selectable and z.retired_at is null
            -- A zone with nothing to book online is not offered, whatever its setting.
            and exists (select 1 from dining_tables t
                         where t.zone_id = z.id and t.bookable and t.retired_at is null)
          order by z.sort_order, z.name`,
      [venueId],
    );
    return rows;
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
      const zones = await selectableZones(venue.id);
      return {
        name: venue.name,
        timeZone: venue.time_zone,
        defaultLocale: venue.default_locale,
        locales: venue.locales,
        largestParty: largestParty(),
        zones,
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

      // Local date and time to an instant, in the venue's own time zone, and back again: a
      // time the clocks skip when they go forward (02:30 on that night) comes back different.
      const instants = await pool.query<{ at: Date; back: string }>(
        `select i.at, to_char(i.at at time zone $3, 'YYYY-MM-DD HH24:MI') as back
           from unnest($1::date[], $2::text[]) with ordinality as x (day, at, n)
           cross join lateral (select (x.day + x.at::time) at time zone $3 as at) i
          order by x.n`,
        [times.map((slot) => slot.date), times.map((slot) => slot.time), venue.time_zone],
      );
      const current = now().getTime();
      const upcoming = times
        .map((slot, index) => ({ ...slot, ...instants.rows[index] }))
        .filter(
          (slot): slot is typeof slot & { at: Date; back: string } =>
            slot.at !== undefined &&
            slot.back === `${slot.date} ${slot.time}` &&
            slot.at.getTime() > current &&
            // Times past midnight count from their own date, as the booking does.
            daysBetween(venue.today, slot.date) <= venue.booking_horizon_days,
        );
      const first = upcoming[0];
      const last = upcoming.at(-1);
      if (!first || !last) return { date, slots: [] };

      const lengthMs = minutes * 60_000;
      // One after the other, so a public request never holds more than one connection.
      const plan = await loadPlan(pool, venue.id);
      const offered = new Set((await selectableZones(venue.id)).map((zone) => zone.id));
      const held = await pool.query<{ table_id: string; starts: Date; ends: Date }>(
        `select table_id, lower(during) as starts, upper(during) as ends
           from reservation_tables
          where venue_id = $1 and holds_tables and during && tstzrange($2, $3, '[)')`,
        [venue.id, first.at, new Date(last.at.getTime() + lengthMs)],
      );
      // Many times of a day see the same tables taken, so the engine runs once per set.
      const seen = new Map<string, string[]>();

      const slots: Slot[] = upcoming.map((slot) => {
        const start = slot.at.getTime();
        const end = start + lengthMs;
        const busy = new Set(
          held.rows
            .filter((row) => row.starts.getTime() < end && row.ends.getTime() > start)
            .map((row) => row.table_id),
        );
        const key = [...busy].sort().join();
        let withRoom = seen.get(key);
        if (!withRoom) {
          const zones = new Set(seatingOptions(partySize, plan, busy).map((o) => o.zoneId));
          // In the venue's order, like the zone picker.
          withRoom = plan.map((zone) => zone.id).filter((id) => zones.has(id));
          seen.set(key, withRoom);
        }
        return {
          time: slot.time,
          startsAt: slot.at.toISOString(),
          available: withRoom.length > 0,
          zoneIds: withRoom.filter((id) => offered.has(id)),
        };
      });
      return { date, slots };
    },
  );

  return Promise.resolve();
};
