import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { createVenue, deleteVenue, testDatabaseUrl, type TestTable } from "./helpers.js";

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
const slugs: string[] = [];

beforeAll(async () => {
  app = await buildApp({ pool });
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
    payload: { guestName: "Test Guest", guestEmail: "guest@example.com", ...body },
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
  });

  it("returns 404 for a venue that does not exist", async () => {
    const response = await book("nowhere", { startsAt: EIGHT_PM, partySize: 2 });
    expect(response.statusCode).toBe(404);
  });
});

describe("many bookings at once", { timeout: 20_000 }, () => {
  /**
   * Fires `count` requests and makes sure they really race. Writes to reservation_tables are
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
});
