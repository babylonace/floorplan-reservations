import { createUser, grantRole } from "../src/auth/staff.js";
import { createPool } from "../src/db.js";
import { runMigrations } from "../src/migrate.js";
import { runSeed } from "../src/seed.js";
import { TEST_OWNER_EMAIL, TEST_PASSWORD, testDatabaseUrl } from "./helpers.js";

/**
 * Starts every test run from an empty database with the migrations, the sample venue and the
 * test owner, who runs the sample venue.
 */
export default async function setup(): Promise<void> {
  const pool = createPool(testDatabaseUrl());
  try {
    await pool.query("drop schema if exists public cascade; create schema public;");
    await runMigrations(pool);
    await runSeed(pool);
    const ownerId = await createUser(pool, TEST_OWNER_EMAIL, TEST_PASSWORD);
    await grantRole(pool, ownerId, "sample-bistro", "owner");
  } finally {
    await pool.end();
  }
}
