import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import {
  createVenue,
  deleteVenue,
  ownerCookie,
  TEST_APP_OPTIONS,
  testDatabaseUrl,
} from "./helpers.js";

interface Rules {
  horizonDays: number;
  weekly: { weekday: number; firstArrival: string; lastArrival: string }[];
  specialDays: { date: string; windows: { firstArrival: string; lastArrival: string }[] }[];
}

const pool = createPool(testDatabaseUrl());
let app: FastifyInstance;
let cookie: string;
const slugs: string[] = [];

beforeAll(async () => {
  app = await buildApp({ pool, ...TEST_APP_OPTIONS });
  cookie = await ownerCookie(app);
});

afterEach(async () => {
  for (const slug of slugs.splice(0)) await deleteVenue(pool, slug);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

async function venue(slug: string) {
  slugs.push(slug);
  return createVenue(pool, slug, []);
}

function put(slug: string, rules: object) {
  return app.inject({
    method: "PUT",
    url: `/venues/${slug}/booking-rules`,
    headers: { cookie },
    payload: rules,
  });
}

async function get(slug: string): Promise<Rules> {
  const response = await app.inject({ method: "GET", url: `/venues/${slug}/booking-rules` });
  expect(response.statusCode).toBe(200);
  return response.json<Rules>();
}

const RULES: Rules = {
  horizonDays: 30,
  weekly: [
    { weekday: 6, firstArrival: "13:00", lastArrival: "15:30" },
    { weekday: 6, firstArrival: "20:00", lastArrival: "00:30" },
  ],
  specialDays: [
    { date: "2030-12-25", windows: [] },
    { date: "2030-12-31", windows: [{ firstArrival: "21:00", lastArrival: "21:30" }] },
  ],
};

describe("GET and PUT /venues/:slug/booking-rules", () => {
  it("stores the rules and gives them back", async () => {
    await venue("rules-basic");
    expect((await put("rules-basic", RULES)).statusCode).toBe(204);
    expect(await get("rules-basic")).toEqual(RULES);
  });

  it("replaces everything at once", async () => {
    await venue("rules-replace");
    await put("rules-replace", RULES);
    const fewer: Rules = {
      horizonDays: 90,
      weekly: [{ weekday: 1, firstArrival: "12:00", lastArrival: "14:00" }],
      specialDays: [],
    };
    expect((await put("rules-replace", fewer)).statusCode).toBe(204);
    expect(await get("rules-replace")).toEqual(fewer);
  });

  it("leaves special days in the past out of what guests read", async () => {
    await venue("rules-past");
    await put("rules-past", {
      ...RULES,
      specialDays: [{ date: "2020-01-01", windows: [] }, ...RULES.specialDays],
    });
    expect((await get("rules-past")).specialDays.map((day) => day.date)).toEqual([
      "2030-12-25",
      "2030-12-31",
    ]);
  });

  it("starts with the default horizon and no hours", async () => {
    await venue("rules-default");
    await pool.query(
      "delete from opening_hours where venue_id = (select id from venues where slug = $1)",
      ["rules-default"],
    );
    expect(await get("rules-default")).toEqual({ horizonDays: 60, weekly: [], specialDays: [] });
  });

  it("refuses dates that do not exist, a date listed twice and times that do not exist", async () => {
    await venue("rules-invalid");
    const day = (date: string) => ({ date, windows: [] });

    const yearZero = await put("rules-invalid", { ...RULES, specialDays: [day("0000-01-01")] });
    expect(yearZero.statusCode).toBe(400);

    const february = await put("rules-invalid", { ...RULES, specialDays: [day("2030-02-31")] });
    expect(february.statusCode).toBe(400);

    const twice = await put("rules-invalid", {
      ...RULES,
      specialDays: [day("2030-12-25"), day("2030-12-25")],
    });
    expect(twice.statusCode).toBe(400);

    const midnight = await put("rules-invalid", {
      ...RULES,
      weekly: [{ weekday: 1, firstArrival: "24:00", lastArrival: "01:00" }],
    });
    expect(midnight.statusCode).toBe(400);

    const sunday = await put("rules-invalid", {
      ...RULES,
      weekly: [{ weekday: 0, firstArrival: "12:00", lastArrival: "13:00" }],
    });
    expect(sunday.statusCode).toBe(400);

    const horizon = await put("rules-invalid", { ...RULES, horizonDays: 0 });
    expect(horizon.statusCode).toBe(400);

    // Nothing was half saved along the way.
    expect((await get("rules-invalid")).horizonDays).toBe(60);
  });

  it("returns 404 for a venue that does not exist", async () => {
    // Nobody runs a venue that does not exist, so changing its rules is refused first.
    expect((await put("nowhere", RULES)).statusCode).toBe(403);
    const response = await app.inject({ method: "GET", url: "/venues/nowhere/booking-rules" });
    expect(response.statusCode).toBe(404);
  });
});

describe("opening hours in the database", () => {
  it("keeps every window either weekly or for one special day", async () => {
    const { venueId } = await venue("rules-db");
    await pool.query("insert into special_days (venue_id, day) values ($1, '2030-12-25')", [
      venueId,
    ]);

    // Both a weekday and a date.
    await expect(
      pool.query(
        `insert into opening_hours (venue_id, weekday, on_date, first_arrival, last_arrival)
         values ($1, 1, '2030-12-25', '12:00', '14:00')`,
        [venueId],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    // A date that is not listed as a special day.
    await expect(
      pool.query(
        `insert into opening_hours (venue_id, on_date, first_arrival, last_arrival)
         values ($1, '2030-12-24', '12:00', '14:00')`,
        [venueId],
      ),
    ).rejects.toMatchObject({ code: "23503" });

    // Removing a special day removes its windows.
    await pool.query(
      `insert into opening_hours (venue_id, on_date, first_arrival, last_arrival)
       values ($1, '2030-12-25', '12:00', '14:00')`,
      [venueId],
    );
    await pool.query("delete from special_days where venue_id = $1", [venueId]);
    const { rows } = await pool.query(
      "select 1 from opening_hours where venue_id = $1 and on_date is not null",
      [venueId],
    );
    expect(rows).toHaveLength(0);
  });

  it("keeps the horizon between 1 and 730 days", async () => {
    const { venueId } = await venue("rules-db-horizon");
    await expect(
      pool.query("update venues set booking_horizon_days = 731 where id = $1", [venueId]),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
