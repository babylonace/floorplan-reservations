import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db.js";
import { SAMPLE_TABLE_ID, SAMPLE_VENUE_ID, SAMPLE_ZONE_ID, testDatabaseUrl } from "./helpers.js";

// PostgreSQL error codes.
const CHECK_VIOLATION = "23514";
const EXCLUSION_VIOLATION = "23P01";
const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

const pool = createPool(testDatabaseUrl());
let client: PoolClient;

// Every test runs inside a transaction that is rolled back, so tests never see each other's rows.
beforeEach(async () => {
  client = await pool.connect();
  await client.query("begin");
});

afterEach(async () => {
  await client.query("rollback");
  client.release();
});

afterAll(async () => {
  await pool.end();
});

function insertTable(values: { label: string; minSeats: number; maxSeats: number }) {
  return client.query(
    `insert into dining_tables (venue_id, zone_id, label, min_seats, max_seats, x, y, width, height)
     values ($1, $2, $3, $4, $5, 600, 600, 80, 80)`,
    [SAMPLE_VENUE_ID, SAMPLE_ZONE_ID, values.label, values.minSeats, values.maxSeats],
  );
}

function insertReservation(values: {
  startsAt: string;
  endsAt: string;
  email?: string | null;
  phone?: string | null;
}) {
  return client.query<{ id: string }>(
    `insert into reservations (venue_id, starts_at, ends_at, party_size, guest_name, guest_email, guest_phone)
     values ($1, $2, $3, 2, 'Test Guest', $4, $5)
     returning id`,
    [SAMPLE_VENUE_ID, values.startsAt, values.endsAt, values.email ?? null, values.phone ?? null],
  );
}

function bookSampleTable(reservationId: string | undefined, venueId: string = SAMPLE_VENUE_ID) {
  return client.query(
    "insert into reservation_tables (reservation_id, table_id, venue_id) values ($1, $2, $3)",
    [reservationId, SAMPLE_TABLE_ID, venueId],
  );
}

async function insertOtherVenue(): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into venues (slug, name, time_zone) values ('other-venue', 'Other', 'Europe/Madrid')
     returning id`,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Venue was not created");
  return id;
}

describe("venues", () => {
  it("rejects slugs that would make ugly or ambiguous URLs", async () => {
    await expect(
      client.query(
        "insert into venues (slug, name, time_zone) values ('Not A Slug', 'X', 'Europe/Madrid')",
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it("requires the staff language to be one of the venue's languages", async () => {
    await expect(
      client.query(
        `insert into venues (slug, name, time_zone, default_locale, locales)
         values ('other', 'Other', 'Europe/Madrid', 'de', array['es', 'en'])`,
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });
});

describe("dining tables", () => {
  it("accepts a valid table", async () => {
    await expect(insertTable({ label: "new", minSeats: 2, maxSeats: 4 })).resolves.toBeDefined();
  });

  it("rejects more minimum seats than maximum seats", async () => {
    await expect(insertTable({ label: "bad", minSeats: 4, maxSeats: 2 })).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    });
  });

  it("rejects two tables with the same label in one zone", async () => {
    await expect(insertTable({ label: "1", minSeats: 1, maxSeats: 2 })).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
    });
  });

  it("only stores style as a JSON object", async () => {
    await expect(
      client.query("update dining_tables set style = '[1, 2]' where id = $1", [SAMPLE_TABLE_ID]),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });
});

describe("reservations", () => {
  it("accepts a reservation with a way to reach the guest", async () => {
    await expect(
      insertReservation({
        startsAt: "2030-05-01T20:00:00+02:00",
        endsAt: "2030-05-01T21:30:00+02:00",
        phone: "+34 600 000 000",
      }),
    ).resolves.toBeDefined();
  });

  it("rejects a reservation that ends before it starts", async () => {
    await expect(
      insertReservation({
        startsAt: "2030-05-01T20:00:00+02:00",
        endsAt: "2030-05-01T20:00:00+02:00",
        email: "guest@example.com",
      }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it("rejects a reservation with no email and no phone", async () => {
    await expect(
      insertReservation({
        startsAt: "2030-05-01T20:00:00+02:00",
        endsAt: "2030-05-01T21:30:00+02:00",
      }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it("will not let a booked table be deleted", async () => {
    const { rows } = await insertReservation({
      startsAt: "2030-05-01T20:00:00+02:00",
      endsAt: "2030-05-01T21:30:00+02:00",
      email: "guest@example.com",
    });
    await bookSampleTable(rows[0]?.id);

    await expect(
      client.query("delete from dining_tables where id = $1", [SAMPLE_TABLE_ID]),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });

  it("cannot take a table that belongs to another venue", async () => {
    const otherVenueId = await insertOtherVenue();
    const { rows } = await client.query<{ id: string }>(
      `insert into reservations (venue_id, starts_at, ends_at, party_size, guest_name, guest_email)
       values ($1, '2030-05-01T20:00:00+02:00', '2030-05-01T21:30:00+02:00', 2, 'Guest', 'guest@example.com')
       returning id`,
      [otherVenueId],
    );

    // Claiming the sample venue does not help: the reservation belongs to the other one.
    await expect(bookSampleTable(rows[0]?.id)).rejects.toMatchObject({
      code: FOREIGN_KEY_VIOLATION,
    });
  });

  it("cannot put a table in a zone of another venue", async () => {
    const otherVenueId = await insertOtherVenue();
    await expect(
      client.query(
        `insert into dining_tables (venue_id, zone_id, label, min_seats, max_seats, x, y, width, height)
         values ($1, $2, 'x', 1, 2, 100, 100, 80, 80)`,
        [otherVenueId, SAMPLE_ZONE_ID],
      ),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });

  it("lets a whole venue be deleted even when it has bookings", async () => {
    const { rows } = await insertReservation({
      startsAt: "2030-05-01T20:00:00+02:00",
      endsAt: "2030-05-01T21:30:00+02:00",
      email: "guest@example.com",
    });
    await bookSampleTable(rows[0]?.id);

    await client.query("delete from venues where id = $1", [SAMPLE_VENUE_ID]);
    const left = await client.query("select 1 from dining_tables where venue_id = $1", [
      SAMPLE_VENUE_ID,
    ]);
    expect(left.rowCount).toBe(0);
  });

  it("updates updated_at on every change", async () => {
    const { rows } = await insertReservation({
      startsAt: "2030-05-01T20:00:00+02:00",
      endsAt: "2030-05-01T21:30:00+02:00",
      email: "guest@example.com",
    });
    // now() is fixed inside a transaction, so move created_at back to see the change.
    await client.query(
      "update reservations set created_at = created_at - interval '1 hour', updated_at = updated_at - interval '1 hour' where id = $1",
      [rows[0]?.id],
    );
    await client.query("update reservations set status = 'confirmed' where id = $1", [rows[0]?.id]);
    const after = await client.query<{ changed: boolean }>(
      "select updated_at > created_at as changed from reservations where id = $1",
      [rows[0]?.id],
    );
    expect(after.rows[0]?.changed).toBe(true);
  });
});

describe("double booking", () => {
  async function bookedAt(startsAt: string, endsAt: string): Promise<string> {
    const { rows } = await insertReservation({ startsAt, endsAt, email: "guest@example.com" });
    const id = rows[0]?.id;
    if (!id) throw new Error("Reservation was not created");
    await bookSampleTable(id);
    return id;
  }

  it("rejects a second booking of the same table at an overlapping time", async () => {
    await bookedAt("2030-05-01T20:00:00+02:00", "2030-05-01T21:30:00+02:00");
    await expect(
      bookedAt("2030-05-01T21:00:00+02:00", "2030-05-01T22:30:00+02:00"),
    ).rejects.toMatchObject({ code: EXCLUSION_VIOLATION });
  });

  it("allows one booking to start exactly when the previous one ends", async () => {
    await bookedAt("2030-05-01T20:00:00+02:00", "2030-05-01T21:30:00+02:00");
    await expect(
      bookedAt("2030-05-01T21:30:00+02:00", "2030-05-01T23:00:00+02:00"),
    ).resolves.toBeDefined();
  });

  it("frees the table when a booking is cancelled or marked as a no-show", async () => {
    for (const status of ["cancelled", "no_show"]) {
      const id = await bookedAt("2030-05-02T20:00:00+02:00", "2030-05-02T21:30:00+02:00");
      await client.query("update reservations set status = $1 where id = $2", [status, id]);
    }
    await expect(
      bookedAt("2030-05-02T20:00:00+02:00", "2030-05-02T21:30:00+02:00"),
    ).resolves.toBeDefined();
  });

  it("will not bring back a cancelled booking whose table was given away", async () => {
    const first = await bookedAt("2030-05-03T20:00:00+02:00", "2030-05-03T21:30:00+02:00");
    await client.query("update reservations set status = 'cancelled' where id = $1", [first]);
    await bookedAt("2030-05-03T20:00:00+02:00", "2030-05-03T21:30:00+02:00");

    await expect(
      client.query("update reservations set status = 'confirmed' where id = $1", [first]),
    ).rejects.toMatchObject({ code: EXCLUSION_VIOLATION });
  });

  it("will not move a booking onto a time its table is already taken", async () => {
    await bookedAt("2030-05-04T20:00:00+02:00", "2030-05-04T21:30:00+02:00");
    const later = await bookedAt("2030-05-04T22:00:00+02:00", "2030-05-04T23:30:00+02:00");

    await expect(
      client.query(
        "update reservations set starts_at = '2030-05-04T21:00:00+02:00' where id = $1",
        [later],
      ),
    ).rejects.toMatchObject({ code: EXCLUSION_VIOLATION });
  });

  it("keeps the table's copy of the booking time in step with the booking", async () => {
    const id = await bookedAt("2030-05-05T20:00:00+02:00", "2030-05-05T21:30:00+02:00");
    await client.query(
      "update reservations set ends_at = '2030-05-05T22:00:00+02:00', status = 'cancelled' where id = $1",
      [id],
    );
    const { rows } = await client.query<{ same: boolean }>(
      `select rt.during = r.during and rt.holds_tables = r.holds_tables and not rt.holds_tables as same
         from reservation_tables rt join reservations r on r.id = rt.reservation_id
        where r.id = $1`,
      [id],
    );
    expect(rows).toEqual([{ same: true }]);
  });

  it("refuses a hand-written copy that does not match the booking", async () => {
    const { rows } = await insertReservation({
      startsAt: "2030-05-06T20:00:00+02:00",
      endsAt: "2030-05-06T21:30:00+02:00",
      email: "guest@example.com",
    });
    await bookSampleTable(rows[0]?.id);
    await expect(
      client.query("update reservation_tables set holds_tables = false where reservation_id = $1", [
        rows[0]?.id,
      ]),
    ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION });
  });
});
