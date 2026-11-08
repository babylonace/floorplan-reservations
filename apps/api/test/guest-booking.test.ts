import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import {
  createVenue,
  deleteVenue,
  newGuestEmail,
  TEST_APP_OPTIONS,
  testDatabaseUrl,
} from "./helpers.js";

interface Options {
  name: string;
  locales: string[];
  largestParty: number;
  zones: { id: string; name: string }[];
}

interface Availability {
  date: string;
  slots: { time: string; startsAt: string; available: boolean; zoneIds: string[] }[];
}

const pool = createPool(testDatabaseUrl());
let app: FastifyInstance;
const slugs: string[] = [];

beforeAll(async () => {
  app = await buildApp({ pool, ...TEST_APP_OPTIONS });
});

afterEach(async () => {
  for (const slug of slugs.splice(0)) await deleteVenue(pool, slug);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

/**
 * A venue open all day with three zones: the room (one table for two), a terrace (one table for
 * two) and a private room guests cannot ask for (one table for two).
 */
async function threeZones(slug: string) {
  slugs.push(slug);
  const { venueId } = await createVenue(pool, slug, [{ label: "R1", x: 100 }]);
  const room = await pool.query<{ id: string }>("select id from zones where venue_id = $1", [
    venueId,
  ]);
  const extra = await pool.query<{ id: string; name: string }>(
    `insert into zones (venue_id, name, sort_order, width, height, guest_selectable)
     values ($1, 'Terrace', 1, 1000, 1000, true), ($1, 'Private', 2, 1000, 1000, false)
     returning id, name`,
    [venueId],
  );
  const terrace = extra.rows.find((zone) => zone.name === "Terrace")?.id ?? "";
  const privateRoom = extra.rows.find((zone) => zone.name === "Private")?.id ?? "";
  await pool.query(
    `insert into dining_tables (venue_id, zone_id, label, min_seats, max_seats, x, y, width, height)
     values ($1, $2, 'T1', 1, 2, 100, 100, 80, 80), ($1, $3, 'P1', 1, 2, 100, 100, 80, 80)`,
    [venueId, terrace, privateRoom],
  );
  return { room: room.rows[0]?.id ?? "", terrace, privateRoom };
}

function book(slug: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/venues/${slug}/reservations`,
    payload: { guestName: "Test Guest", guestEmail: newGuestEmail(), partySize: 2, ...body },
  });
}

async function availability(slug: string, date: string, partySize = 2) {
  const response = await app.inject({
    method: "GET",
    url: `/venues/${slug}/availability?date=${date}&partySize=${String(partySize)}`,
  });
  return { status: response.statusCode, body: response.json<Availability>() };
}

const DAY = "2030-06-01";
const EIGHT_PM = "2030-06-01T20:00:00+02:00";

describe("GET /venues/:slug/booking-options", () => {
  it("lists only the zones guests may ask for, in the venue's order", async () => {
    const zones = await threeZones("options-zones");
    const response = await app.inject({
      method: "GET",
      url: "/venues/options-zones/booking-options",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<Options>();
    expect(body).toMatchObject({ name: "options-zones", locales: ["es", "en"], largestParty: 12 });
    expect(body.zones).toEqual([
      { id: zones.room, name: "Room" },
      { id: zones.terrace, name: "Terrace" },
    ]);
  });

  it("answers 404 for a venue that does not exist", async () => {
    const response = await app.inject({ method: "GET", url: "/venues/nowhere/booking-options" });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /venues/:slug/availability", () => {
  it("lists every quarter of an hour and the zones with a free table", async () => {
    const zones = await threeZones("avail-basic");
    const { status, body } = await availability("avail-basic", DAY);
    expect(status).toBe(200);
    // Open from 00:00 to 23:59: 96 quarters of an hour.
    expect(body.slots).toHaveLength(96);
    const eight = body.slots.find((slot) => slot.time === "20:00");
    expect(eight).toEqual({
      time: "20:00",
      startsAt: "2030-06-01T18:00:00.000Z",
      available: true,
      zoneIds: [zones.room, zones.terrace],
    });
  });

  it("leaves out a zone whose tables are taken for the whole stay", async () => {
    const zones = await threeZones("avail-busy");
    expect(
      (await book("avail-busy", { startsAt: EIGHT_PM, zoneId: zones.terrace })).statusCode,
    ).toBe(201);
    const { body } = await availability("avail-busy", DAY);
    const at = (time: string) => body.slots.find((slot) => slot.time === time);
    // A party of two stays 90 minutes, so 18:30 ends just as the 20:00 booking starts.
    expect(at("18:30")?.zoneIds).toEqual([zones.room, zones.terrace]);
    expect(at("18:45")?.zoneIds).toEqual([zones.room]);
    expect(at("21:15")?.zoneIds).toEqual([zones.room]);
    expect(at("21:30")?.zoneIds).toEqual([zones.room, zones.terrace]);
  });

  it("still counts zones guests cannot ask for when saying whether a time is free", async () => {
    const zones = await threeZones("avail-private");
    await book("avail-private", { startsAt: EIGHT_PM, zoneId: zones.room });
    await book("avail-private", { startsAt: EIGHT_PM, zoneId: zones.terrace });
    const { body } = await availability("avail-private", DAY);
    expect(body.slots.find((slot) => slot.time === "20:00")).toMatchObject({
      available: true,
      zoneIds: [],
    });

    await book("avail-private", { startsAt: EIGHT_PM });
    const after = await availability("avail-private", DAY);
    expect(after.body.slots.find((slot) => slot.time === "20:00")?.available).toBe(false);
  });

  it("leaves out times already gone today, days in the past and days beyond the horizon", async () => {
    await threeZones("avail-dates");
    // The tests' clock says 2030-05-20 at 12:00 in Madrid.
    const today = await availability("avail-dates", "2030-05-20");
    expect(today.body.slots[0]?.time).toBe("12:15");
    expect((await availability("avail-dates", "2030-05-19")).body.slots).toEqual([]);
    // The default horizon is 60 days.
    expect((await availability("avail-dates", "2030-07-19")).body.slots).not.toEqual([]);
    expect((await availability("avail-dates", "2030-07-20")).body.slots).toEqual([]);
  });

  it("has no times for a party too big to book online", async () => {
    await threeZones("avail-big");
    expect((await availability("avail-big", DAY, 13)).body.slots).toEqual([]);
  });

  it("refuses a date that does not exist", async () => {
    await threeZones("avail-bad");
    expect((await availability("avail-bad", "2030-02-30")).status).toBe(400);
    expect((await availability("avail-bad", "tomorrow")).status).toBe(400);
  });
});

describe("POST /venues/:slug/reservations with a zone", () => {
  it("books in the zone the guest asked for, even when another one would be picked first", async () => {
    const zones = await threeZones("zone-pick");
    const response = await book("zone-pick", { startsAt: EIGHT_PM, zoneId: zones.terrace });
    expect(response.statusCode).toBe(201);
    expect(response.json<{ tables: { label: string }[] }>().tables[0]?.label).toBe("T1");
  });

  it("says the zone is full instead of seating the guest somewhere else", async () => {
    const zones = await threeZones("zone-full");
    await book("zone-full", { startsAt: EIGHT_PM, zoneId: zones.terrace });
    const response = await book("zone-full", { startsAt: EIGHT_PM, zoneId: zones.terrace });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "zone_full" });
  });

  it("refuses a zone guests may not ask for, or one of another venue", async () => {
    const zones = await threeZones("zone-private");
    const other = await threeZones("zone-other");
    for (const zoneId of [zones.privateRoom, other.terrace]) {
      const response = await book("zone-private", { startsAt: EIGHT_PM, zoneId });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: "zone_not_offered" });
    }
  });

  it("names the reason when nothing is free at all", async () => {
    await threeZones("zone-none");
    for (let i = 0; i < 3; i++) await book("zone-none", { startsAt: EIGHT_PM });
    const response = await book("zone-none", { startsAt: EIGHT_PM });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "no_table" });
  });
});
