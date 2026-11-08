import type { AppOptions } from "../src/app.js";
import { loadDotEnvIfPresent } from "../src/config.js";
import type { Pool } from "../src/db.js";

/**
 * The database the tests use. The tests wipe it, so the name has to end in `_test`:
 * that keeps a mistyped URL from destroying real data.
 */
export function testDatabaseUrl(): string {
  loadDotEnvIfPresent();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Point it at an empty PostgreSQL database whose name ends in _test.",
    );
  }

  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!name.endsWith("_test")) {
    throw new Error(
      `Refusing to run the tests against "${name}": they wipe the database, so its name must end in _test.`,
    );
  }
  return url;
}

/**
 * The tests book dates in 2030, so their app lives a few days before them: the booking horizon
 * counts from this "now". The rate limit is far out of the way except in the tests about it.
 */
export const TEST_NOW = new Date("2030-05-20T10:00:00Z");
export const TEST_APP_OPTIONS = {
  now: () => TEST_NOW,
  bookingRateLimit: { max: 100_000, windowMs: 60_000 },
} satisfies Partial<AppOptions>;

let guests = 0;

/** A new e-mail address each time, so bookings are not mistaken for one guest booking twice. */
export function newGuestEmail(): string {
  guests += 1;
  return `guest-${String(guests)}@example.com`;
}

export const SAMPLE_VENUE_ID = "00000000-0000-4000-8000-000000000001";
export const SAMPLE_ZONE_ID = "00000000-0000-4000-8000-000000000101";
export const SAMPLE_TABLE_ID = "00000000-0000-4000-8000-000000001001";

export interface TestTable {
  label: string;
  minSeats?: number;
  maxSeats?: number;
  x: number;
  y?: number;
  shape?: "rect" | "round";
}

/**
 * Creates and commits a venue with one zone and the given 80 × 80 cm tables. It takes bookings
 * every day from 00:00 to 23:59. Tests that need
 * several connections at once cannot hide their rows in a rolled-back transaction, so they
 * use their own venue and delete it at the end.
 */
export async function createVenue(
  pool: Pool,
  slug: string,
  tables: TestTable[],
): Promise<{ venueId: string; tableIds: string[] }> {
  const venue = await pool.query<{ id: string }>(
    `insert into venues (slug, name, time_zone, locales) values ($1, $1, 'Europe/Madrid', array['es', 'en'])
     returning id`,
    [slug],
  );
  const venueId = venue.rows[0]?.id;
  if (!venueId) throw new Error("Venue was not created");
  const zone = await pool.query<{ id: string }>(
    "insert into zones (venue_id, name, width, height) values ($1, 'Room', 2000, 1000) returning id",
    [venueId],
  );
  await pool.query(
    `insert into opening_hours (venue_id, weekday, first_arrival, last_arrival)
     select $1, weekday, '00:00', '23:59' from generate_series(1, 7) as weekday`,
    [venueId],
  );
  const tableIds: string[] = [];
  for (const table of tables) {
    const { rows } = await pool.query<{ id: string }>(
      `insert into dining_tables (venue_id, zone_id, label, min_seats, max_seats, shape, x, y, width, height)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 80, 80)
       returning id`,
      [
        venueId,
        zone.rows[0]?.id,
        table.label,
        table.minSeats ?? 1,
        table.maxSeats ?? 2,
        table.shape ?? "rect",
        table.x,
        table.y ?? 100,
      ],
    );
    if (rows[0]) tableIds.push(rows[0].id);
  }
  return { venueId, tableIds };
}

export async function deleteVenue(pool: Pool, slug: string): Promise<void> {
  await pool.query("delete from venues where slug = $1", [slug]);
}
