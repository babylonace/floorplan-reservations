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
  type TestTable,
  ownerCookie,
} from "./helpers.js";

interface Created {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  partySize: number;
  tables: { id: string; label: string; zoneId: string }[];
}

// Room for every request in the concurrency tests to hold its own connection at once.
const pool = createPool(testDatabaseUrl(), { max: 40 });
let app: FastifyInstance;
let cookie: string;
const slugs: string[] = [];

beforeAll(async () => {
  app = await buildApp({ pool, ...TEST_APP_OPTIONS });
  cookie = await ownerCookie(app);
  // Open every connection up front. Otherwise the first requests of a burst wait for new
  // connections one by one and no longer arrive at the same time.
  const clients = await Promise.all(Array.from({ length: 30 }, () => pool.connect()));
  for (const client of clients) client.release();
});

afterEach(async () => {
  for (const slug of slugs.splice(0)) await deleteVenue(pool, slug);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

async function venueWith(slug: string, tables: TestTable[]) {
  slugs.push(slug);
  return createVenue(pool, slug, tables);
}

function book(slug: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/venues/${slug}/reservations`,
    payload: { guestName: "Test Guest", guestEmail: newGuestEmail(), ...body },
  });
}

const EIGHT_PM = "2030-06-01T20:00:00+02:00";

describe("POST /venues/:slug/reservations", () => {
  it("books the smallest table that fits and keeps it as long as the party size says", async () => {
    await venueWith("book-basic", [
      { label: "four", minSeats: 2, maxSeats: 4, x: 100 },
      { label: "two", minSeats: 1, maxSeats: 2, x: 400 },
    ]);
    const response = await book("book-basic", { startsAt: EIGHT_PM, partySize: 2 });

    expect(response.statusCode).toBe(201);
    const body = response.json<Created>();
    expect(body).toMatchObject({
      status: "pending",
      startsAt: "2030-06-01T18:00:00.000Z",
      // Parties of two keep the table for 90 minutes.
      endsAt: "2030-06-01T19:30:00.000Z",
      partySize: 2,
    });
    expect(body.tables.map((table) => table.label)).toEqual(["two"]);
  });

  it("pushes neighbouring tables together for a party no single table fits", async () => {
    await venueWith("book-joined", [
      { label: "A", x: 100 },
      { label: "B", x: 180 },
    ]);
    const response = await book("book-joined", { startsAt: EIGHT_PM, partySize: 4 });

    expect(response.statusCode).toBe(201);
    expect(
      response
        .json<Created>()
        .tables.map((table) => table.label)
        .sort(),
    ).toEqual(["A", "B"]);
  });

  it("moves on to the next table once one is taken, and says so when none is left", async () => {
    await venueWith("book-full", [
      { label: "1", x: 100 },
      { label: "2", x: 400 },
    ]);
    const labels: string[] = [];
    for (let i = 0; i < 2; i++) {
      const response = await book("book-full", { startsAt: EIGHT_PM, partySize: 2 });
      expect(response.statusCode).toBe(201);
      labels.push(...response.json<Created>().tables.map((table) => table.label));
    }
    expect(labels.sort()).toEqual(["1", "2"]);

    const full = await book("book-full", { startsAt: "2030-06-01T21:00:00+02:00", partySize: 2 });
    expect(full.statusCode).toBe(409);

    // Once the first booking has ended, the table is free again.
    const later = await book("book-full", { startsAt: "2030-06-01T21:30:00+02:00", partySize: 2 });
    expect(later.statusCode).toBe(201);
  });

  it("does not offer tables staff keep out of online booking", async () => {
    const { tableIds } = await venueWith("book-walk-in", [{ label: "1", x: 100 }]);
    await pool.query("update dining_tables set bookable = false where id = $1", [tableIds[0]]);
    const response = await book("book-walk-in", { startsAt: EIGHT_PM, partySize: 2 });
    expect(response.statusCode).toBe(409);
  });

  it("sends parties too big for the duration rules to the venue", async () => {
    await venueWith("book-huge", [{ label: "1", x: 100 }]);
    const response = await book("book-huge", { startsAt: EIGHT_PM, partySize: 40 });
    expect(response.statusCode).toBe(422);
  });

  it("rejects times in the past, unknown languages and guests with no contact", async () => {
    await venueWith("book-invalid", [{ label: "1", x: 100 }]);

    const past = await book("book-invalid", {
      startsAt: "2020-01-01T20:00:00+01:00",
      partySize: 2,
    });
    expect(past.statusCode).toBe(400);

    const language = await book("book-invalid", { startsAt: EIGHT_PM, partySize: 2, locale: "de" });
    expect(language.statusCode).toBe(400);

    const noContact = await app.inject({
      method: "POST",
      url: "/venues/book-invalid/reservations",
      payload: { guestName: "Test Guest", startsAt: EIGHT_PM, partySize: 2 },
    });
    expect(noContact.statusCode).toBe(400);

    const noOffset = await book("book-invalid", { startsAt: "2030-06-01T20:00:00", partySize: 2 });
    expect(noOffset.statusCode).toBe(400);

    // JavaScript would quietly turn 31 February into 3 March.
    const notADay = await book("book-invalid", {
      startsAt: "2030-02-31T20:00:00+01:00",
      partySize: 2,
    });
    expect(notADay.statusCode).toBe(400);

    const blankName = await book("book-invalid", {
      startsAt: EIGHT_PM,
      partySize: 2,
      guestName: "   ",
    });
    expect(blankName.statusCode).toBe(400);

    // PostgreSQL cannot store NUL in text, so it must be refused before it gets there.
    const nul = await book("book-invalid", {
      startsAt: EIGHT_PM,
      partySize: 2,
      notes: "window\u0000seat",
    });
    expect(nul.statusCode).toBe(400);
  });

  it("returns 404 for a venue that does not exist", async () => {
    const response = await book("nowhere", { startsAt: EIGHT_PM, partySize: 2 });
    expect(response.statusCode).toBe(404);
  });
});

describe("many bookings at once", { timeout: 20_000 }, () => {
  /**
   * Fires `count` requests and makes sure they really race. It counts lock waits across the
   * whole test database, which is safe because test files run one at a time
   * (`fileParallelism: false`). Writes to reservation_tables are
   * held back until every request has read the free tables and is waiting to write (on the
   * table itself or in the per-table queue); then they all go at once. Without the gate the
   * first request can finish before the last one starts.
   */
  async function allAtOnce<T>(count: number, start: () => Promise<T>): Promise<T[]> {
    const gate = await pool.connect();
    let pending: Promise<PromiseSettledResult<T>[]> | undefined;
    try {
      await gate.query("begin");
      await gate.query("lock table reservation_tables in share mode");
      pending = Promise.allSettled(Array.from({ length: count }, start));

      const deadline = Date.now() + 15_000;
      for (;;) {
        const { rows } = await gate.query<{ waiting: number }>(
          `select count(*)::int as waiting from pg_locks
            where not granted
              and (relation = 'reservation_tables'::regclass or locktype = 'advisory')`,
        );
        if ((rows[0]?.waiting ?? 0) >= count) break;
        if (Date.now() > deadline) throw new Error("Requests never queued up behind the gate");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      await gate.query("commit");
      gate.release();
    }

    const results = await pending;
    return results.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
  }

  it("gives a single table to exactly one of many simultaneous requests", async () => {
    await venueWith("rush-one", [{ label: "only", x: 100 }]);

    const responses = await allAtOnce(25, () =>
      book("rush-one", { startsAt: EIGHT_PM, partySize: 2 }),
    );
    const codes = responses.map((response) => response.statusCode);

    expect(codes.filter((code) => code === 201)).toHaveLength(1);
    expect(codes.filter((code) => code === 409)).toHaveLength(24);
  });

  it("fills every table once and never twice when requests outnumber tables", async () => {
    const { venueId } = await venueWith("rush-many", [
      { label: "1", x: 100 },
      { label: "2", x: 400 },
      { label: "3", x: 700 },
      { label: "4", x: 1000 },
    ]);

    const responses = await allAtOnce(20, () =>
      book("rush-many", { startsAt: EIGHT_PM, partySize: 2 }),
    );
    const won = responses.filter((response) => response.statusCode === 201);

    expect(won).toHaveLength(4);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(16);
    const labels = won.flatMap((response) => response.json<Created>().tables.map((t) => t.label));
    expect(labels.sort()).toEqual(["1", "2", "3", "4"]);

    // The losers left nothing behind.
    const { rows } = await pool.query<{ count: string }>(
      "select count(*) from reservations where venue_id = $1",
      [venueId],
    );
    expect(rows[0]?.count).toBe("4");
  });

  it("keeps trying while tables are free, however many rounds the race takes", async () => {
    await venueWith(
      "rush-big",
      Array.from({ length: 12 }, (_, i) => ({ label: String(i + 1), x: 100 + i * 150 })),
    );

    // Every request wants the same best table each round, so filling 12 tables takes 12 rounds.
    const responses = await allAtOnce(30, () =>
      book("rush-big", { startsAt: EIGHT_PM, partySize: 2 }),
    );

    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(12);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(18);
  });

  it("answers busy instead of waiting for ever behind a stuck booking", async () => {
    const { tableIds } = await venueWith("stuck", [{ label: "only", x: 100 }]);
    const holder = await pool.connect();
    try {
      // Another transaction holds the table's place in the queue and never finishes.
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtextextended('table:' || $1, 0))", [
        tableIds[0],
      ]);

      const response = await book("stuck", { startsAt: EIGHT_PM, partySize: 2 });
      expect(response.statusCode).toBe(503);
      expect(response.headers["retry-after"]).toBe("5");
    } finally {
      await holder.query("rollback");
      holder.release();
    }
  });

  it("never seats a joined group on a table another request just took", async () => {
    // Two tables side by side: parties of four want both, parties of two want one.
    await venueWith("rush-mixed", [
      { label: "A", x: 100 },
      { label: "B", x: 180 },
    ]);

    let request = 0;
    const responses = await allAtOnce(16, () =>
      book("rush-mixed", { startsAt: EIGHT_PM, partySize: request++ % 2 === 0 ? 4 : 2 }),
    );
    const taken = responses
      .filter((response) => response.statusCode === 201)
      .flatMap((response) => response.json<Created>().tables.map((table) => table.label));

    expect(taken.length).toBeGreaterThan(0);
    expect(new Set(taken).size).toBe(taken.length);
  });

  it("lets the database alone stop simultaneous writers that skip the API", async () => {
    const { venueId, tableIds } = await venueWith("rush-sql", [{ label: "only", x: 100 }]);

    // Without the API's queue, ties between writers are broken by PostgreSQL's deadlock check,
    // which waits a second each time. Ten writers are plenty to show that only one gets through.
    const attempts = Array.from({ length: 10 }, async () => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const { rows } = await client.query<{ id: string }>(
          `insert into reservations (venue_id, starts_at, ends_at, party_size, guest_name, guest_phone)
           values ($1, '2030-06-02T20:00:00+02:00', '2030-06-02T21:30:00+02:00', 2, 'Guest', '600000000')
           returning id`,
          [venueId],
        );
        await client.query(
          "insert into reservation_tables (reservation_id, table_id, venue_id) values ($1, $2, $3)",
          [rows[0]?.id, tableIds[0], venueId],
        );
        await client.query("commit");
        return "won";
      } catch (error) {
        await client.query("rollback");
        return (error as { code?: string }).code;
      } finally {
        client.release();
      }
    });
    const results = await Promise.all(attempts);

    expect(results.filter((result) => result === "won")).toHaveLength(1);
    // The others are refused: by the exclusion constraint, or as a deadlock when two of them
    // checked each other at the same instant. Either way nothing was double-booked.
    expect(results.filter((result) => result === "23P01" || result === "40P01")).toHaveLength(9);
  }, 30_000);

  it("books a double click only once", async () => {
    await venueWith(
      "rush-double-click",
      Array.from({ length: 10 }, (_, i) => ({ label: String(i + 1), x: 100 + i * 150 })),
    );

    // Ten copies of the same request: same guest, same time. There are tables for all of them.
    const responses = await allAtOnce(10, () =>
      book("rush-double-click", {
        startsAt: EIGHT_PM,
        partySize: 2,
        guestEmail: "double@example.com",
      }),
    );

    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(1);
    const refused = responses.filter((response) => response.statusCode === 409);
    expect(refused).toHaveLength(9);
    for (const response of refused) {
      expect(response.json<{ error: string }>().error).toMatch(/already have a booking/);
    }
  });
});

describe("limits on the public booking endpoint", () => {
  function setRules(slug: string, rules: Record<string, unknown>) {
    return app.inject({
      method: "PUT",
      url: `/venues/${slug}/booking-rules`,
      headers: { cookie },
      payload: { horizonDays: 60, weekly: [], specialDays: [], ...rules },
    });
  }

  it("takes bookings up to the venue's horizon, counted in its own days", async () => {
    await venueWith("guard-horizon", [{ label: "1", x: 100 }]);

    // "Now" is 2030-05-20 at 12:00 in Madrid. Sixty days ahead is 19 July.
    const lastDay = await book("guard-horizon", {
      startsAt: "2030-07-19T23:00:00+02:00",
      partySize: 2,
    });
    expect(lastDay.statusCode).toBe(201);
    const tooFar = await book("guard-horizon", {
      startsAt: "2030-07-20T13:00:00+02:00",
      partySize: 2,
    });
    expect(tooFar.statusCode).toBe(422);
    expect(tooFar.json<{ error: string }>().error).toMatch(/60 days ahead/);

    // Half past midnight in Madrid is still the evening before in UTC. Days count in Madrid.
    await setRules("guard-horizon", {
      horizonDays: 1,
      weekly: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday,
        firstArrival: "00:00",
        lastArrival: "23:59",
      })),
    });
    const lateApp = await buildApp({
      pool,
      ...TEST_APP_OPTIONS,
      now: () => new Date("2030-05-20T22:30:00Z"),
    });
    try {
      const tomorrow = await lateApp.inject({
        method: "POST",
        url: "/venues/guard-horizon/reservations",
        payload: {
          guestName: "Test Guest",
          guestEmail: newGuestEmail(),
          startsAt: "2030-05-22T20:00:00+02:00",
          partySize: 2,
        },
      });
      expect(tomorrow.statusCode).toBe(201);
    } finally {
      await lateApp.close();
    }
  });

  it("only takes arrivals inside the opening hours, in the venue's local time", async () => {
    await venueWith("guard-hours", [{ label: "1", x: 100 }]);
    const response = await setRules("guard-hours", {
      horizonDays: 365,
      weekly: [
        // Saturday lunch, and a Saturday dinner that runs past midnight.
        { weekday: 6, firstArrival: "13:00", lastArrival: "15:30" },
        { weekday: 6, firstArrival: "20:00", lastArrival: "00:30" },
        { weekday: 7, firstArrival: "20:00", lastArrival: "20:00" },
      ],
      specialDays: [{ date: "2030-06-08", windows: [] }],
    });
    expect(response.statusCode).toBe(204);

    const at = async (startsAt: string) =>
      (await book("guard-hours", { startsAt, partySize: 2 })).statusCode;

    // Saturday 1 June 2030.
    expect(await at("2030-06-01T13:00:00+02:00")).toBe(201);
    expect(await at("2030-06-01T17:00:00+02:00")).toBe(422);
    // Arrivals count to the minute.
    expect(await at("2030-06-01T15:30:45+02:00")).toBe(201);
    expect(await at("2030-06-01T15:31:00+02:00")).toBe(422);
    // Saturday's late window, after midnight on Sunday.
    expect(await at("2030-06-02T00:15:00+02:00")).toBe(201);
    expect(await at("2030-06-02T00:45:00+02:00")).toBe(422);
    // A Saturday listed as a special day with no windows is closed.
    expect(await at("2030-06-08T13:00:00+02:00")).toBe(422);
    // Monday has no windows.
    expect(await at("2030-06-03T13:00:00+02:00")).toBe(422);

    // 20:00 in Madrid is 18:00 UTC in summer and 19:00 UTC in winter. The window follows the
    // clock on the wall; summer time ends on 27 October 2030.
    expect(await at("2030-06-02T18:00:00Z")).toBe(201);
    expect(await at("2030-10-27T19:00:00Z")).toBe(201);
    expect(await at("2030-10-27T18:00:00Z")).toBe(422);
  });

  it("takes no bookings at a venue that has not set its hours", async () => {
    const { venueId } = await venueWith("guard-no-hours", [{ label: "1", x: 100 }]);
    await pool.query("delete from opening_hours where venue_id = $1", [venueId]);
    const response = await book("guard-no-hours", { startsAt: EIGHT_PM, partySize: 2 });
    expect(response.statusCode).toBe(422);
  });

  it("does not let the same guest book twice around the same time", async () => {
    const { venueId } = await venueWith(
      "guard-duplicate",
      Array.from({ length: 5 }, (_, i) => ({ label: String(i + 1), x: 100 + i * 150 })),
    );
    const guest = { partySize: 2, guestEmail: "Ana@Example.com", guestPhone: "+34 600 111 222" };

    const first = await book("guard-duplicate", { ...guest, startsAt: EIGHT_PM });
    expect(first.statusCode).toBe(201);

    // The same e-mail in other letters, at the same time.
    const sameEmail = await book("guard-duplicate", {
      startsAt: EIGHT_PM,
      partySize: 4,
      guestEmail: "ana@example.com",
    });
    expect(sameEmail.statusCode).toBe(409);

    // The same phone written another way, half an hour later: the bookings would overlap.
    const samePhone = await app.inject({
      method: "POST",
      url: "/venues/guard-duplicate/reservations",
      payload: {
        guestName: "Ana",
        guestPhone: "+34600111222",
        startsAt: "2030-06-01T20:30:00+02:00",
        partySize: 2,
      },
    });
    expect(samePhone.statusCode).toBe(409);

    // Once the first booking is over, the same guest can come back.
    const later = await book("guard-duplicate", {
      ...guest,
      startsAt: "2030-06-01T21:30:00+02:00",
    });
    expect(later.statusCode).toBe(201);

    // The same guest at another venue is fine.
    await venueWith("guard-duplicate-elsewhere", [{ label: "1", x: 100 }]);
    const elsewhere = await book("guard-duplicate-elsewhere", { ...guest, startsAt: EIGHT_PM });
    expect(elsewhere.statusCode).toBe(201);

    // Another guest at the first time is fine.
    const other = await book("guard-duplicate", { startsAt: EIGHT_PM, partySize: 2 });
    expect(other.statusCode).toBe(201);

    // A cancelled booking no longer counts.
    await pool.query(
      "update reservations set status = 'cancelled' where venue_id = $1 and starts_at = $2 and guest_email = $3",
      [venueId, EIGHT_PM, "Ana@Example.com"],
    );
    const again = await book("guard-duplicate", { ...guest, startsAt: EIGHT_PM });
    expect(again.statusCode).toBe(201);
  });

  it("refuses a phone number with fewer than six digits", async () => {
    await venueWith("guard-phone", [{ label: "1", x: 100 }]);
    const response = await app.inject({
      method: "POST",
      url: "/venues/guard-phone/reservations",
      payload: { guestName: "Ana", guestPhone: "(12) - 34", startsAt: EIGHT_PM, partySize: 2 },
    });
    expect(response.statusCode).toBe(400);
  });

  describe("requests per address", () => {
    let limited: FastifyInstance;

    beforeAll(async () => {
      limited = await buildApp({
        pool,
        ...TEST_APP_OPTIONS,
        bookingRateLimit: { max: 3, windowMs: 60_000 },
        trustProxy: "127.0.0.1",
      });
    });

    afterAll(async () => {
      await limited.close();
    });

    function bookFrom(remoteAddress: string, headers: Record<string, string> = {}) {
      return limited.inject({
        method: "POST",
        url: "/venues/does-not-exist/reservations",
        remoteAddress,
        headers,
        payload: {
          guestName: "Test Guest",
          guestEmail: newGuestEmail(),
          startsAt: EIGHT_PM,
          partySize: 2,
        },
      });
    }

    it("answers 429 once one address has used up its requests, and only to that address", async () => {
      for (let i = 0; i < 3; i++) {
        // Requests count even when they fail: here the venue does not exist.
        expect((await bookFrom("203.0.113.7")).statusCode).toBe(404);
      }
      const blocked = await bookFrom("203.0.113.7");
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers["retry-after"]).toBeDefined();
      expect(blocked.json<{ error: string }>().error).toMatch(/Too many requests/);

      expect((await bookFrom("203.0.113.8")).statusCode).toBe(404);

      // Reading the floor plan is not limited.
      const plan = await limited.inject({
        method: "GET",
        url: "/venues/sample-bistro/floor-plan",
        remoteAddress: "203.0.113.7",
      });
      expect(plan.statusCode).toBe(200);
    });

    it("counts a whole IPv6 /64 as one address", async () => {
      for (let i = 1; i <= 3; i++) await bookFrom(`2001:db8:1:2::${String(i)}`);
      expect((await bookFrom("2001:db8:1:2:ffff::9")).statusCode).toBe(429);
      expect((await bookFrom("2001:db8:1:3::1")).statusCode).toBe(404);
    });

    it("believes X-Forwarded-For only from the trusted proxy", async () => {
      // Through the trusted proxy: each guest address gets its own count.
      for (let i = 0; i < 3; i++) {
        await bookFrom("127.0.0.1", { "x-forwarded-for": "198.51.100.1" });
      }
      const viaProxy = await bookFrom("127.0.0.1", { "x-forwarded-for": "198.51.100.1" });
      expect(viaProxy.statusCode).toBe(429);
      const otherGuest = await bookFrom("127.0.0.1", { "x-forwarded-for": "198.51.100.2" });
      expect(otherGuest.statusCode).toBe(404);

      // From anywhere else the header is ignored, so making up addresses does not help.
      for (let i = 0; i < 3; i++) {
        await bookFrom("192.0.2.50", { "x-forwarded-for": `198.51.100.${String(10 + i)}` });
      }
      const madeUp = await bookFrom("192.0.2.50", { "x-forwarded-for": "198.51.100.99" });
      expect(madeUp.statusCode).toBe(429);
    });
  });
});
