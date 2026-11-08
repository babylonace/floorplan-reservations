import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { createVenue, deleteVenue, testDatabaseUrl, type TestTable } from "./helpers.js";

interface ApiTable {
  id: string;
  zoneId: string;
  label: string;
  minSeats: number;
  maxSeats: number;
  shape: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  style: Record<string, unknown>;
  bookable: boolean;
}

interface ApiZone {
  id: string;
  name: string;
  sortOrder: number;
  width: number;
  height: number;
}

interface Refusal {
  error: string;
  issues?: { code: string; tableId: string; otherTableId?: string }[];
}

interface FloorPlan {
  zones: (ApiZone & { tables: ApiTable[] })[];
}

const pool = createPool(testDatabaseUrl(), { max: 20 });
let app: FastifyInstance;
const slugs: string[] = [];

beforeAll(async () => {
  app = await buildApp({ pool });
});

afterEach(async () => {
  for (const slug of slugs.splice(0)) await deleteVenue(pool, slug);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

/** A venue with one 2000 × 1000 cm zone called "Room" and the given 80 × 80 cm tables. */
async function venueWith(slug: string, tables: TestTable[] = []) {
  slugs.push(slug);
  const venue = await createVenue(pool, slug, tables);
  const zone = await pool.query<{ id: string }>("select id from zones where venue_id = $1", [
    venue.venueId,
  ]);
  const zoneId = zone.rows[0]?.id;
  if (!zoneId) throw new Error("Zone was not created");
  return { ...venue, zoneId };
}

function call(method: "POST" | "PATCH" | "DELETE" | "GET", url: string, payload?: object) {
  return app.inject({ method, url, ...(payload ? { payload } : {}) });
}

async function floorPlan(slug: string): Promise<FloorPlan> {
  const response = await call("GET", `/venues/${slug}/floor-plan`);
  expect(response.statusCode).toBe(200);
  return response.json<FloorPlan>();
}

function book(slug: string, partySize: number, startsAt = "2030-06-01T20:00:00+02:00") {
  return call("POST", `/venues/${slug}/reservations`, {
    startsAt,
    partySize,
    guestName: "Test Guest",
    guestEmail: "guest@example.com",
  });
}

/** A finished booking from last year at these tables, written straight to the database. */
async function pastBooking(venueId: string, tableIds: string[], partySize = 2): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into reservations (venue_id, starts_at, ends_at, party_size, status, guest_name, guest_email)
     values ($1, now() - interval '1 year', now() - interval '1 year' + interval '90 minutes', $2,
             'completed', 'Past Guest', 'past@example.com')
     returning id`,
    [venueId, partySize],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("Past booking was not created");
  await pool.query(
    `insert into reservation_tables (reservation_id, table_id, venue_id)
     select $1, table_id, $3 from unnest($2::uuid[]) as table_id`,
    [id, tableIds, venueId],
  );
  return id;
}

const TABLE = { label: "N", minSeats: 1, maxSeats: 4, x: 1000, y: 500, width: 100, height: 100 };

describe("zones", () => {
  it("creates a zone that then shows up in the floor plan", async () => {
    await venueWith("zone-create");
    const response = await call("POST", "/venues/zone-create/zones", {
      name: "  Terrace ",
      width: 900,
      height: 400,
      sortOrder: 5,
    });

    expect(response.statusCode).toBe(201);
    const zone = response.json<ApiZone>();
    expect(zone).toMatchObject({ name: "Terrace", width: 900, height: 400, sortOrder: 5 });
    const plan = await floorPlan("zone-create");
    expect(plan.zones.map((z) => z.name)).toEqual(["Room", "Terrace"]);
  });

  it("refuses a duplicate name, a blank name, bad sizes and unknown venues", async () => {
    await venueWith("zone-bad");
    const duplicate = await call("POST", "/venues/zone-bad/zones", {
      name: "Room",
      width: 10,
      height: 10,
    });
    expect(duplicate.statusCode).toBe(409);

    const blank = await call("POST", "/venues/zone-bad/zones", {
      name: "   ",
      width: 10,
      height: 10,
    });
    expect(blank.statusCode).toBe(400);

    for (const payload of [
      { name: "A", width: 0, height: 10 },
      { name: "A", width: 10, height: 1_000_000 },
      { name: "A\u0000", width: 10, height: 10 },
    ]) {
      const response = await call("POST", "/venues/zone-bad/zones", payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }

    const noVenue = await call("POST", "/venues/no-such-venue/zones", {
      name: "A",
      width: 10,
      height: 10,
    });
    expect(noVenue.statusCode).toBe(404);
  });

  it("renames, reorders and resizes a zone", async () => {
    const { zoneId } = await venueWith("zone-edit", [{ label: "A", x: 100 }]);
    const response = await call("PATCH", `/venues/zone-edit/zones/${zoneId}`, {
      name: "Main room",
      sortOrder: 2,
      width: 1500,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<ApiZone>()).toMatchObject({
      id: zoneId,
      name: "Main room",
      sortOrder: 2,
      width: 1500,
      height: 1000,
    });
  });

  it("refuses to shrink a zone so that a table ends up outside", async () => {
    const { zoneId, tableIds } = await venueWith("zone-shrink", [{ label: "A", x: 1500 }]);
    const response = await call("PATCH", `/venues/zone-shrink/zones/${zoneId}`, { width: 1000 });

    expect(response.statusCode).toBe(422);
    expect(response.json<Refusal>().issues).toEqual([
      { code: "outside_zone", tableId: tableIds[0] },
    ]);
    const plan = await floorPlan("zone-shrink");
    expect(plan.zones[0]?.width).toBe(2000);
  });

  it("does not let one venue edit another venue's zone", async () => {
    const { zoneId } = await venueWith("zone-owner");
    await venueWith("zone-intruder");
    const patch = await call("PATCH", `/venues/zone-intruder/zones/${zoneId}`, { name: "Mine" });
    expect(patch.statusCode).toBe(404);
    const remove = await call("DELETE", `/venues/zone-intruder/zones/${zoneId}`);
    expect(remove.statusCode).toBe(404);
    const addTable = await call("POST", `/venues/zone-intruder/zones/${zoneId}/tables`, TABLE);
    expect(addTable.statusCode).toBe(404);
  });

  it("deletes a zone whose tables were never booked", async () => {
    const { zoneId, venueId } = await venueWith("zone-delete", [{ label: "A", x: 100 }]);
    const response = await call("DELETE", `/venues/zone-delete/zones/${zoneId}`);

    expect(response.statusCode).toBe(204);
    const left = await pool.query("select 1 from dining_tables where venue_id = $1", [venueId]);
    expect(left.rowCount).toBe(0);
    expect((await floorPlan("zone-delete")).zones).toEqual([]);
  });

  it("refuses to delete a zone while one of its tables has an upcoming reservation", async () => {
    const { zoneId } = await venueWith("zone-booked", [{ label: "A", x: 100 }]);
    expect((await book("zone-booked", 2)).statusCode).toBe(201);

    const response = await call("DELETE", `/venues/zone-booked/zones/${zoneId}`);
    expect(response.statusCode).toBe(409);
    expect((await floorPlan("zone-booked")).zones).toHaveLength(1);
  });

  it("retires a zone with past bookings so the history keeps its tables", async () => {
    const { zoneId, venueId, tableIds } = await venueWith("zone-history", [
      { label: "A", x: 100 },
      { label: "B", x: 400 },
    ]);
    const past = await pastBooking(venueId, [tableIds[0] ?? ""]);

    const response = await call("DELETE", `/venues/zone-history/zones/${zoneId}`);
    expect(response.statusCode).toBe(204);
    expect((await floorPlan("zone-history")).zones).toEqual([]);

    // The booked table is kept (retired) with its booking; the other one is gone.
    const kept = await pool.query<{ label: string; bookable: boolean }>(
      "select label, bookable from dining_tables where venue_id = $1 and retired_at is not null",
      [venueId],
    );
    expect(kept.rows).toEqual([{ label: "A", bookable: false }]);
    const history = await pool.query("select 1 from reservation_tables where reservation_id = $1", [
      past,
    ]);
    expect(history.rowCount).toBe(1);

    // The name is free again for a new zone.
    const again = await call("POST", "/venues/zone-history/zones", {
      name: "Room",
      width: 500,
      height: 500,
    });
    expect(again.statusCode).toBe(201);
  });
});

describe("tables", () => {
  it("adds a table with sensible defaults", async () => {
    const { zoneId } = await venueWith("table-create");
    const response = await call("POST", `/venues/table-create/zones/${zoneId}/tables`, TABLE);

    expect(response.statusCode).toBe(201);
    expect(response.json<ApiTable>()).toMatchObject({
      zoneId,
      label: "N",
      shape: "rect",
      rotation: 0,
      style: {},
      bookable: true,
    });
    const plan = await floorPlan("table-create");
    expect(plan.zones[0]?.tables.map((t) => t.label)).toEqual(["N"]);
  });

  it("stores shape, rotation, style and bookable as sent", async () => {
    const { zoneId } = await venueWith("table-style");
    const response = await call("POST", `/venues/table-style/zones/${zoneId}/tables`, {
      ...TABLE,
      shape: "round",
      rotation: 45,
      style: { color: "#c9a46b", border: { width: 2 } },
      bookable: false,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<ApiTable>()).toMatchObject({
      shape: "round",
      rotation: 45,
      style: { color: "#c9a46b", border: { width: 2 } },
      bookable: false,
    });
  });

  it("refuses a table that overlaps another, sticks out or has impossible seats", async () => {
    const { zoneId, tableIds } = await venueWith("table-invalid", [{ label: "A", x: 100 }]);
    const url = `/venues/table-invalid/zones/${zoneId}/tables`;

    const overlap = await call("POST", url, { ...TABLE, x: 120, y: 100 });
    expect(overlap.statusCode).toBe(422);
    expect(overlap.json<Refusal>().issues).toEqual([
      { code: "overlap", tableId: tableIds[0], otherTableId: "new" },
    ]);

    const outside = await call("POST", url, { ...TABLE, x: 1990 });
    expect(outside.statusCode).toBe(422);
    expect(outside.json<Refusal>().issues).toEqual([{ code: "outside_zone", tableId: "new" }]);

    const seats = await call("POST", url, { ...TABLE, minSeats: 6, maxSeats: 4 });
    expect(seats.statusCode).toBe(422);
    expect(seats.json<Refusal>().issues).toEqual([{ code: "seats_invalid", tableId: "new" }]);

    expect((await floorPlan("table-invalid")).zones[0]?.tables).toHaveLength(1);
  });

  it("refuses a duplicate label, a blank label, oversized styles and bad fields", async () => {
    const { zoneId } = await venueWith("table-bad", [{ label: "A", x: 100 }]);
    const url = `/venues/table-bad/zones/${zoneId}/tables`;

    expect((await call("POST", url, { ...TABLE, label: "A" })).statusCode).toBe(409);
    expect((await call("POST", url, { ...TABLE, label: " " })).statusCode).toBe(400);
    expect(
      (await call("POST", url, { ...TABLE, style: { note: "x".repeat(3000) } })).statusCode,
    ).toBe(400);
    expect((await call("POST", url, { ...TABLE, style: { note: "a\u0000b" } })).statusCode).toBe(
      400,
    );
    for (const field of [
      { rotation: 360 },
      { shape: "triangle" },
      { width: 0 },
      { maxSeats: 101 },
      { x: 1.5 },
      { style: "red" },
    ]) {
      const response = await call("POST", url, { ...TABLE, ...field });
      expect(response.statusCode, JSON.stringify(field)).toBe(400);
    }
  });

  it("moves, turns, restyles and resizes a table", async () => {
    const { tableIds } = await venueWith("table-edit", [{ label: "A", x: 100 }]);
    const response = await call("PATCH", `/venues/table-edit/tables/${tableIds[0]}`, {
      x: 600,
      y: 300,
      rotation: 90,
      width: 120,
      maxSeats: 4,
      style: { color: "blue" },
      label: "A1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<ApiTable>()).toMatchObject({
      label: "A1",
      x: 600,
      y: 300,
      rotation: 90,
      width: 120,
      height: 80,
      maxSeats: 4,
      style: { color: "blue" },
    });
  });

  it("refuses to move a table on top of another one", async () => {
    const { tableIds } = await venueWith("table-move-overlap", [
      { label: "A", x: 100 },
      { label: "B", x: 400 },
    ]);
    const response = await call("PATCH", `/venues/table-move-overlap/tables/${tableIds[1]}`, {
      x: 130,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<Refusal>().issues?.[0]?.code).toBe("overlap");
  });

  it("does not block edits because of problems the plan already had", async () => {
    const { tableIds, venueId } = await venueWith("table-old-issue", [
      { label: "A", x: 100 },
      { label: "B", x: 400 },
    ]);
    // An overlap written straight to the database, as an older plan might have.
    await pool.query("update dining_tables set x = 120 where venue_id = $1 and label = 'B'", [
      venueId,
    ]);

    const response = await call("PATCH", `/venues/table-old-issue/tables/${tableIds[0]}`, {
      style: { color: "red" },
    });
    expect(response.statusCode).toBe(200);
  });

  it("moves a table to another zone and checks it fits there", async () => {
    const { tableIds } = await venueWith("table-zone", [{ label: "A", x: 100 }]);
    const terrace = await call("POST", "/venues/table-zone/zones", {
      name: "Terrace",
      width: 300,
      height: 300,
    });
    const terraceId = terrace.json<ApiZone>().id;

    const tooFar = await call("PATCH", `/venues/table-zone/tables/${tableIds[0]}`, {
      zoneId: terraceId,
      x: 500,
    });
    expect(tooFar.statusCode).toBe(422);

    const moved = await call("PATCH", `/venues/table-zone/tables/${tableIds[0]}`, {
      zoneId: terraceId,
      x: 150,
      y: 150,
    });
    expect(moved.statusCode).toBe(200);
    const plan = await floorPlan("table-zone");
    expect(plan.zones.map((z) => [z.name, z.tables.map((t) => t.label)])).toEqual([
      ["Room", []],
      ["Terrace", ["A"]],
    ]);
  });

  it("refuses unknown tables, other venues' tables and other venues' zones", async () => {
    const owner = await venueWith("table-owner", [{ label: "A", x: 100 }]);
    const intruder = await venueWith("table-intruder", [{ label: "Z", x: 100 }]);

    const patch = await call("PATCH", `/venues/table-intruder/tables/${owner.tableIds[0]}`, {
      x: 300,
    });
    expect(patch.statusCode).toBe(404);
    const remove = await call("DELETE", `/venues/table-intruder/tables/${owner.tableIds[0]}`);
    expect(remove.statusCode).toBe(404);
    const steal = await call("PATCH", `/venues/table-intruder/tables/${intruder.tableIds[0]}`, {
      zoneId: owner.zoneId,
    });
    expect(steal.statusCode).toBe(404);
    const unknown = await call(
      "PATCH",
      "/venues/table-owner/tables/00000000-0000-4000-8000-00000000dead",
      { x: 300 },
    );
    expect(unknown.statusCode).toBe(404);
    const notUuid = await call("PATCH", "/venues/table-owner/tables/abc", { x: 300 });
    expect(notUuid.statusCode).toBe(400);
    const empty = await call("PATCH", `/venues/table-owner/tables/${owner.tableIds[0]}`, {});
    expect(empty.statusCode).toBe(400);
  });

  it("deletes a table that was never booked", async () => {
    const { tableIds, venueId } = await venueWith("table-delete", [{ label: "A", x: 100 }]);
    const response = await call("DELETE", `/venues/table-delete/tables/${tableIds[0]}`);

    expect(response.statusCode).toBe(204);
    const left = await pool.query("select 1 from dining_tables where venue_id = $1", [venueId]);
    expect(left.rowCount).toBe(0);
  });

  it("retires a table booked in the past: it leaves the plan and the engine, history stays", async () => {
    const { tableIds, venueId, zoneId } = await venueWith("table-retire", [{ label: "A", x: 100 }]);
    const past = await pastBooking(venueId, [tableIds[0] ?? ""]);

    const response = await call("DELETE", `/venues/table-retire/tables/${tableIds[0]}`);
    expect(response.statusCode).toBe(204);
    expect((await floorPlan("table-retire")).zones[0]?.tables).toEqual([]);

    const history = await pool.query<{ table_id: string }>(
      "select table_id from reservation_tables where reservation_id = $1",
      [past],
    );
    expect(history.rows).toEqual([{ table_id: tableIds[0] }]);
    expect((await book("table-retire", 2)).statusCode).toBe(409);

    // A second delete finds nothing; the label can be used for a new table.
    expect((await call("DELETE", `/venues/table-retire/tables/${tableIds[0]}`)).statusCode).toBe(
      404,
    );
    const again = await call("POST", `/venues/table-retire/zones/${zoneId}/tables`, {
      ...TABLE,
      label: "A",
    });
    expect(again.statusCode).toBe(201);
  });
});

describe("plan edits never break upcoming reservations", () => {
  it("refuses to delete a table with an upcoming reservation", async () => {
    const { tableIds } = await venueWith("keep-delete", [{ label: "A", x: 100 }]);
    expect((await book("keep-delete", 2)).statusCode).toBe(201);

    const response = await call("DELETE", `/venues/keep-delete/tables/${tableIds[0]}`);
    expect(response.statusCode).toBe(409);
    expect(response.json<Refusal>().error).toMatch(/not bookable/);
  });

  it("lets staff mark a booked table as not bookable: the booking stays, new ones go elsewhere", async () => {
    const { tableIds } = await venueWith("keep-unbookable", [
      { label: "A", x: 100 },
      { label: "B", x: 400 },
    ]);
    const first = await book("keep-unbookable", 2);
    const booked = first.json<{ id: string; tables: { id: string }[] }>();
    const bookedTable = booked.tables[0]?.id;
    const otherTable = tableIds.find((id) => id !== bookedTable);

    const response = await call("PATCH", `/venues/keep-unbookable/tables/${bookedTable}`, {
      bookable: false,
    });
    expect(response.statusCode).toBe(200);

    const still = await pool.query("select 1 from reservation_tables where reservation_id = $1", [
      booked.id,
    ]);
    expect(still.rowCount).toBe(1);
    const next = await book("keep-unbookable", 2, "2030-06-02T20:00:00+02:00");
    expect(next.json<{ tables: { id: string }[] }>().tables[0]?.id).toBe(otherTable);
  });

  it("refuses to take seats away from a table an upcoming party needs", async () => {
    const { tableIds } = await venueWith("keep-seats", [
      { label: "A", minSeats: 1, maxSeats: 4, x: 100 },
    ]);
    expect((await book("keep-seats", 4)).statusCode).toBe(201);

    const fewer = await call("PATCH", `/venues/keep-seats/tables/${tableIds[0]}`, {
      maxSeats: 2,
      minSeats: 1,
    });
    expect(fewer.statusCode).toBe(409);

    // Moving it, or raising the minimum, leaves the party with room, so it is allowed.
    const moved = await call("PATCH", `/venues/keep-seats/tables/${tableIds[0]}`, {
      x: 900,
      minSeats: 3,
    });
    expect(moved.statusCode).toBe(200);
  });

  it("allows any change once the only bookings are in the past", async () => {
    const { tableIds, venueId } = await venueWith("keep-past", [
      { label: "A", minSeats: 1, maxSeats: 4, x: 100 },
    ]);
    await pastBooking(venueId, [tableIds[0] ?? ""], 4);

    const response = await call("PATCH", `/venues/keep-past/tables/${tableIds[0]}`, {
      maxSeats: 2,
    });
    expect(response.statusCode).toBe(200);
  });

  it("ignores cancelled bookings", async () => {
    const { tableIds } = await venueWith("keep-cancelled", [{ label: "A", x: 100 }]);
    const booked = (await book("keep-cancelled", 2)).json<{ id: string }>();
    await pool.query("update reservations set status = 'cancelled' where id = $1", [booked.id]);

    const response = await call("DELETE", `/venues/keep-cancelled/tables/${tableIds[0]}`);
    expect(response.statusCode).toBe(204);
  });

  it("refuses to pull joined tables apart, make one round or move one to another zone", async () => {
    const { tableIds } = await venueWith("keep-joined", [
      { label: "A", x: 100 },
      { label: "B", x: 180 },
    ]);
    const booked = await book("keep-joined", 4);
    expect(booked.json<{ tables: unknown[] }>().tables).toHaveLength(2);
    const terrace = await call("POST", "/venues/keep-joined/zones", {
      name: "Terrace",
      width: 500,
      height: 500,
    });

    for (const change of [{ x: 600 }, { shape: "round" }, { zoneId: terrace.json<ApiZone>().id }]) {
      const response = await call("PATCH", `/venues/keep-joined/tables/${tableIds[1]}`, change);
      expect(response.statusCode, JSON.stringify(change)).toBe(409);
    }

    // Restyling or nudging it along the shared edge keeps them together.
    const nudge = await call("PATCH", `/venues/keep-joined/tables/${tableIds[1]}`, {
      y: 120,
      style: { color: "green" },
    });
    expect(nudge.statusCode).toBe(200);
  });
});

describe("plan edits and bookings at the same moment", () => {
  /** Waits until some connection is stuck waiting for a lock. */
  async function waitForLockWait(): Promise<void> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const { rows } = await pool.query<{ waiting: number }>(
        "select count(*)::int as waiting from pg_locks where not granted",
      );
      if ((rows[0]?.waiting ?? 0) > 0) return;
      if (Date.now() > deadline) throw new Error("Nothing ever waited for the lock");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it("a booking that waited for a seat change checks the plan again", async () => {
    const { tableIds } = await venueWith("race-edit-first", [
      { label: "A", minSeats: 1, maxSeats: 4, x: 100 },
    ]);
    // An edit in progress: it has locked the table and lowered its seats, not yet committed.
    const editor = await pool.connect();
    try {
      await editor.query("begin");
      await editor.query("select 1 from dining_tables where id = $1 for update", [tableIds[0]]);
      await editor.query("update dining_tables set max_seats = 2 where id = $1", [tableIds[0]]);

      const booking = book("race-edit-first", 4);
      await waitForLockWait();
      await editor.query("commit");

      // It read 4 seats, waited, then saw 2: the party no longer fits anywhere.
      expect((await booking).statusCode).toBe(409);
    } finally {
      editor.release();
    }
    const left = await pool.query("select 1 from reservation_tables where table_id = $1", [
      tableIds[0],
    ]);
    expect(left.rowCount).toBe(0);
  });

  it("a seat change that waited for a booking sees it and is refused", async () => {
    const { tableIds, venueId } = await venueWith("race-booking-first", [
      { label: "A", minSeats: 1, maxSeats: 4, x: 100 },
    ]);
    // A booking in progress for 4 at the table, not yet committed.
    const guest = await pool.connect();
    try {
      await guest.query("begin");
      const { rows } = await guest.query<{ id: string }>(
        `insert into reservations (venue_id, starts_at, ends_at, party_size, guest_name, guest_email)
         values ($1, '2030-06-01T18:00:00Z', '2030-06-01T20:00:00Z', 4, 'Guest', 'g@example.com')
         returning id`,
        [venueId],
      );
      await guest.query(
        "insert into reservation_tables (reservation_id, table_id, venue_id) values ($1, $2, $3)",
        [rows[0]?.id, tableIds[0], venueId],
      );

      const edit = call("PATCH", `/venues/race-booking-first/tables/${tableIds[0]}`, {
        maxSeats: 2,
      });
      await waitForLockWait();
      await guest.query("commit");

      expect((await edit).statusCode).toBe(409);
    } finally {
      guest.release();
    }
  });

  it("two tables added on the same spot at once: only one gets in", async () => {
    const { zoneId } = await venueWith("race-two-tables");
    const responses = await Promise.all(
      ["P", "Q", "R", "S"].map((label) =>
        call("POST", `/venues/race-two-tables/zones/${zoneId}/tables`, { ...TABLE, label }),
      ),
    );

    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 422, 422, 422]);
    expect((await floorPlan("race-two-tables")).zones[0]?.tables).toHaveLength(1);
  });
});

describe("limits", () => {
  it("caps the tables in a zone and the zones in a venue", async () => {
    const { zoneId, venueId } = await venueWith("limit-tables");
    // 200 small tables in a grid, written straight to the database.
    await pool.query(
      `insert into dining_tables (venue_id, zone_id, label, min_seats, max_seats, x, y, width, height)
       select $1, $2, 'T' || n, 1, 2, 50 + (n % 20) * 90, 50 + (n / 20) * 90, 80, 80
         from generate_series(0, 199) as n`,
      [venueId, zoneId],
    );
    const extra = await call("POST", `/venues/limit-tables/zones/${zoneId}/tables`, {
      ...TABLE,
      x: 1950,
      y: 950,
      width: 50,
      height: 50,
    });
    expect(extra.statusCode).toBe(409);

    await pool.query(
      `insert into zones (venue_id, name, width, height)
       select $1, 'Z' || n, 100, 100 from generate_series(1, 49) as n`,
      [venueId],
    );
    const zone = await call("POST", "/venues/limit-tables/zones", {
      name: "One too many",
      width: 100,
      height: 100,
    });
    expect(zone.statusCode).toBe(409);
  });

  it("accepts text that only looks like an escaped NUL in a style", async () => {
    const { zoneId } = await venueWith("limit-style");
    const response = await call("POST", `/venues/limit-style/zones/${zoneId}/tables`, {
      ...TABLE,
      style: { note: String.raw`\u0000` },
    });
    expect(response.statusCode).toBe(201);
  });

  it("lets a table booked on its own move to another zone: the party keeps it", async () => {
    const { tableIds } = await venueWith("limit-move-single", [{ label: "A", x: 100 }]);
    expect((await book("limit-move-single", 2)).statusCode).toBe(201);
    const terrace = await call("POST", "/venues/limit-move-single/zones", {
      name: "Terrace",
      width: 500,
      height: 500,
    });

    const moved = await call("PATCH", `/venues/limit-move-single/tables/${tableIds[0]}`, {
      zoneId: terrace.json<ApiZone>().id,
      x: 200,
      y: 200,
    });
    expect(moved.statusCode).toBe(200);
  });
});
