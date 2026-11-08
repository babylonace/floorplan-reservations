import { createUser, grantRole } from "../../api/src/auth/staff.js";
import { createPool } from "../../api/src/db.js";
import { runMigrations } from "../../api/src/migrate.js";
import { runSeed } from "../../api/src/seed.js";
import { BOOKED_TABLE_ID, e2eDatabaseUrl, OWNER, STAFF, VENUE } from "./database.js";

/**
 * Starts the browser tests from a known state: the migrations, the made-up sample venue, an
 * owner, a member of staff, and one booking tomorrow at table 4.
 */
const pool = createPool(e2eDatabaseUrl());
try {
  await pool.query("drop schema if exists public cascade; create schema public;");
  await runMigrations(pool);
  await runSeed(pool);
  const owner = await createUser(pool, OWNER.email, OWNER.password);
  await grantRole(pool, owner, VENUE.slug, "owner");
  const staff = await createUser(pool, STAFF.email, STAFF.password);
  await grantRole(pool, staff, VENUE.slug, "staff");

  const { rows } = await pool.query<{ id: string; venue_id: string }>(
    `insert into reservations (venue_id, starts_at, ends_at, party_size, guest_name, guest_email)
     select venue_id, now() + interval '1 day', now() + interval '1 day 2 hours', 4,
            'Test Guest', 'guest@example.com'
       from dining_tables where id = $1
     returning id, venue_id`,
    [BOOKED_TABLE_ID],
  );
  const booking = rows[0];
  if (!booking) throw new Error("The sample table for the booking is missing");
  await pool.query(
    "insert into reservation_tables (reservation_id, table_id, venue_id) values ($1, $2, $3)",
    [booking.id, BOOKED_TABLE_ID, booking.venue_id],
  );
} finally {
  await pool.end();
}
